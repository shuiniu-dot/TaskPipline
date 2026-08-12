"use strict";
/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Webview Provider
 * Manages two webviews:
 *   1. Sidebar view (compact overview with task counts and action buttons)
 *   2. Dashboard panel (full Kanban board with 4 columns, task cards, AI animation)
 * Both receive real-time updates via postMessage.
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
exports.WebviewProvider = void 0;
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
class WebviewProvider {
    extensionUri;
    taskManager;
    getSchedulerState;
    panel;
    view;
    messageHandler;
    constructor(extensionUri, taskManager, getSchedulerState) {
        this.extensionUri = extensionUri;
        this.taskManager = taskManager;
        this.getSchedulerState = getSchedulerState;
    }
    setMessageHandler(handler) {
        this.messageHandler = handler;
    }
    /* ---------- WebviewViewProvider (sidebar) ---------- */
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
        view.webview.html = this.getSidebarHtml(view.webview);
        view.webview.onDidReceiveMessage(msg => this.messageHandler?.(msg));
    }
    /* ---------- Dashboard panel ---------- */
    openDashboard() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }
        this.panel = vscode.window.createWebviewPanel('aiTaskPipeline.dashboard', 'Task_Pipeline.dashboard', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.html = this.getDashboardHtml(this.panel.webview);
        this.panel.webview.onDidReceiveMessage(msg => this.messageHandler?.(msg));
        this.panel.onDidDispose(() => { this.panel = undefined; });
        this.update();
    }
    /* ---------- Push updates to all active webviews ---------- */
    update() {
        const payload = this.buildPayload();
        this.panel?.webview.postMessage(payload);
        this.view?.webview.postMessage(payload);
    }
    buildPayload() {
        const state = this.getSchedulerState();
        const tasks = this.taskManager.getAllTasks();
        const taskViews = tasks.map(task => {
            const conflictingModules = task.modules.filter(m => state.runningModules.includes(m));
            return {
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                modules: task.modules,
                metadataExtracted: task.metadataExtracted,
                hasConflict: task.status === types_1.TaskStatus.Todo && conflictingModules.length > 0,
                conflictingModules,
                isProcessing: task.status === types_1.TaskStatus.InProgress,
                processingProgress: task.processingProgress,
                processingMessage: task.processingMessage,
                aiResult: task.aiResult,
                codeChanges: task.codeChanges,
                operations: task.operations || [],
                createdAt: new Date(task.createdAt).toLocaleString(),
                completedAt: task.completedAt ? new Date(task.completedAt).toLocaleString() : undefined,
            };
        });
        return {
            type: 'update',
            tasks: taskViews,
            runningModules: state.runningModules,
            schedulerActive: state.active,
            pendingApproval: state.pendingApproval,
        };
    }
    dispose() {
        this.panel?.dispose();
    }
    /* ========================================================================
       DASHBOARD HTML (Full Kanban Board)
       ======================================================================== */
    getDashboardHtml(webview) {
        const nonce = getNonce();
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>AI Task Pipeline</title>
<style>
${this.dashboardCss()}
</style>
</head>
<body>
<div id="app">
  <div class="header">
    <h1>AI 任务调度管线</h1>
    <div class="status-badge">
      <span class="status-dot" id="sched-dot"></span>
      <span id="sched-text">调度器：运行中</span>
    </div>
  </div>
  <div class="toolbar">
    <button class="btn btn-primary" id="btn-add">+ 添加任务</button>
    <button class="btn" id="btn-toggle">暂停调度器</button>
    <button class="btn" id="btn-clear">清除已完成</button>
  </div>
  <div class="board" id="board">
    <div class="column" data-status="todo">
      <div class="col-header"><span class="col-dot" style="background:${types_1.POOL_COLORS[types_1.TaskStatus.Todo]}"></span><span class="col-title">${types_1.POOL_LABELS[types_1.TaskStatus.Todo]}</span><span class="col-count" id="count-todo">0</span></div>
      <div class="col-cards" id="col-todo"></div>
    </div>
    <div class="column col-active" data-status="inProgress">
      <div class="col-header"><span class="col-dot" style="background:${types_1.POOL_COLORS[types_1.TaskStatus.InProgress]}"></span><span class="col-title">${types_1.POOL_LABELS[types_1.TaskStatus.InProgress]}</span><span class="col-count" id="count-inProgress">0</span></div>
      <div class="col-cards" id="col-inProgress"></div>
    </div>
    <div class="column" data-status="pendingReview">
      <div class="col-header"><span class="col-dot" style="background:${types_1.POOL_COLORS[types_1.TaskStatus.PendingReview]}"></span><span class="col-title">${types_1.POOL_LABELS[types_1.TaskStatus.PendingReview]}</span><span class="col-count" id="count-pendingReview">0</span></div>
      <div class="col-cards" id="col-pendingReview"></div>
    </div>
    <div class="column" data-status="completed">
      <div class="col-header"><span class="col-dot" style="background:${types_1.POOL_COLORS[types_1.TaskStatus.Completed]}"></span><span class="col-title">${types_1.POOL_LABELS[types_1.TaskStatus.Completed]}</span><span class="col-count" id="count-completed">0</span></div>
      <div class="col-cards" id="col-completed"></div>
    </div>
    <div class="column" data-status="terminated">
      <div class="col-header"><span class="col-dot" style="background:${types_1.POOL_COLORS[types_1.TaskStatus.Terminated]}"></span><span class="col-title">${types_1.POOL_LABELS[types_1.TaskStatus.Terminated]}</span><span class="col-count" id="count-terminated">0</span></div>
      <div class="col-cards" id="col-terminated"></div>
    </div>
  </div>
  <div class="statusbar">
    <span id="sb-sched">AI 调度器：运行中</span>
    <span id="sb-locked">锁定：无</span>
    <span class="sb-right">UTF-8 | Code-OSS</span>
  </div>
</div>
<div class="modal hidden" id="modal">
  <div class="modal-content">
    <h3>添加新任务</h3>
    <input id="inp-title" placeholder="任务标题..." />
    <textarea id="inp-desc" placeholder="任务描述..." rows="3"></textarea>
    <div class="modal-actions">
      <button class="btn" id="modal-cancel">取消</button>
      <button class="btn btn-primary" id="modal-ok">添加</button>
    </div>
  </div>
</div>
<div class="modal hidden" id="approval-modal">
  <div class="modal-content modal-wide">
    <h3>高危操作审批</h3>
    <div class="approval-warning">AI 代理请求执行高危操作，请审核后批准或拒绝。</div>
    <div class="approval-field"><span class="approval-label">类型：</span><span id="apr-type"></span></div>
    <div class="approval-field"><span class="approval-label">目标：</span><span id="apr-target"></span></div>
    <div class="approval-field"><span class="approval-label">描述：</span><span id="apr-desc"></span></div>
    <div class="approval-field"><span class="approval-label">输入：</span><pre class="approval-input" id="apr-input"></pre></div>
    <div class="modal-actions">
      <button class="btn btn-reject" id="apr-reject">拒绝</button>
      <button class="btn btn-approve" id="apr-approve">批准</button>
    </div>
  </div>
</div>
<div class="modal hidden" id="details-modal">
  <div class="modal-content modal-wide">
    <h3 id="details-title">操作详情</h3>
    <div id="details-body"></div>
    <div class="modal-actions">
      <button class="btn" id="details-close">关闭</button>
    </div>
  </div>
</div>
<div class="modal hidden" id="reject-modal">
  <div class="modal-content">
    <h3>拒绝任务</h3>
    <div class="reject-warning">选择如何处理被拒绝的任务：</div>
    <div class="reject-options">
      <button class="reject-option" id="reject-cancel">
        <span class="reject-opt-title">取消</span>
        <span class="reject-opt-desc">关闭对话框，保持任务原样</span>
      </button>
      <button class="reject-option" id="reject-reprocess">
        <span class="reject-opt-title">重新处理</span>
        <span class="reject-opt-desc">退回待处理，保留 AI 修改</span>
      </button>
      <button class="reject-option reject-option-danger" id="reject-rollback">
        <span class="reject-opt-title">回滚</span>
        <span class="reject-opt-desc">撤销所有文件修改，不重新执行</span>
      </button>
    </div>
  </div>
</div>
<script nonce="${nonce}">
${this.dashboardJs()}
</script>
</body>
</html>`;
    }
    dashboardCss() {
        return `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-foreground, #cccccc); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; overflow: hidden; }
#app { display: flex; flex-direction: column; height: 100vh; }
.header { display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
.header h1 { font-size: 16px; color: var(--vscode-foreground, #fff); font-weight: 600; }
.status-badge { display: flex; align-items: center; gap: 6px; background: var(--vscode-editorWidget-background, #2d2d2d); border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 10px; padding: 3px 10px; font-size: 11px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ec9b0; flex-shrink: 0; }
.status-dot.inactive { background: #f14c4c; }
.toolbar { display: flex; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
.btn { background: var(--vscode-button-secondaryBackground, #3c3c3c); color: var(--vscode-button-secondaryForeground, #cccccc); border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, #4c4c4c); }
.btn-primary { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.board { display: flex; gap: 12px; padding: 12px 16px; flex: 1; overflow-x: auto; }
.column { display: flex; flex-direction: column; min-width: 250px; width: 250px; background: var(--vscode-sideBar-background, #252526); border: 1px solid var(--vscode-panel-border, #333); border-radius: 8px; }
.column.col-active { border-color: var(--vscode-focusBorder, #007acc); }
.col-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
.col-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.col-title { font-size: 12px; font-weight: 600; flex: 1; color: var(--vscode-foreground, #ccc); }
.col-count { background: var(--vscode-badge-background, #333); border-radius: 9px; padding: 1px 8px; font-size: 11px; font-weight: bold; color: var(--vscode-badge-foreground, #858585); min-width: 24px; text-align: center; }
.col-cards { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--vscode-editor-background, #1e1e1e); border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 6px; padding: 10px; }
.card-conflict { border: 1px dashed #f14c4c; }
.card-completed { opacity: 0.6; }
.card-terminated { opacity: 0.6; border-color: #f14c4c; }
.card-title { font-size: 12px; font-weight: 600; color: var(--vscode-foreground, #e0e0e0); margin-bottom: 4px; }
.card-desc { font-size: 11px; color: var(--vscode-descriptionForeground, #858585); margin-bottom: 8px; }
.card-modules { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.module-tag { background: var(--vscode-symbolIcon-classForeground, #264f78); color: var(--vscode-textLink-foreground, #4fc1ff); font-size: 10px; padding: 2px 6px; border-radius: 4px; }
.module-tag.locked { background: var(--vscode-editorWarning-background, #3a3d41); color: var(--vscode-editorWarning-foreground, #dcdcaa); }
.conflict-warn { background: rgba(241,76,76,0.15); color: #f14c4c; font-size: 10px; font-weight: bold; padding: 3px 6px; border-radius: 3px; margin-top: 4px; }
.ready-tag { color: #6a9955; font-size: 10px; margin-top: 4px; }
.extracting-tag { color: #cca700; font-size: 10px; margin-top: 4px; }
.ai-badge { display: inline-block; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 8px; margin-bottom: 4px; }
.lock-info { background: var(--vscode-editorWarning-background, #3a3d41); color: var(--vscode-editorWarning-foreground, #dcdcaa); font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-bottom: 6px; }
.proc-box { background: var(--vscode-textBlockQuote-background, #181818); border-radius: 4px; padding: 8px; margin-top: 4px; }
.proc-msg { color: #4ec9b0; font-size: 11px; margin-bottom: 6px; }
.progress-bar { background: var(--vscode-editorWidget-background, #333); height: 4px; border-radius: 2px; overflow: hidden; }
.progress-fill { background: #4ec9b0; height: 4px; border-radius: 2px; transition: width 0.3s; }
.code-changes { color: var(--vscode-textPreformat-foreground, #ce9178); font-size: 10px; margin-top: 4px; }
.ai-result { background: var(--vscode-textBlockQuote-background, #181818); border-radius: 4px; padding: 6px; margin-top: 4px; font-size: 10px; color: var(--vscode-descriptionForeground, #999); max-height: 60px; overflow-y: auto; }
.review-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-approve { background: #238636; color: #fff; border: none; padding: 5px 14px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; }
.btn-approve:hover { background: #2ea043; }
.btn-reject { background: #da3633; color: #fff; border: none; padding: 5px 14px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; opacity: 0.9; }
.btn-reject:hover { background: #f85149; }
.completed-info { font-size: 9px; color: var(--vscode-descriptionForeground, #858585); margin-top: 4px; }
.statusbar { display: flex; align-items: center; gap: 20px; padding: 0 12px; height: 22px; background: var(--vscode-statusBar-background, #007acc); color: var(--vscode-statusBar-foreground, #fff); font-size: 11px; }
.sb-right { margin-left: auto; }
.modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal.hidden { display: none; }
.modal-content { background: var(--vscode-editorWidget-background, #252526); border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 8px; padding: 20px; width: 400px; }
.modal-content h3 { color: var(--vscode-foreground, #fff); margin-bottom: 12px; font-size: 14px; }
.modal-content input, .modal-content textarea { width: 100%; background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #fff); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 4px; padding: 8px; margin-bottom: 10px; font-size: 12px; font-family: inherit; resize: vertical; }
.modal-content input:focus, .modal-content textarea:focus { outline: 1px solid var(--vscode-focusBorder, #007acc); border-color: var(--vscode-focusBorder, #007acc); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.modal-wide { width: 600px; max-width: 90%; }
.approval-warning { background: rgba(204,167,0,0.15); border: 1px solid #cca700; color: #cca700; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 11px; }
.approval-field { display: flex; gap: 8px; margin-bottom: 8px; font-size: 12px; }
.approval-label { color: var(--vscode-descriptionForeground, #858585); min-width: 70px; font-weight: 600; }
.approval-input { background: var(--vscode-textBlockQuote-background, #1e1e1e); border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 4px; padding: 8px; font-size: 11px; color: var(--vscode-textPreformat-foreground, #ce9178); max-height: 200px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0; flex: 1; }
.op-log { margin-top: 8px; max-height: 400px; overflow-y: auto; }
.op-entry { background: var(--vscode-textBlockQuote-background, #181818); border: 1px solid var(--vscode-panel-border, #333); border-radius: 4px; padding: 8px; margin-bottom: 6px; font-size: 11px; }
.op-entry-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.op-type { font-weight: 600; color: var(--vscode-textLink-foreground, #4fc1ff); }
.op-target { color: var(--vscode-textPreformat-foreground, #ce9178); word-break: break-all; }
.op-status { font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: bold; }
.op-status-success { background: #238636; color: #fff; }
.op-status-error { background: #da3633; color: #fff; }
.op-status-rejected { background: rgba(241,76,76,0.2); color: #f14c4c; }
.op-status-approved { background: #238636; color: #fff; }
.op-status-pending { background: rgba(204,167,0,0.2); color: #cca700; }
.op-highrisk { background: rgba(241,76,76,0.2); color: #f14c4c; font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: bold; }
.op-diff { margin-top: 6px; }
.op-diff-label { font-size: 10px; color: var(--vscode-descriptionForeground, #858585); margin-bottom: 2px; }
.op-diff-content { background: var(--vscode-textCodeBlock-background, #0c0c0c); border: 1px solid var(--vscode-panel-border, #333); border-radius: 3px; padding: 6px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 10px; max-height: 150px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
.op-diff-before { color: #f14c4c; }
.op-diff-after { color: #6a9955; }
.btn-details { background: var(--vscode-button-background, #264f78); color: var(--vscode-button-foreground, #4fc1ff); border: none; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; }
.btn-details:hover { background: var(--vscode-button-hoverBackground, #306099); }
.btn-diff { background: var(--vscode-button-background, #264f78); color: var(--vscode-button-foreground, #4fc1ff); border: none; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; margin-top: 6px; }
.btn-diff:hover { background: var(--vscode-button-hoverBackground, #306099); }
.reject-warning { background: rgba(204,167,0,0.15); border: 1px solid #cca700; color: #cca700; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 11px; }
.reject-options { display: flex; flex-direction: column; gap: 8px; }
.reject-option { background: var(--vscode-editor-background, #1e1e1e); border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 6px; padding: 10px 12px; cursor: pointer; text-align: left; color: var(--vscode-foreground, #ccc); transition: border-color 0.15s; }
.reject-option:hover { border-color: var(--vscode-focusBorder, #007acc); background: var(--vscode-list-hoverBackground, #252526); }
.reject-option.reject-option-danger:hover { border-color: #f14c4c; }
.reject-opt-title { display: block; font-size: 13px; font-weight: 600; color: var(--vscode-foreground, #fff); margin-bottom: 2px; }
.reject-option.reject-option-danger .reject-opt-title { color: #f14c4c; }
.reject-opt-desc { display: block; font-size: 10px; color: var(--vscode-descriptionForeground, #858585); }
.pending-approval { background: rgba(204,167,0,0.15); border: 1px solid #cca700; border-radius: 4px; padding: 8px; margin-top: 6px; }
.pending-approval-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.pending-approval-icon { width: 8px; height: 8px; border-radius: 50%; background: #cca700; animation: pulse 1.5s infinite; flex-shrink: 0; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.pending-approval-text { color: #cca700; font-size: 11px; font-weight: 600; }
.pending-approval-target { color: var(--vscode-textPreformat-foreground, #ce9178); font-size: 10px; word-break: break-all; margin-bottom: 6px; }
.btn-review { background: #cca700; color: var(--vscode-editor-background, #1e1e1e); border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; }
.btn-review:hover { background: #e0b800; }
`;
    }
    dashboardJs() {
        // Use string concatenation to avoid ${} escaping issues in template literals
        return [
            "var vscode = acquireVsCodeApi();",
            "var runningMods = [];",
            "",
            "function esc(s) {",
            "  if (s === undefined || s === null) return '';",
            "  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');",
            "}",
            "",
            "function renderTasks(data) {",
            "  runningMods = data.runningModules || [];",
            "  allTasks = data.tasks || [];",
            "  var schedActive = data.schedulerActive;",
            "  var dot = document.getElementById('sched-dot');",
            "  var stxt = document.getElementById('sched-text');",
            "  var sbar = document.getElementById('sb-sched');",
            "  var slock = document.getElementById('sb-locked');",
            "  var btnToggle = document.getElementById('btn-toggle');",
            "  if (schedActive) {",
            "    dot.className = 'status-dot'; stxt.textContent = '调度器：运行中';",
            "    sbar.textContent = 'AI 调度器：运行中'; btnToggle.textContent = '暂停调度器';",
            "  } else {",
            "    dot.className = 'status-dot inactive'; stxt.textContent = '调度器：已暂停';",
            "    sbar.textContent = 'AI 调度器：已暂停'; btnToggle.textContent = '恢复调度器';",
            "  }",
            "  slock.textContent = runningMods.length > 0 ? '锁定：' + runningMods.map(function(m){return '#'+m;}).join(', ') : '锁定：无';",
            "",
            "  var cols = {todo:[], inProgress:[], pendingReview:[], completed:[], terminated:[]};",
            "  (data.tasks || []).forEach(function(t) { if (cols[t.status]) cols[t.status].push(t); });",
            "  // Store pending approval BEFORE rendering cards so cards can show the indicator",
            "  renderApproval(data);",
            "  ['todo','inProgress','pendingReview','completed','terminated'].forEach(function(s) {",
            "    document.getElementById('col-' + s).innerHTML = cols[s].map(renderCard).join('');",
            "    document.getElementById('count-' + s).textContent = cols[s].length;",
            "  });",
            "  bindCardEvents();",
            "}",
            "",
            "function renderCard(task) {",
            "  var cls = 'card';",
            "  if (task.hasConflict) cls += ' card-conflict';",
            "  if (task.status === 'completed') cls += ' card-completed';",
            "  if (task.status === 'terminated') cls += ' card-terminated';",
            "  var h = '<div class=\"' + cls + '\" data-id=\"' + esc(task.id) + '\">';",
            "  h += '<div class=\"card-title\">' + esc(task.id) + ' ' + esc(task.title) + '</div>';",
            "  h += '<div class=\"card-desc\">' + esc(task.description) + '</div>';",
            "  // Module tags",
            "  if (task.modules.length > 0) {",
            "    h += '<div class=\"card-modules\">';",
            "    task.modules.forEach(function(m) {",
            "      var locked = runningMods.indexOf(m) >= 0;",
            "      h += '<span class=\"module-tag' + (locked ? ' locked' : '') + '\">#' + esc(m) + '</span>';",
            "    });",
            "    h += '</div>';",
            "  }",
            "  // Status-specific content",
            "  if (task.status === 'todo') {",
            "    if (!task.metadataExtracted) {",
            "      h += '<div class=\"extracting-tag\">分析模块中...</div>';",
            "    } else if (task.hasConflict) {",
            "      h += '<div class=\"conflict-warn\">锁定：等待 ' + task.conflictingModules.map(function(m){return '#'+m;}).join(', ') + '</div>';",
            "    } else {",
            "      h += '<div class=\"ready-tag\">就绪</div>';",
            "    }",
            "  } else if (task.status === 'inProgress') {",
            "    h += '<div class=\"ai-badge\">AI 代理</div>';",
            "    if (task.modules.length > 0) {",
            "      h += '<div class=\"lock-info\">锁定：' + task.modules.map(function(m){return '#'+m;}).join(', ') + '</div>';",
            "    }",
            "    // Check if this task has a pending high-risk approval",
            "    if (currentApproval && currentApproval.taskId === task.id) {",
            "      h += '<div class=\"pending-approval\">';",
            "      h += '<div class=\"pending-approval-header\">';",
            "      h += '<span class=\"pending-approval-icon\"></span>';",
            "      h += '<span class=\"pending-approval-text\">等待审批</span>';",
            "      h += '</div>';",
            "      h += '<div class=\"pending-approval-target\">' + esc(currentApproval.type) + ': ' + esc(currentApproval.target) + '</div>';",
            "      h += '<button class=\"btn-review\" data-review=\"' + esc(task.id) + '\">查看</button>';",
            "      h += '</div>';",
            "    } else {",
            "      h += '<div class=\"proc-box\">';",
            "      h += '<div class=\"proc-msg\">' + esc(task.processingMessage || '处理中...') + '</div>';",
            "      h += '<div class=\"progress-bar\"><div class=\"progress-fill\" style=\"width:' + (task.processingProgress || 0) + '%\"></div></div>';",
            "      h += '</div>';",
            "    }",
            "  } else if (task.status === 'pendingReview') {",
            "    if (task.codeChanges) {",
            "      h += '<div class=\"code-changes\">+' + task.codeChanges.additions + ' / -' + task.codeChanges.deletions + ' lines</div>';",
            "    }",
            "    if (task.aiResult) {",
            "      h += '<div class=\"ai-result\">' + esc(task.aiResult) + '</div>';",
            "    }",
            "    if (task.operations && task.operations.length > 0) {",
            "      h += '<div class=\"code-changes\">操作数：' + task.operations.length + '</div>';",
            "    }",
            "    h += '<div class=\"review-actions\">';",
            "    h += '<button class=\"btn-details\" data-details=\"' + esc(task.id) + '\">查看详情</button>';",
            "    h += '<button class=\"btn-approve\" data-approve=\"' + esc(task.id) + '\">批准</button>';",
            "    h += '<button class=\"btn-reject\" data-reject-open=\"' + esc(task.id) + '\">拒绝</button>';",
            "    h += '</div>';",
            "  } else if (task.status === 'completed') {",
            "    if (task.completedAt) { h += '<div class=\"completed-info\">已完成：' + esc(task.completedAt) + '</div>'; }",
            "    if (task.codeChanges) { h += '<div class=\"code-changes\">+' + task.codeChanges.additions + ' / -' + task.codeChanges.deletions + ' 行</div>'; }",
            "  } else if (task.status === 'terminated') {",
            "    h += '<div class=\"card-desc\" style=\"color:#f14c4c;\">已终止</div>';",
            "    if (task.aiResult) { h += '<div class=\"ai-result\">' + esc(task.aiResult) + '</div>'; }",
            "    if (task.completedAt) { h += '<div class=\"completed-info\">终止时间：' + esc(task.completedAt) + '</div>'; }",
            "  }",
            "  h += '</div>';",
            "  return h;",
            "}",
            "",
            "function bindCardEvents() {",
            "  document.querySelectorAll('[data-approve]').forEach(function(btn) {",
            "    btn.onclick = function() { vscode.postMessage({type:'approve', taskId: btn.getAttribute('data-approve')}); };",
            "  });",
            "  document.querySelectorAll('[data-reject-open]').forEach(function(btn) {",
            "    btn.onclick = function() { openRejectModal(btn.getAttribute('data-reject-open')); };",
            "  });",
            "  document.querySelectorAll('[data-details]').forEach(function(btn) {",
            "    btn.onclick = function() { showDetails(btn.getAttribute('data-details')); };",
            "  });",
            "  document.querySelectorAll('[data-review]').forEach(function(btn) {",
            "    btn.onclick = function() { openApprovalModal(); };",
            "  });",
            "}",
            "",
            "// Approval modal — opened manually from task card when a high-risk operation is pending",
            "var approvalModal = document.getElementById('approval-modal');",
            "var currentApproval = null;",
            "function renderApproval(data) {",
            "  // Store the pending approval but do NOT auto-show the modal.",
            "  // The user sees a 'Pending Approval' indicator on the task card",
            "  // and clicks 'Review' to open the modal manually.",
            "  if (data.pendingApproval) {",
            "    currentApproval = data.pendingApproval;",
            "  } else {",
            "    currentApproval = null;",
            "    approvalModal.classList.add('hidden');",
            "  }",
            "}",
            "function openApprovalModal() {",
            "  if (!currentApproval) return;",
            "  document.getElementById('apr-type').textContent = currentApproval.type;",
            "  document.getElementById('apr-target').textContent = currentApproval.target;",
            "  document.getElementById('apr-desc').textContent = currentApproval.description;",
            "  document.getElementById('apr-input').textContent = currentApproval.input;",
            "  approvalModal.classList.remove('hidden');",
            "}",
            "document.getElementById('apr-approve').onclick = function() {",
            "  if (currentApproval) {",
            "    vscode.postMessage({type:'approveOperation', operationId: currentApproval.operationId});",
            "  }",
            "  approvalModal.classList.add('hidden');",
            "};",
            "document.getElementById('apr-reject').onclick = function() {",
            "  if (currentApproval) {",
            "    vscode.postMessage({type:'rejectOperation', operationId: currentApproval.operationId});",
            "  }",
            "  approvalModal.classList.add('hidden');",
            "};",
            "",
            "// Details modal — shows the full operation log for a task",
            "var detailsModal = document.getElementById('details-modal');",
            "var allTasks = [];",
            "function showDetails(taskId) {",
            "  var task = allTasks.filter(function(t) { return t.id === taskId; })[0];",
            "  if (!task) return;",
            "  document.getElementById('details-title').textContent = task.id + ' ' + task.title + ' — 操作记录';",
            "  var body = '<div class=\"op-log\">';",
            "  if (!task.operations || task.operations.length === 0) {",
            "    body += '<div style=\"color:#858585;padding:12px;\">无操作记录。</div>';",
            "  } else {",
            "    task.operations.forEach(function(op) {",
            "      body += '<div class=\"op-entry\">';",
            "      body += '<div class=\"op-entry-header\">';",
            "      body += '<span class=\"op-type\">' + esc(op.type) + '</span>';",
            "      if (op.isHighRisk) { body += '<span class=\"op-highrisk\">高危</span>'; }",
            "      body += '<span class=\"op-status op-status-' + op.status + '\">' + op.status.toUpperCase() + '</span>';",
            "      body += '</div>';",
            "      body += '<div class=\"op-target\">' + esc(op.target) + '</div>';",
            "      if (op.output) { body += '<div class=\"op-diff\"><div class=\"op-diff-label\">输出：</div><div class=\"op-diff-content\">' + esc(op.output) + '</div></div>'; }",
            "      if (op.afterContent !== undefined) {",
            "        if (op.beforeContent !== undefined) {",
            "          body += '<div class=\"op-diff\"><div class=\"op-diff-label\">修改前：</div><div class=\"op-diff-content op-diff-before\">' + esc(op.beforeContent.substring(0, 2000)) + '</div></div>';",
            "        }",
            "        body += '<div class=\"op-diff\"><div class=\"op-diff-label\">修改后：</div><div class=\"op-diff-content op-diff-after\">' + esc(op.afterContent.substring(0, 2000)) + '</div></div>';",
            "        body += '<button class=\"btn-diff\" data-diff-task=\"' + esc(task.id) + '\" data-diff-path=\"' + esc(op.target) + '\">查看差异（Diff 视图）</button>';",
            "      }",
            "      body += '</div>';",
            "    });",
            "  }",
            "  body += '</div>';",
            "  document.getElementById('details-body').innerHTML = body;",
            "  // Bind diff view buttons",
            "  document.querySelectorAll('[data-diff-task]').forEach(function(btn) {",
            "    btn.onclick = function() {",
            "      vscode.postMessage({type:'viewDiff', taskId: btn.getAttribute('data-diff-task'), filePath: btn.getAttribute('data-diff-path')});",
            "    };",
            "  });",
            "  detailsModal.classList.remove('hidden');",
            "}",
            "document.getElementById('details-close').onclick = function() { detailsModal.classList.add('hidden'); };",
            "",
            "// Reject options modal — 3 choices: Cancel, Reprocess, Rollback",
            "var rejectModal = document.getElementById('reject-modal');",
            "var rejectTaskId = null;",
            "function openRejectModal(taskId) {",
            "  rejectTaskId = taskId;",
            "  rejectModal.classList.remove('hidden');",
            "}",
            "document.getElementById('reject-cancel').onclick = function() {",
            "  rejectTaskId = null;",
            "  rejectModal.classList.add('hidden');",
            "};",
            "document.getElementById('reject-reprocess').onclick = function() {",
            "  if (rejectTaskId) { vscode.postMessage({type:'reject', taskId: rejectTaskId}); }",
            "  rejectTaskId = null;",
            "  rejectModal.classList.add('hidden');",
            "};",
            "document.getElementById('reject-rollback').onclick = function() {",
            "  if (rejectTaskId) { vscode.postMessage({type:'rollbackTask', taskId: rejectTaskId}); }",
            "  rejectTaskId = null;",
            "  rejectModal.classList.add('hidden');",
            "};",
            "",
            "// Modal",
            "var modal = document.getElementById('modal');",
            "document.getElementById('btn-add').onclick = function() {",
            "  modal.classList.remove('hidden');",
            "  document.getElementById('inp-title').value = '';",
            "  document.getElementById('inp-desc').value = '';",
            "  document.getElementById('inp-title').focus();",
            "};",
            "document.getElementById('modal-cancel').onclick = function() { modal.classList.add('hidden'); };",
            "document.getElementById('modal-ok').onclick = function() {",
            "  var t = document.getElementById('inp-title').value.trim();",
            "  var d = document.getElementById('inp-desc').value.trim();",
            "  if (!t) return;",
            "  vscode.postMessage({type:'addTask', title: t, description: d});",
            "  modal.classList.add('hidden');",
            "};",
            "document.getElementById('inp-title').addEventListener('keydown', function(e) {",
            "  if (e.key === 'Enter') { document.getElementById('inp-desc').focus(); }",
            "});",
            "document.getElementById('inp-desc').addEventListener('keydown', function(e) {",
            "  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { document.getElementById('modal-ok').click(); }",
            "});",
            "",
            "// Toolbar buttons",
            "document.getElementById('btn-toggle').onclick = function() { vscode.postMessage({type:'toggleScheduler'}); };",
            "document.getElementById('btn-clear').onclick = function() { vscode.postMessage({type:'clearCompleted'}); };",
            "",
            "// Listen for updates from extension",
            "window.addEventListener('message', function(e) {",
            "  var msg = e.data;",
            "  if (msg.type === 'update') { renderTasks(msg); }",
            "});",
            "",
            "// Request initial data",
            "vscode.postMessage({type:'refresh'});"
        ].join('\n');
    }
    /* ========================================================================
       SIDEBAR HTML (Compact Overview)
       ======================================================================== */
    getSidebarHtml(webview) {
        const nonce = getNonce();
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--vscode-sideBar-background, #252526); color: var(--vscode-foreground, #cccccc); font-family: var(--vscode-font-family, sans-serif); font-size: 12px; padding: 8px; }
.sb-header { font-size: 14px; font-weight: 600; color: var(--vscode-foreground, #fff); margin-bottom: 12px; }
.sb-status { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--vscode-foreground, #cccccc); }
.sb-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ec9b0; flex-shrink: 0; }
.sb-dot.inactive { background: #f14c4c; }
.sb-counts { margin-bottom: 12px; }
.sb-count-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #333); }
.sb-count-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sb-count-label { flex: 1; font-size: 11px; color: var(--vscode-foreground, #cccccc); }
.sb-count-num { font-size: 12px; font-weight: bold; color: var(--vscode-foreground, #cccccc); }
.sb-actions { display: flex; flex-direction: column; gap: 6px; }
.sb-btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; text-align: left; }
.sb-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.sb-btn.secondary { background: var(--vscode-button-secondaryBackground, #3c3c3c); color: var(--vscode-button-secondaryForeground, #ccc); }
.sb-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #4c4c4c); }
.sb-locked { margin-top: 8px; font-size: 10px; color: var(--vscode-descriptionForeground, #858585); }
</style>
</head>
<body>
<div class="sb-header">AI 任务管线</div>
<div class="sb-status">
  <span class="sb-dot" id="sb-dot"></span>
  <span id="sb-status-text">调度器：运行中</span>
</div>
<div class="sb-counts" id="sb-counts"></div>
<div class="sb-locked" id="sb-locked"></div>
<div class="sb-actions">
  <button class="sb-btn" id="sb-open">打开面板</button>
  <button class="sb-btn" id="sb-add">+ 添加任务</button>
  <button class="sb-btn secondary" id="sb-toggle">切换调度器</button>
  <button class="sb-btn secondary" id="sb-clear">清除已完成</button>
</div>
<script nonce="${nonce}">
${this.sidebarJs()}
</script>
</body>
</html>`;
    }
    sidebarJs() {
        return [
            "var vscode = acquireVsCodeApi();",
            "var pools = [",
            "  {key:'todo', label:'待处理', color:'#858585'},",
            "  {key:'inProgress', label:'处理中', color:'#007acc'},",
            "  {key:'pendingReview', label:'待审核', color:'#cca700'},",
            "  {key:'completed', label:'已完成', color:'#89d185'},",
            "  {key:'terminated', label:'已终止', color:'#f14c4c'}",
            "];",
            "function render(data) {",
            "  var dot = document.getElementById('sb-dot');",
            "  var txt = document.getElementById('sb-status-text');",
            "  if (data.schedulerActive) { dot.className='sb-dot'; txt.textContent='调度器：运行中'; }",
            "  else { dot.className='sb-dot inactive'; txt.textContent='调度器：已暂停'; }",
            "  var counts = data.tasks || [];",
            "  var html = '';",
            "  pools.forEach(function(p) {",
            "    var n = counts.filter(function(t){return t.status===p.key;}).length;",
            "    html += '<div class=\"sb-count-row\"><span class=\"sb-count-dot\" style=\"background:'+p.color+'\"></span><span class=\"sb-count-label\">'+p.label+'</span><span class=\"sb-count-num\">'+n+'</span></div>';",
            "  });",
            "  document.getElementById('sb-counts').innerHTML = html;",
            "  var rm = data.runningModules || [];",
            "  document.getElementById('sb-locked').textContent = rm.length > 0 ? '锁定：' + rm.map(function(m){return '#'+m;}).join(', ') : '无锁定模块';",
            "}",
            "document.getElementById('sb-open').onclick = function() { vscode.postMessage({type:'openDashboard'}); };",
            "document.getElementById('sb-add').onclick = function() { vscode.postMessage({type:'openDashboard'}); setTimeout(function(){vscode.postMessage({type:'refresh'});},100); };",
            "document.getElementById('sb-toggle').onclick = function() { vscode.postMessage({type:'toggleScheduler'}); };",
            "document.getElementById('sb-clear').onclick = function() { vscode.postMessage({type:'clearCompleted'}); };",
            "window.addEventListener('message', function(e) {",
            "  if (e.data.type === 'update') { render(e.data); }",
            "});",
            "vscode.postMessage({type:'refresh'});"
        ].join('\n');
    }
}
exports.WebviewProvider = WebviewProvider;
//# sourceMappingURL=webviewProvider.js.map