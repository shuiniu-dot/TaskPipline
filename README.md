# AI Task Pipeline

AI-powered task scheduling extension for VS Code with module conflict avoidance.

## Features

- **Four-pool Kanban pipeline**: Todo → In Progress → Pending Review → Completed (plus Terminated)
- **Automatic module conflict detection**: Prevents two tasks from modifying the same code module simultaneously
- **AI agent integration**: Uses `vscode.lm` API for autonomous task processing with tool calling
- **Operation logging**: Full audit trail of all file reads, writes, edits, and commands
- **Diff viewer**: Compare before/after file changes using VS Code's native diff editor
- **High-risk operation approval**: Configurable approval workflow for dangerous operations
- **Rollback support**: Undo all AI file changes with one click

## Usage

1. Open the dashboard from the activity bar or command palette
2. Add tasks with title and description
3. The scheduler automatically picks non-conflicting tasks and processes them with AI
4. Review AI changes in the Pending Review column — click "View Details" to see the operation log
5. Click "View Diff" to open the native diff editor for any file modification
6. Approve, reject (with reprocess/rollback options), or terminate tasks
