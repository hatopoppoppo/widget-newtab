@echo off
rem Register the update helper with Chrome (run once; run again after moving the extension folder)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
