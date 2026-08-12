/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Task Manager
 * Manages the four-pool lifecycle: Todo → InProgress → PendingReview → Completed
 * Provides CRUD operations, status transitions, and workspace persistence.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Task, TaskStatus, Operation } from './types';

const STORAGE_KEY = 'aiTaskPipeline.tasks';

export class TaskManager implements vscode.Disposable {
    private tasks: Map<string, Task> = new Map();
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private context: vscode.ExtensionContext) {}

    dispose(): void {
        this._onDidChange.dispose();
    }

    async initialize(): Promise<void> {
        const stored = this.context.workspaceState.get<Task[]>(STORAGE_KEY);
        if (stored && stored.length > 0) {
            for (const task of stored) {
                // Reset any InProgress tasks back to Todo on reload
                if (task.status === TaskStatus.InProgress) {
                    task.status = TaskStatus.Todo;
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

    private persist(): void {
        this.context.workspaceState.update(STORAGE_KEY, Array.from(this.tasks.values()));
        this._onDidChange.fire();
    }

    createTask(title: string, description: string): Task {
        const task: Task = {
            id: this.generateId(),
            title,
            description,
            status: TaskStatus.Todo,
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

    getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    getAllTasks(): Task[] {
        return Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
    }

    getTasksByStatus(status: TaskStatus): Task[] {
        return this.getAllTasks().filter(t => t.status === status);
    }

    updateTask(id: string, updates: Partial<Task>): Task | undefined {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        Object.assign(task, updates);
        this.persist();
        return task;
    }

    moveToStatus(id: string, status: TaskStatus): Task | undefined {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        task.status = status;
        const now = Date.now();
        switch (status) {
            case TaskStatus.InProgress:
                task.startedAt = now;
                task.processingProgress = 0;
                task.processingMessage = 'Initializing AI agent...';
                break;
            case TaskStatus.PendingReview:
                task.reviewReadyAt = now;
                task.processingProgress = 100;
                task.processingMessage = '';
                break;
            case TaskStatus.Completed:
                task.completedAt = now;
                break;
            case TaskStatus.Terminated:
                task.completedAt = now;
                break;
        }
        this.persist();
        return task;
    }

    setModules(id: string, modules: string[]): Task | undefined {
        const task = this.tasks.get(id);
        if (!task) {
            return undefined;
        }
        task.modules = modules;
        task.metadataExtracted = true;
        this.persist();
        return task;
    }

    setProcessingProgress(id: string, progress: number, message: string): void {
        const task = this.tasks.get(id);
        if (!task) {
            return;
        }
        task.processingProgress = Math.min(100, Math.max(0, progress));
        task.processingMessage = message;
        // Fire event without persisting (too frequent)
        this._onDidChange.fire();
    }

    setAiResult(id: string, result: string, additions: number, deletions: number): Task | undefined {
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
    addOperation(id: string, operation: Operation): void {
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
        } else {
            task.operations.push(operation);
        }
        this._onDidChange.fire();
    }

    deleteTask(id: string): boolean {
        const deleted = this.tasks.delete(id);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }

    clearCompleted(): void {
        const toDelete: string[] = [];
        for (const [id, task] of this.tasks) {
            if (task.status === TaskStatus.Completed || task.status === TaskStatus.Terminated) {
                toDelete.push(id);
            }
        }
        toDelete.forEach(id => this.tasks.delete(id));
        this.persist();
    }

    private generateId(): string {
        const num = this.tasks.size + 100;
        return `TASK-${String(num).padStart(3, '0')}`;
    }
}
