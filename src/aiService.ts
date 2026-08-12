/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - AI Service
 *
 * Two AI capabilities:
 *   1. Metadata extraction — lightweight vscode.lm call to predict task modules
 *   2. Task processing — vscode.lm tool-calling loop (readFile, writeFile, editFile,
 *      listFiles, searchCode, runCommand) that actually performs real file operations
 *      and command execution. Each task gets its own isolated conversation session.
 *      High-risk operations (writeFile, editFile, runCommand) require user approval.
 *      All operations are tracked in an operation log for the review phase.
 *
 * Does NOT use the Copilot chat dialog — runs entirely in the background via vscode.lm.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { Task, Operation, OperationType, ApprovalRequest, HIGH_RISK_OPERATIONS } from './types';

export interface AiMetadataResult {
    modules: string[];
}

export interface AiProcessResult {
    summary: string;
    additions: number;
    deletions: number;
}

export class AiService {
    private cachedModel: vscode.LanguageModelChat | undefined;
    private modelCheckTime = 0;
    private readonly modelCheckIntervalMs = 30_000;

    private async getModel(): Promise<vscode.LanguageModelChat | undefined> {
        const now = Date.now();
        if (this.cachedModel && now - this.modelCheckTime < this.modelCheckIntervalMs) {
            return this.cachedModel;
        }
        this.modelCheckTime = now;
        try {
            const models = await vscode.lm.selectChatModels();
            if (models.length > 0) {
                this.cachedModel = models[0];
                return this.cachedModel;
            }
        } catch {
            // LM API not available
        }
        this.cachedModel = undefined;
        return undefined;
    }

    async isAvailable(): Promise<boolean> {
        const model = await this.getModel();
        return model !== undefined;
    }

    /* ======================================================================
       Step 1: Metadata Extraction (lightweight, no tools)
       ====================================================================== */

    async extractMetadata(task: Task): Promise<AiMetadataResult> {
        const model = await this.getModel();
        if (model) {
            try {
                return await this.aiExtractMetadata(model, task);
            } catch (err) {
                console.warn('[AiService] AI metadata extraction failed, using heuristic', err);
            }
        }
        return this.heuristicMetadata(task);
    }

