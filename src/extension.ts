/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Extension Entry Point
 *
 * Wires together all components:
 *   TaskManager  → CRUD + persistence for the four pools
 *   AiService    → metadata extraction + task processing (via vscode.lm)
 *   Scheduler    → deterministic conflict-avoidance scheduling loop
 *   WebviewProvider → sidebar view + dashboard panel (Kanban board UI)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { TaskManager } from './taskManager';
import { AiService } from './aiService';
import { TaskScheduler } from './scheduler';
import { WebviewProvider } from './webviewProvider';
import { WebviewMessage, TaskStatus, OperationType } from './types';

/**
 * Virtual content provider that serves the "before" version of files
 * for the diff editor. Content is set dynamically before opening each diff.
 */
class BeforeContentProvider implements vscode.TextDocumentContentProvider {
    private contents = new Map<string, string>();

    setContent(key: string, content: string): void {
        this.contents.set(key, content);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.path) ?? '';
    }
}

const AITP_SCHEME = 'aitp-before';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // --- Create services ---
    const taskManager = new TaskManager(context);
    await taskManager.initialize();

    const aiService = new AiService();

    // Placeholder for scheduler (needed by webview provider's getSchedulerState callback)
    let scheduler: TaskScheduler;

    const webviewProvider = new WebviewProvider(
        context.extensionUri,
        taskManager,
        () => ({
            runningModules: scheduler ? scheduler.getRunningModules() : [],
            active: scheduler ? scheduler.isActive() : false,
            pendingApproval: scheduler ? scheduler.getPendingApproval() : null,
        })
    );

    scheduler = new TaskScheduler(taskManager, aiService, () => {
        webviewProvider.update();
    });

    // --- Register virtual content provider for diff viewer ---
    const beforeContentProvider = new BeforeContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(AITP_SCHEME, beforeContentProvider)
    );

    // --- Wire up webview messages ---
    webviewProvider.setMessageHandler((msg: WebviewMessage) => {
        handleWebviewMessage(msg, taskManager, scheduler, webviewProvider, beforeContentProvider).catch(err => {
            console.error('[AI Task Pipeline] Message handler error', err);
        });
    });

    // --- Register webview view provider (sidebar) ---
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'aiTaskPipeline.sidebar',
            webviewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // --- Register commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('aiTaskPipeline.openDashboard', () => {
            webviewProvider.openDashboard();
        }),
        vscode.commands.registerCommand('aiTaskPipeline.addTask', async () => {
            const title = await vscode.window.showInputBox({ prompt: 'Task title', placeHolder: 'e.g. Update Payment API' });
            if (!title) { return; }
            const description = await vscode.window.showInputBox({ prompt: 'Task description', placeHolder: 'e.g. Refactor stripe checkout flow' });
            if (!description) { return; }
            taskManager.createTask(title, description);
            webviewProvider.update();
        }),
        vscode.commands.registerCommand('aiTaskPipeline.toggleScheduler', () => {
            scheduler.toggle();
            webviewProvider.update();
        }),
    );

    // --- Start scheduler ---
    scheduler.start();

    // --- Auto-open dashboard on first activation (optional) ---
    // webviewProvider.openDashboard();

    // --- Disposables ---
    context.subscriptions.push(taskManager, scheduler, webviewProvider);

    console.log('[AI Task Pipeline] Extension activated.');
}

/** Handle messages from both sidebar and dashboard webviews */
async function handleWebviewMessage(
    msg: WebviewMessage,
    taskManager: TaskManager,
    scheduler: TaskScheduler,
    webviewProvider: WebviewProvider,
    beforeContentProvider: BeforeContentProvider
): Promise<void> {
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
            if (!task || !task.operations) { break; }
            // Find the file operation matching this file path
            const op = task.operations.find(o => o.target === msg.filePath && (o.type === 'writeFile' || o.type === 'editFile'));
            if (!op) { break; }
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

export function deactivate(): void {
    // Cleanup handled by disposables
}
