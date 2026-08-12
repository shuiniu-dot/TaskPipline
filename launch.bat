@echo off
setlocal
title AI Task Pipeline - Dev Launch

echo ========================================
echo  AI Task Pipeline - Launching VS Code
echo ========================================
echo.

:: Compile extension
echo [1/2] Compiling extension...
cd /d "c:\Users\BY2-21\Desktop\vscode\ai-task-pipeline"
call npx tsc -p ./
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Compilation failed!
    pause
    exit /b 1
)
echo      Compilation OK.

:: Launch VS Code with extension
echo.
echo [2/2] Launching VS Code with extension...
set "VSCODE_SKIP_PRELAUNCH=1"
cd /d "c:\Users\BY2-21\Desktop\vscode"
call scripts\code.bat --extensionDevelopmentPath="c:\Users\BY2-21\Desktop\vscode\ai-task-pipeline"

endlocal
