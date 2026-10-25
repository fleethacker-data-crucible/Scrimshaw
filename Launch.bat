@echo off
setlocal EnableExtensions
cd /d "%~dp0"
REM Scrimshaw: starts the local server (PowerShell 5.1, 127.0.0.1 only) in a minimised
REM window and opens your browser. Close the "Scrimshaw" window to stop it.
REM   Launch.bat --console   keeps the server window in front for troubleshooting.
if /I "%~1"=="--console" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start.ps1"
) else (
  start "Scrimshaw" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start.ps1"
)
endlocal
