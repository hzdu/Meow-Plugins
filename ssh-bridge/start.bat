@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist node_modules goto install
goto run

:install
echo [Meow] Installing SSH bridge dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed

:run
node bridge.js
goto end

:no_node
echo [Meow] Node.js 18+ was not found in PATH.
echo Install Node.js, then run this file again.
pause
exit /b 1

:install_failed
echo [Meow] Dependency installation failed. Check your network and retry.
pause
exit /b 1

:end
pause