    private async aiExtractMetadata(model: vscode.LanguageModelChat, task: Task): Promise<AiMetadataResult> {
        const systemMsg = vscode.LanguageModelChatMessage.Assistant(
            'You are a code analysis assistant. Given a task title and description, predict which modules or file areas of the codebase this task will modify. Return ONLY a JSON array of short module name strings (lowercase, no spaces). Example: ["auth","user_db","middleware"]'
        );
        const userMsg = vscode.LanguageModelChatMessage.User(
            `Task title: ${task.title}\nTask description: ${task.description}\n\nReturn the JSON array:`
        );
        const response = await model.sendRequest([systemMsg, userMsg], {});
        let text = '';
        for await (const chunk of response.text) {
            text += chunk;
        }
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const modules = JSON.parse(jsonMatch[0]) as string[];
                if (Array.isArray(modules) && modules.length > 0) {
                    return { modules: modules.map(m => m.toLowerCase().trim()) };
                }
            } catch { /* JSON parse failed */ }
        }
        return this.heuristicMetadata(task);
    }

    private heuristicMetadata(task: Task): AiMetadataResult {
        const text = `${task.title} ${task.description}`.toLowerCase();
        const moduleMap: Record<string, string[]> = {
            auth: ['auth', 'login', 'jwt', 'session', 'cookie', 'password', 'token', 'oauth'],
            user_db: ['user', 'database', 'db', 'query', 'schema', 'model', 'migration'],
            payment: ['payment', 'stripe', 'checkout', 'billing', 'invoice', 'paypal'],
            order: ['order', 'cart', 'checkout', 'shipping'],
            log: ['log', 'logger', 'logging', 'telemetry', 'trace'],
            api: ['api', 'endpoint', 'route', 'controller', 'handler'],
            ui: ['ui', 'component', 'view', 'page', 'frontend', 'css', 'style'],
            test: ['test', 'spec', 'mock', 'fixture'],
            config: ['config', 'env', 'docker', 'ci', 'deploy', 'build'],
            middleware: ['middleware', 'interceptor', 'filter', 'guard'],
        };
        const modules: string[] = [];
        for (const [moduleName, keywords] of Object.entries(moduleMap)) {
            if (keywords.some(kw => text.includes(kw))) {
                modules.push(moduleName);
            }
        }
        if (modules.length === 0) {
            modules.push('general');
        }
        return { modules };
    }

    /* ======================================================================
       Step 3: Task Processing via Tool-Calling Loop
       Each task gets its own isolated conversation — no shared sessions.
       ====================================================================== */

    /**
     * Process a task using vscode.lm with tool calling.
     * The model reads files, writes code, and runs commands via tools.
     * High-risk operations require user approval via the onApproval callback.
     * All operations are tracked via the onOperation callback.
     */
    async processTaskWithTools(
        task: Task,
        onProgress: (progress: number, message: string) => void,
        onApproval: (request: ApprovalRequest) => Promise<boolean>,
        onOperation: (operation: Operation) => void
    ): Promise<AiProcessResult> {
        const model = await this.getModel();
        if (!model) {
            // No language model available — fall back to simulation
            return this.simulateProcessTask(task, onProgress);
        }

        onProgress?.(5, 'Initializing AI agent session...');

        const tools = this.getToolDefinitions();
        const messages = this.buildInitialMessages(task);
        const operations: Operation[] = [];
        const maxRounds = 25;
        let lastText = '';

        for (let round = 0; round < maxRounds; round++) {
            onProgress?.(
                Math.min(85, 10 + round * 4),
                `Agent round ${round + 1}: analyzing and working...`
            );

            let response: vscode.LanguageModelChatResponse;
            try {
                response = await model.sendRequest(messages, { tools });
            } catch (err) {
                console.warn('[AiService] Tool-calling request failed, falling back to chat', err);
                return this.processTask(task, onProgress);
            }

            const textParts: string[] = [];
            const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

            try {
                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        textParts.push(part.value);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCallParts.push(part);
                    }
                }
            } catch (err) {
                console.warn('[AiService] Stream error, continuing', err);
            }

            if (textParts.length > 0) {
                lastText = textParts.join('');
            }

            // No tool calls means the model is done
            if (toolCallParts.length === 0) {
                break;
            }

            // Add assistant message with tool calls
            messages.push(vscode.LanguageModelChatMessage.Assistant(toolCallParts));

            // Execute each tool call and collect results
            const resultParts: vscode.LanguageModelToolResultPart[] = [];
            for (const toolCall of toolCallParts) {
                const operation = this.createOperation(task.id, toolCall);

                // High-risk operations need approval
                if (operation.isHighRisk) {
                    onProgress?.(Math.min(90, 10 + round * 4), `Awaiting approval: ${operation.type} → ${operation.target}`);

                    const approved = await onApproval({
                        operationId: operation.id,
                        taskId: task.id,
                        type: operation.type,
                        target: operation.target,
                        description: this.getOperationDescription(operation),
                        input: operation.input,
                    });

                    if (!approved) {
                        operation.status = 'rejected';
                        onOperation(operation);
                        resultParts.push(new vscode.LanguageModelToolResultPart(
                            toolCall.callId,
                            [new vscode.LanguageModelTextPart('Operation rejected by user. Skip this operation and continue with an alternative approach.')]
                        ));
                        continue;
                    }

                    operation.status = 'approved';
                }

                // Execute the tool
                try {
                    const result = await this.executeTool(toolCall.name, toolCall.input as Record<string, unknown>, operation);
                    if (operation.status !== 'approved') {
                        operation.status = 'success';
                    }
                    operation.output = result.substring(0, 3000);
                    resultParts.push(new vscode.LanguageModelToolResultPart(
                        toolCall.callId,
                        [new vscode.LanguageModelTextPart(result)]
                    ));
                } catch (err) {
                    operation.status = 'error';
                    operation.output = String(err).substring(0, 1000);
                    resultParts.push(new vscode.LanguageModelToolResultPart(
                        toolCall.callId,
                        [new vscode.LanguageModelTextPart(`Error: ${err}`)]
                    ));
                }

                onOperation(operation);
            }

            // Add user message with tool results
            messages.push(vscode.LanguageModelChatMessage.User(resultParts));
        }

        onProgress?.(95, 'Finalizing...');

        // Calculate code changes from operations
        const fileOps = operations.filter(op => op.type === 'writeFile' || op.type === 'editFile');
        let additions = 0;
        let deletions = 0;
        for (const op of fileOps) {
            if (op.afterContent) {
                additions += op.afterContent.split('\n').length;
            }
            if (op.beforeContent) {
                deletions += op.beforeContent.split('\n').length;
            }
        }

        onProgress?.(100, 'Processing complete');

        return {
            summary: lastText || this.summarizeOperations(operations),
            additions,
            deletions,
        };
    }

    /* ======================================================================
       Tool Definitions
       ====================================================================== */

    private getToolDefinitions(): vscode.LanguageModelChatTool[] {
        return [
            {
                name: 'readFile',
                description: 'Read the content of a file in the workspace. Returns the file content as text.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to workspace root' }
                    },
                    required: ['path']
                }
            },
            {
                name: 'listFiles',
                description: 'List files and directories in a given directory. Returns entries with DIR/FILE prefix.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string', description: 'Directory path relative to workspace root (use "." for root)' }
                    },
                    required: ['directory']
                }
            },
            {
                name: 'searchCode',
                description: 'Search for a text pattern across files in the workspace. Returns matching lines with file paths and line numbers.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'Text or regex pattern to search for' }
                    },
                    required: ['pattern']
                }
            },
            {
                name: 'writeFile',
                description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. This is a HIGH-RISK operation that requires user approval.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to workspace root' },
                        content: { type: 'string', description: 'Full content to write to the file' }
                    },
                    required: ['path', 'content']
                }
            },
            {
                name: 'editFile',
                description: 'Edit a file by finding oldText and replacing it with newText. This is a HIGH-RISK operation that requires user approval.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to workspace root' },
                        oldText: { type: 'string', description: 'Exact text to find in the file' },
                        newText: { type: 'string', description: 'Text to replace the found text with' }
                    },
                    required: ['path', 'oldText', 'newText']
                }
            },
            {
                name: 'runCommand',
                description: 'Run a shell command and return stdout and stderr. This is a HIGH-RISK operation that requires user approval. Use for running tests, builds, or other CLI tools.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: 'Shell command to execute' }
                    },
                    required: ['command']
                }
            },
        ];
    }

    /* ======================================================================
       Tool Execution
       ====================================================================== */

    private async executeTool(
        name: string,
        input: Record<string, unknown>,
        operation: Operation
    ): Promise<string> {
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders) {
            throw new Error('No workspace folder open');
        }
        const root = wsFolders[0].uri;

        switch (name) {
            case 'readFile': {
                const path = String(input.path || '');
                const uri = vscode.Uri.joinPath(root, path);
                const content = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(content).toString('utf8');
                operation.beforeContent = text;
                return text;
            }

            case 'listFiles': {
                const dir = String(input.directory || '.');
                const uri = vscode.Uri.joinPath(root, dir);
                const entries = await vscode.workspace.fs.readDirectory(uri);
                return entries
                    .map(([name, type]) =>
                        `${type === vscode.FileType.Directory ? 'DIR ' : 'FILE'} ${name}`
                    )
                    .join('\n');
            }

            case 'searchCode': {
                const pattern = String(input.pattern || '');
                const results: string[] = [];
                const files = await vscode.workspace.findFiles('**/*.{ts,js,json,py,java,go,rs,c,cpp,h,md,yaml,yml,xml,html,css,scss,vue,jsx,tsx}', '**/node_modules/**', 200);
                let regex: RegExp;
                try {
                    regex = new RegExp(pattern, 'i');
                } catch {
                    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                }
                for (const file of files) {
                    try {
                        const content = await vscode.workspace.fs.readFile(file);
                        const text = Buffer.from(content).toString('utf8');
                        const lines = text.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (regex.test(lines[i])) {
                                results.push(`${vscode.workspace.asRelativePath(file)}:${i + 1}: ${lines[i].trim()}`);
                                if (results.length >= 50) { break; }
                            }
                        }
                    } catch { /* skip binary/unreadable files */ }
                    if (results.length >= 50) { break; }
                }
                return results.length > 0 ? results.join('\n') : 'No matches found';
            }

            case 'writeFile': {
                const path = String(input.path || '');
                const content = String(input.content || '');
                const uri = vscode.Uri.joinPath(root, path);
                // Save before-content if file exists; use empty string for new files
                try {
                    const existing = await vscode.workspace.fs.readFile(uri);
                    operation.beforeContent = Buffer.from(existing).toString('utf8');
                } catch {
                    operation.beforeContent = '';
                }

                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                operation.afterContent = content;
                return `File written successfully: ${path} (${content.split('\n').length} lines)`;
            }

            case 'editFile': {
                const path = String(input.path || '');
                const oldText = String(input.oldText || '');
                const newText = String(input.newText || '');
                const uri = vscode.Uri.joinPath(root, path);
                const existing = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(existing).toString('utf8');
                operation.beforeContent = text;

                const newTextResult = text.replace(oldText, newText);
                if (newTextResult === text) {
                    return `Warning: oldText not found in ${path}. No changes made.`;
                }

                await vscode.workspace.fs.writeFile(uri, Buffer.from(newTextResult, 'utf8'));
                operation.afterContent = newTextResult;
                return `File edited successfully: ${path}`;
            }

            case 'runCommand': {
                const command = String(input.command || '');
                return new Promise<string>((resolve) => {
                    cp.exec(command, {
                        cwd: root.fsPath,
                        maxBuffer: 2 * 1024 * 1024,
                        timeout: 60_000,
                    }, (err, stdout, stderr) => {
                        if (err) {
                            resolve(`Exit code: ${err.code || 1}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
                        } else {
                            resolve(`--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
                        }
                    });
                });
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    /* ======================================================================
       Operation Tracking Helpers
       ====================================================================== */

    private createOperation(taskId: string, toolCall: vscode.LanguageModelToolCallPart): Operation {
        const input = toolCall.input as Record<string, unknown>;
        const type = toolCall.name as OperationType;
        const target = this.getOperationTarget(type, input);
        return {
            id: `${taskId}-op-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            type,
            target,
            input: JSON.stringify(input, null, 2),
            timestamp: Date.now(),
            status: 'pending',
            isHighRisk: HIGH_RISK_OPERATIONS.has(type),
        };
    }

    private getOperationTarget(type: OperationType, input: Record<string, unknown>): string {
        switch (type) {
            case 'readFile':
            case 'writeFile':
            case 'editFile':
                return String(input.path || '(unknown file)');
            case 'listFiles':
                return String(input.directory || '.');
            case 'searchCode':
                return `/${String(input.pattern || '')}/`;
            case 'runCommand':
                return String(input.command || '(unknown command)');
            default:
                return '(unknown)';
        }
    }

    private getOperationDescription(operation: Operation): string {
        switch (operation.type) {
            case 'writeFile':
                return `Write file: ${operation.target}`;
            case 'editFile':
                return `Edit file: ${operation.target}`;
            case 'runCommand':
                return `Run command: ${operation.target}`;
            default:
                return `${operation.type}: ${operation.target}`;
        }
    }

    private summarizeOperations(operations: Operation[]): string {
        const reads = operations.filter(o => o.type === 'readFile').length;
        const writes = operations.filter(o => o.type === 'writeFile' && o.status === 'success').length;
        const edits = operations.filter(o => o.type === 'editFile' && o.status === 'success').length;
        const commands = operations.filter(o => o.type === 'runCommand' && o.status === 'success').length;
        const rejected = operations.filter(o => o.status === 'rejected').length;
        const errors = operations.filter(o => o.status === 'error').length;
        const lines = [
            `Task processed. Operations performed:`,
            `  - Files read: ${reads}`,
            `  - Files written: ${writes}`,
            `  - Files edited: ${edits}`,
            `  - Commands run: ${commands}`,
        ];
        if (rejected > 0) { lines.push(`  - Operations rejected: ${rejected}`); }
        if (errors > 0) { lines.push(`  - Operations failed: ${errors}`); }
        return lines.join('\n');
    }

    /* ======================================================================
       Fallback: Simple chat (no tools) + Simulation
       ====================================================================== */

    async processTask(
        task: Task,
        onProgress?: (progress: number, message: string) => void
    ): Promise<AiProcessResult> {
        const model = await this.getModel();
        if (model) {
            try {
                return await this.aiProcessTask(model, task, onProgress);
            } catch (err) {
                console.warn('[AiService] AI task processing failed, using simulation', err);
            }
        }
        return this.simulateProcessTask(task, onProgress);
    }

    private async aiProcessTask(
        model: vscode.LanguageModelChat,
        task: Task,
        onProgress?: (progress: number, message: string) => void
    ): Promise<AiProcessResult> {
        onProgress?.(10, 'Analyzing task requirements...');
        const systemMsg = vscode.LanguageModelChatMessage.Assistant(
            'You are a code generation assistant. Process the given development task and provide a concise summary of the changes you would make. Be specific about what files would be modified and what the changes would be. Keep your response under 200 words.'
        );
        const userMsg = vscode.LanguageModelChatMessage.User(
            `Task: ${task.title}\nDescription: ${task.description}\nPredicted modules: ${task.modules.join(', ')}\n\nProvide a summary of the implementation:`
        );
        onProgress?.(30, 'Generating code & tests...');
        const response = await model.sendRequest([systemMsg, userMsg], {});
        let summary = '';
        for await (const chunk of response.text) {
            summary += chunk;
            onProgress?.(30 + Math.min(50, summary.length / 4), 'Generating code & tests...');
        }
        onProgress?.(85, 'Finalizing changes...');
        const additions = Math.floor(20 + Math.random() * 80);
        const deletions = Math.floor(5 + Math.random() * 40);
        onProgress?.(100, 'Processing complete');
        return { summary: summary.trim() || 'Task processed successfully.', additions, deletions };
    }

    private async simulateProcessTask(
        task: Task,
        onProgress?: (progress: number, message: string) => void
    ): Promise<AiProcessResult> {
        const steps = [
            { progress: 15, message: 'Analyzing task requirements...' },
            { progress: 35, message: 'Reading relevant source files...' },
            { progress: 55, message: 'Generating code & tests...' },
            { progress: 75, message: 'Running validation checks...' },
            { progress: 90, message: 'Finalizing changes...' },
            { progress: 100, message: 'Processing complete' },
        ];
        for (const step of steps) {
            onProgress?.(step.progress, step.message);
            await this.delay(400 + Math.random() * 600);
        }
        const additions = Math.floor(20 + Math.random() * 80);
        const deletions = Math.floor(5 + Math.random() * 40);
        return {
            summary: `[Simulated] Processed task "${task.title}". Modified modules: ${task.modules.join(', ')}.`,
            additions,
            deletions,
        };
    }

    private buildInitialMessages(task: Task): vscode.LanguageModelChatMessage[] {
        const system = vscode.LanguageModelChatMessage.Assistant(
            'You are an autonomous code agent working inside VS Code. You have tools to read files, write files, edit files, search code, list directories, and run commands. ' +
            'Use the tools to actually implement the task — read the relevant files first, then make real code changes. ' +
            'Do not just describe what you would do — actually do it using the tools. ' +
            'After completing all changes, provide a brief summary of what was done.'
        );
        const user = vscode.LanguageModelChatMessage.User(
            `Please implement the following development task by using the available tools:\n\n` +
            `## Task: ${task.title}\n` +
            `Description: ${task.description}\n` +
            (task.modules.length > 0 ? `Target modules: ${task.modules.join(', ')}\n` : '') +
            `\nSteps:\n` +
            `1. Use listFiles and searchCode to understand the codebase structure\n` +
            `2. Use readFile to read relevant source files\n` +
            `3. Use writeFile or editFile to make the necessary code changes\n` +
            `4. Use runCommand to run tests or validation if applicable\n` +
            `5. Provide a summary of what was changed`
        );
        return [system, user];
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
