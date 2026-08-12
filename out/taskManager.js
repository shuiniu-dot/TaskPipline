"use strict";
/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Task Manager
 * Manages the four-pool lifecycle: Todo → InProgress → PendingReview → Completed
 * Provides CRUD operations, status transitions, and workspace persistence.
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
exports.TaskManager = void 0;
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
const STORAGE_KEY = 'aiTaskPipeline.tasks';
class TaskManager {
    context;
    tasks = new Map();
    _onDidChange = new vscode.EventEmitter();
    onDidChange = this._onDidChange.event;
    constructor(context) {
        this.context = context;
    }
    dispose() {
        this._onDidChange.dispose();
    }
    async initialize() {
        const stored = this.context.workspaceState.get(STORAGE_KEY);
        if (stored && stored.length > 0) {
            for (const task of stored) {
                // Reset any InProgress tasks back to Todo on reload
                if (task.status === types_1.TaskStatus.InProgress) {
                    task.status = types_1.TaskStatus.Todo;
                    task.processingProgress = 0;
                    task.processingMessage = '';
                    task.startedAt = undefined;
                }
                // Ensure operations field exists (backward compat with older stored data)
                if (!task.operations) {
                    task.operations = [];
                }
                this.tasks.set(task.id, task);
            }
        }
    }
    persist() {
        this.context.workspaceState.update(STORAGE_KEY, Array.from(this.tasks.values()));
        this._onDidChange.fire();
    }
    createTask(title, description) {
        const task = {
            id: this.generateId(),
            title,
            description,
            status: types_1.TaskStatus.Todo,
            modules: [],
            metadataExtracted: false,
            createdAt: Date.now(),
            processingProgress: 0,
            processingMessage: '',
            operations: [],
        };
        this.tasks.set(task.id, task);
        this.persist();
        return task;
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    getAllTasks() {
        return Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
    }
    getTasksByStatus(status) {
        return this.getAllTasks().filter(t => t.status === status);
    }
    updateTask(id, updates) {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        Object.assign(task, updates);
        this.persist();
        return task;
    }
    moveToStatus(id, status) {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        task.status = status;
        const now = Date.now();
        switch (status) {
            case types_1.TaskStatus.InProgress:
                task.startedAt = now;
                task.processingProgress = 0;
                task.processingMessage = 'Initializing AI agent...';
                break;
            case types_1.TaskStatus.PendingReview:
                task.reviewReadyAt = now;
                task.processingProgress = 100;
                task.processingMessage = '';
                break;
            case types_1.TaskStatus.Completed:
                task.completedAt = now;
                break;
            case types_1.TaskStatus.Terminated:
                task.completedAt = now;
                break;
        }
        this.persist();
        return task;
    }
    setModules(id, modules) {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        task.modules = modules;
        task.metadataExtracted = true;
        this.persist();
        return task;
    }
    setProcessingProgress(id, progress, message) {
        const task = this.tasks.get(id);
        if (!task) {
            return;
        }
        task.processingProgress = Math.min(100, Math.max(0, progress));
        task.processingMessage = message;
        // Fire event without persisting (too frequent)
        this._onDidChange.fire();
    }
    setAiResult(id, result, additions, deletions) {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        task.aiResult = result;
        task.codeChanges = { additions, deletions };
        this.persist();
        return task;
    }
    /** Append an operation to a task's operation log */
    addOperation(id, operation) {
        const task = this.tasks.get(id);
        if (!task) {
            return;
        }
        if (!task.operations) {
            task.operations = [];
        }
        // Update existing operation (by ID) or append new one
        const existingIdx = task.operations.findIndex(op => op.id === operation.id);
        if (existingIdx >= 0) {
            task.operations[existingIdx] = operation;
        }
        else {
            task.operations.push(operation);
        }
        this._onDidChange.fire();
    }
    deleteTask(id) {
        const deleted = this.tasks.delete(id);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }
    clearCompleted() {
        const toDelete = [];
        for (const [id, task] of this.tasks) {
            if (task.status === types_1.TaskStatus.Completed || task.status === types_1.TaskStatus.Terminated) {
                toDelete.push(id);
            }
        }
        toDelete.forEach(id => this.tasks.delete(id));
        this.persist();
    }
    generateId() {
        const num = this.tasks.size + 100;
        return `TASK-${String(num).padStart(3, '0')}`;
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=taskManager.js.map