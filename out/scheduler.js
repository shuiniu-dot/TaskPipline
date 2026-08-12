"use strict";
/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Scheduler
 *
 * Deterministic conflict-avoidance scheduler:
 *   1. Extracts metadata (modules) for new Todo tasks via AI
 *   2. Polls Todo pool, picks tasks whose modules don't overlap with currentRunningModules
 *   3. Moves eligible task → InProgress, locks its modules
 *   4. Copilot agent processes the task (reads files, edits code, runs commands),
 *      then moves it → PendingReview, releases module locks
 *   5. Immediately triggers next scheduling round to unblock previously-conflicting tasks
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
class TaskScheduler {
    taskManager;
    aiService;
    onUpdate;
    /** Globally locked modules — union of all InProgress task modules */
    currentRunningModules = new Set();
    interval;
    active = false;
    scheduling = false;
    /** Pending approval request from a high-risk operation (null if none) */
    _pendingApproval = null;
    /** Map of operationId → resolve callback for pending approval promises */
    approvalCallbacks = new Map();
    _onStatusChange = new vscode.EventEmitter();
    onStatusChange = this._onStatusChange.event;
    constructor(taskManager, aiService, 
    /** Called after any state change to refresh webviews */
    onUpdate) {
        this.taskManager = taskManager;
        this.aiService = aiService;
        this.onUpdate = onUpdate;
    }
    /** Start the scheduler polling loop */
    start() {
        if (this.active) {
            return;
        }
        this.active = true;
        // Run an immediate tick, then poll every 2 seconds
        this.tick();
        this.interval = setInterval(() => this.tick(), 2000);
        this._onStatusChange.fire();
    }
    /** Stop the scheduler */
    stop() {
        this.active = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        this._onStatusChange.fire();
    }
    toggle() {
        if (this.active) {
            this.stop();
        }
        else {
            this.start();
        }
    }
    isActive() {
        return this.active;
    }
    getRunningModules() {
        return Array.from(this.currentRunningModules);
    }
    /** Get the current pending approval request (for UI display) */
    getPendingApproval() {
        return this._pendingApproval;
    }
    /** User approved a pending high-risk operation — resume execution */
    approveOperation(operationId) {
        const callback = this.approvalCallbacks.get(operationId);
        if (callback) {
            this.approvalCallbacks.delete(operationId);
            this._pendingApproval = null;
            callback(true);
            this._onStatusChange.fire();
            this.onUpdate();
        }
    }
    /** User rejected a pending high-risk operation — abort it */
    rejectOperation(operationId) {
        const callback = this.approvalCallbacks.get(operationId);
        if (callback) {
            this.approvalCallbacks.delete(operationId);
            this._pendingApproval = null;
            callback(false);
            this._onStatusChange.fire();
            this.onUpdate();
        }
    }
    /** Main scheduling tick — runs periodically */
    async tick() {
        if (this.scheduling) {
            return;
        }
        this.scheduling = true;
        try {
            // Phase 1: Extract metadata for Todo tasks that don't have it yet
            await this.extractPendingMetadata();
            // Phase 2: Try to schedule eligible Todo tasks
            this.tryScheduleTasks();
        }
        finally {
            this.scheduling = false;
        }
    }
    /** Extract module metadata for Todo tasks that haven't been analyzed yet */
    async extractPendingMetadata() {
        const todoTasks = this.taskManager.getTasksByStatus(types_1.TaskStatus.Todo);
        const needsExtraction = todoTasks.filter(t => !t.metadataExtracted);
        for (const task of needsExtraction) {
            try {
                const result = await this.aiService.extractMetadata(task);
                this.taskManager.setModules(task.id, result.modules);
                this.onUpdate();
            }
            catch (err) {
                console.error(`[Scheduler] Failed to extract metadata for ${task.id}`, err);
                // Fallback: mark as extracted with a general module
                this.taskManager.setModules(task.id, ['general']);
                this.onUpdate();
            }
        }
    }
    /** Find and start Todo tasks whose modules don't conflict with running modules */
    tryScheduleTasks() {
        if (!this.active) {
            return;
        }
        const todoTasks = this.taskManager.getTasksByStatus(types_1.TaskStatus.Todo);
        const readyTasks = todoTasks.filter(t => t.metadataExtracted && t.modules.length > 0);
        for (const task of readyTasks) {
            // Deterministic set intersection check: task.modules ∩ currentRunningModules == ∅
            const hasConflict = task.modules.some(m => this.currentRunningModules.has(m));
            if (!hasConflict) {
                // Lock modules and move to InProgress
                for (const mod of task.modules) {
                    this.currentRunningModules.add(mod);
                }
                this.taskManager.moveToStatus(task.id, types_1.TaskStatus.InProgress);
                this._onStatusChange.fire();
                this.onUpdate();
                // Start async AI processing (non-blocking)
                this.processTaskAsync(task);
            }
            // If conflict, skip — will be retried in next tick
        }
    }
    /** Process a single task with the AI agent, then move to PendingReview */
    async processTaskAsync(task) {
        try {
            // Use vscode.lm tool-calling agent (reads files, edits code, runs commands — real processing)
            // Each task gets its own isolated conversation session — no shared Copilot dialog
            const result = await this.aiService.processTaskWithTools(task, 
            // onProgress
            (progress, message) => {
                this.taskManager.setProcessingProgress(task.id, progress, message);
                this.onUpdate();
            }, 
            // onApproval — called when a high-risk operation needs user confirmation
            async (approvalRequest) => {
                // Store pending approval and trigger UI update to show approval modal
                this._pendingApproval = approvalRequest;
                this._onStatusChange.fire();
                this.onUpdate();
                // Wait for user decision (resolve via approveOperation/rejectOperation)
                return new Promise((resolve) => {
                    this.approvalCallbacks.set(approvalRequest.operationId, resolve);
                });
            }, 
            // onOperation — called after each tool execution to log it
            (operation) => {
                this.taskManager.addOperation(task.id, operation);
                this.onUpdate();
            });
            // Store AI result and code changes
            this.taskManager.setAiResult(task.id, result.summary, result.additions, result.deletions);
            // Release module locks
            for (const mod of task.modules) {
                this.currentRunningModules.delete(mod);
            }
            // Move to PendingReview
            this.taskManager.moveToStatus(task.id, types_1.TaskStatus.PendingReview);
            this._onStatusChange.fire();
            this.onUpdate();
            // Immediately trigger next scheduling round (unblock conflicting tasks)
            this.tryScheduleTasks();
        }
        catch (err) {
            console.error(`[Scheduler] AI agent failed to process task ${task.id}`, err);
            // Release locks even on failure
            for (const mod of task.modules) {
                this.currentRunningModules.delete(mod);
            }
            // Clear any pending approval if this task had one
            if (this._pendingApproval && this._pendingApproval.taskId === task.id) {
                this._pendingApproval = null;
            }
            // Move back to Todo with error info
            this.taskManager.updateTask(task.id, {
                status: types_1.TaskStatus.Todo,
                processingProgress: 0,
                processingMessage: '',
                aiResult: `Error: ${err instanceof Error ? err.message : String(err)}`,
            });
            this._onStatusChange.fire();
            this.onUpdate();
        }
    }
    /** Human approves a PendingReview task → Completed */
    approveTask(taskId) {
        const task = this.taskManager.getTask(taskId);
        if (!task || task.status !== types_1.TaskStatus.PendingReview) {
            return;
        }
        this.taskManager.moveToStatus(taskId, types_1.TaskStatus.Completed);
        this.onUpdate();
    }
    /** Human rejects a PendingReview task → back to Todo (reprocess without undo) */
    rejectTask(taskId) {
        const task = this.taskManager.getTask(taskId);
        if (!task || task.status !== types_1.TaskStatus.PendingReview) {
            return;
        }
        this.taskManager.updateTask(taskId, {
            status: types_1.TaskStatus.Todo,
            processingProgress: 0,
            processingMessage: '',
            aiResult: undefined,
            codeChanges: undefined,
            startedAt: undefined,
            reviewReadyAt: undefined,
        });
        this.onUpdate();
    }
    /** Rollback all file changes made by the AI, then move task back to Todo */
    async rollbackTask(taskId) {
        const task = this.taskManager.getTask(taskId);
        if (!task || task.status !== types_1.TaskStatus.PendingReview) {
            return;
        }
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && task.operations) {
            const root = wsFolders[0].uri;
            // For each file modified by AI, find the EARLIEST beforeContent
            // (the state before any AI modification) and restore it.
            // If beforeContent is undefined, the file was newly created → delete it.
            const fileRestore = new Map();
            for (const op of task.operations) {
                if (op.type === 'writeFile' || op.type === 'editFile') {
                    if (!fileRestore.has(op.target)) {
                        // First operation on this file — capture original state
                        if (op.beforeContent !== undefined) {
                            fileRestore.set(op.target, op.beforeContent);
                        }
                        else {
                            // File didn't exist before AI created it
                            fileRestore.set(op.target, null);
                        }
                    }
                }
            }
            // Restore each file
            for (const [filePath, originalContent] of fileRestore) {
                const uri = vscode.Uri.joinPath(root, filePath);
                try {
                    if (originalContent === null) {
                        // File was newly created by AI — delete it
                        await vscode.workspace.fs.delete(uri, { useTrash: true });
                        console.log(`[Scheduler] Rollback: deleted new file ${filePath}`);
                    }
                    else {
                        // Restore original content
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(originalContent, 'utf8'));
                        console.log(`[Scheduler] Rollback: restored ${filePath}`);
                    }
                }
                catch (err) {
                    console.error(`[Scheduler] Rollback failed for ${filePath}`, err);
                }
            }
        }
        // Move to Terminated — task is aborted, do NOT re-queue for processing
        this.taskManager.updateTask(taskId, {
            status: types_1.TaskStatus.Terminated,
            processingProgress: 0,
            processingMessage: '',
            aiResult: 'Task rolled back — all AI file changes have been undone.',
            codeChanges: undefined,
            operations: [],
            completedAt: Date.now(),
        });
        this._onStatusChange.fire();
        this.onUpdate();
    }
    dispose() {
        this.stop();
        this._onStatusChange.dispose();
    }
}
exports.TaskScheduler = TaskScheduler;
//# sourceMappingURL=scheduler.js.map