/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Type Definitions
 *--------------------------------------------------------------------------------------------*/

export enum TaskStatus {
    Todo = 'todo',
    InProgress = 'inProgress',
    PendingReview = 'pendingReview',
    Completed = 'completed',
    Terminated = 'terminated'
}

/** Types of operations the AI agent can perform */
export type OperationType = 'readFile' | 'writeFile' | 'editFile' | 'listFiles' | 'searchCode' | 'runCommand';

/** Operation status */
export type OperationStatus = 'success' | 'error' | 'rejected' | 'pending' | 'approved';

/** A single operation performed by the AI agent during task processing */
export interface Operation {
    id: string;
    type: OperationType;
    /** Target: file path, directory, or command */
    target: string;
    /** Tool input as JSON string */
    input: string;
    /** Tool output (truncated for display) */
    output?: string;
    timestamp: number;
    status: OperationStatus;
    /** Whether this is a high-risk operation requiring approval */
    isHighRisk: boolean;
    /** File content before modification (for writeFile/editFile) */
    beforeContent?: string;
    /** File content after modification (for writeFile/editFile) */
    afterContent?: string;
}

/** Request for user approval of a high-risk operation */
export interface ApprovalRequest {
    operationId: string;
    taskId: string;
    type: OperationType;
    target: string;
    description: string;
    input: string;
}

export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    modules: string[];
    metadataExtracted: boolean;
    aiResult?: string;
    codeChanges?: { additions: number; deletions: number };
    createdAt: number;
    startedAt?: number;
    reviewReadyAt?: number;
    completedAt?: number;
    processingProgress: number;
    processingMessage: string;
    /** Operation log — all tool calls made during processing */
    operations: Operation[];
}

export interface WebviewPayload {
    type: 'update';
    tasks: TaskViewData[];
    runningModules: string[];
    schedulerActive: boolean;
    /** Pending approval request (null if none) */
    pendingApproval: ApprovalRequest | null;
}

export interface TaskViewData {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    modules: string[];
    metadataExtracted: boolean;
    hasConflict: boolean;
    conflictingModules: string[];
    isProcessing: boolean;
    processingProgress: number;
    processingMessage: string;
    aiResult?: string;
    codeChanges?: { additions: number; deletions: number };
    operations: Operation[];
    createdAt: string;
    completedAt?: string;
}

export type WebviewMessage =
    | { type: 'addTask'; title: string; description: string }
    | { type: 'approve'; taskId: string }
    | { type: 'reject'; taskId: string }
    | { type: 'rollbackTask'; taskId: string }
    | { type: 'refresh' }
    | { type: 'openDashboard' }
    | { type: 'toggleScheduler' }
    | { type: 'clearCompleted' }
    | { type: 'approveOperation'; operationId: string }
    | { type: 'rejectOperation'; operationId: string }
    | { type: 'viewDetails'; taskId: string }
    | { type: 'viewDiff'; taskId: string; filePath: string };

export const POOL_LABELS: Record<TaskStatus, string> = {
    [TaskStatus.Todo]: '待处理 (To Do)',
    [TaskStatus.InProgress]: '处理中 (In Progress)',
    [TaskStatus.PendingReview]: '待审核 (Pending Review)',
    [TaskStatus.Completed]: '已完成 (Completed)',
    [TaskStatus.Terminated]: '已终止 (Terminated)',
};

export const POOL_COLORS: Record<TaskStatus, string> = {
    [TaskStatus.Todo]: '#858585',
    [TaskStatus.InProgress]: '#007acc',
    [TaskStatus.PendingReview]: '#cca700',
    [TaskStatus.Completed]: '#89d185',
    [TaskStatus.Terminated]: '#f14c4c',
};

/** Operations that are considered high-risk and require user approval */
export const HIGH_RISK_OPERATIONS: Set<OperationType> = new Set([
    'runCommand',
]);
