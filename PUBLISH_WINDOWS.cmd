@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-github.ps1" -Owner HADJAL001
if errorlevel 1 (
  echo GitHub publication failed - check the output above.
  pause
  exit /b 1
)
echo Publication completed.
pause
