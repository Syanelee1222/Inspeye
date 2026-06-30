@echo off
REM InspEye - Build installer with administrator privileges
REM Run this script as Administrator

echo Checking administrator privileges...
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Administrator privileges confirmed.
) else (
    echo Please run this script as Administrator!
    echo Right-click this file and select "Run as Administrator"
    pause
    exit /b 1
)

cd /d "%~dp0"

echo.
echo Building InspEye installer...
echo.

set ELECTRON_RUN_AS_NODE=
set "ELECTRON_RUN_AS_NODE="

npm run build

echo.
if %errorLevel% == 0 (
    echo.
    echo ===================================
    echo Build successful!
    echo Installer location: dist\
    echo ===================================
) else (
    echo.
    echo Build failed! Check error messages above.
)

pause
