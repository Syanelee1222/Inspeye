@echo off
REM InspEye - Desktop Pet Application Launcher
REM Uses launch.js to ensure proper environment setup

set ELECTRON_RUN_AS_NODE=
set "ELECTRON_RUN_AS_NODE="

cd /d "%~dp0"

if exist "node_modules\electron\dist\electron.exe" (
    node scripts\launch.js %*
) else (
    echo Electron binary not found. Running npm install...
    set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    call npm install --cache ".npm-cache"
    node scripts\launch.js %*
)
