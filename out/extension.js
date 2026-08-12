"use strict";
/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Extension Entry Point
 *
 * Wires together all components:
 *   TaskManager  → CRUD + persistence for the four pools
 *   AiService    → metadata extraction + task processing (via vscode.lm)
 *   Scheduler    → deterministic conflict-avoidance scheduling loop
 *   WebviewProvider → sidebar view + dashboard panel (Kanban board UI)
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const taskManager_1 = require("./taskManager");
const aiService_1 = require("./aiService");
const scheduler_1 = require("./scheduler");
const webviewProvider_1 = require("./webviewProvider");
/**
 * Virtual content provider that serves the "before" version of files
 * for the diff editor. Content is set dynamically before opening each diff.
 */
class BeforeContentProvider {
    contents = new Map();
    setContent(key, content) {
        this.contents.set(key, content);
    }
    provideTextDocumentContent(uri) {
        return this.contents.get(uri.path) ?? '';
    }
}
const AITP_SCHEME = 'aitp-before';
async function activate(context) {
    // --- Create services ---
    const taskManager = new taskManager_1.TaskManager(context);
    await taskManager.initialize();
    const aiService = new aiService_1.AiService();
    // Placeholder for scheduler (needed by webview provider's getSchedulerState callback)
    let scheduler;
    const webviewProvider = new webviewProvider_1.WebviewProvider(context.extensionUri, taskManager, () => ({
        runningModules: scheduler ? scheduler.getRunningModules() : [],
        active: scheduler ? scheduler.isActive() : false,
        pendingApproval: scheduler ? scheduler.getPendingApproval() : null,
    }));
    scheduler = new scheduler_1.TaskScheduler(taskManager, aiService, () => {
        webviewProvider.update();
    });
    // --- Register virtual content provider for diff viewer ---
    const beforeContentProvider = new BeforeContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(AITP_SCHEME, beforeContentProvider));
    // --- Wire up webview messages ---
    webviewProvider.setMessageHandler((msg) => {
        handleWebviewMessage(msg, taskManager, scheduler, webviewProvider, beforeContentProvider).catch(err => {
            console.error('[AI Task Pipeline] Message handler error', err);
        });
    });
    // --- Register webview view provider (sidebar) ---
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('aiTaskPipeline.sidebar', webviewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    // --- Register commands ---
    context.subscriptions.push(vscode.commands.registerCommand('aiTaskPipeline.openDashboard', () => {
        webviewProvider.openDashboard();
    }), vscode.commands.registerCommand('aiTaskPipeline.addTask', async () => {
        const title = await vscode.window.showInputBox({ prompt: 'Task title', placeHolder: 'e.g. Update Payment API' });
        if (!title) {
            return;
        }
        const description = await vscode.window.showInputBox({ prompt: 'Task description', placeHolder: 'e.g. Refactor stripe checkout flow' });
        if (!description) {
            return;
        }
        taskManager.createTask(title, description);
        webviewProvider.update();
    }), vscode.commands.registerCommand('aiTaskPipeline.toggleScheduler', () => {
        scheduler.toggle();
        webviewProvider.update();
    }));
    // --- Start scheduler ---
    scheduler.start();
    // --- Auto-open dashboard on first activation (optional) ---
    // webviewProvider.openDashboard();
    // --- Disposables ---
    context.subscriptions.push(taskManager, scheduler, webviewProvider);
    console.log('[AI Task Pipeline] Extension activated.');
}
/** Handle messages from both sidebar and dashboard webviews */
async function handleWebviewMessage(msg, taskManager, scheduler, webviewProvider, beforeContentProvider) {
    switch (msg.type) {
        case 'addTask':
            taskManager.createTask(msg.title, msg.description);
            webviewProvider.update();
            break;
        case 'approve':
            scheduler.approveTask(msg.taskId);
            webviewProvider.update();
            break;
        case 'reject':
            scheduler.rejectTask(msg.taskId);
            webviewProvider.update();
            break;
        case 'rollbackTask':
            await scheduler.rollbackTask(msg.taskId);
            webviewProvider.update();
            break;
        case 'refresh':
            webviewProvider.update();
            break;
        case 'openDashboard':
            webviewProvider.openDashboard();
            break;
        case 'toggleScheduler':
            scheduler.toggle();
            webviewProvider.update();
            break;
        case 'clearCompleted':
            taskManager.clearCompleted();
            webviewProvider.update();
            break;
        case 'approveOperation':
            scheduler.approveOperation(msg.operationId);
            webviewProvider.update();
            break;
        case 'rejectOperation':
            scheduler.rejectOperation(msg.operationId);
            webviewProvider.update();
            break;
        case 'viewDetails':
            // Details are rendered client-side from the task data already sent;
            // just trigger a fresh update to ensure latest operations are included
            webviewProvider.update();
            break;
        case 'viewDiff': {
            const task = taskManager.getTask(msg.taskId);
            if (!task || !task.operations) {
                break;
            }
            // Find the file operation matching this file path
            const op = task.operations.find(o => o.target === msg.filePath && (o.type === 'writeFile' || o.type === 'editFile'));
            if (!op) {
                break;
            }
            // Set the before content in the virtual document provider (use empty string for new files)
            const beforeKey = `/${msg.taskId}/${encodeURIComponent(msg.filePath)}`;
            beforeContentProvider.setContent(beforeKey, op.beforeContent ?? '');
            // Build the left (before) URI from our virtual scheme
            const beforeUri = vscode.Uri.from({ scheme: AITP_SCHEME, path: beforeKey });
            // Resolve the right (after) URI — the actual file on disk
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showWarningMessage('需要打开一个工作区才能查看差异。');
                break;
            }
            const absPath = path.isAbsolute(msg.filePath) ? msg.filePath : path.join(workspaceRoot, msg.filePath);
            const afterUri = vscode.Uri.file(absPath);
            const fileName = absPath.split(/[/\\]/).pop() || absPath;
            // Open VS Code's built-in diff editor — same experience as Copilot's change view
            await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `${fileName} (修改前 ↔ 修改后)`);
            break;
        }
    }
}
function deactivate() {
    // Cleanup handled by disposables
}
//# sourceMappingURL=extension.js.map