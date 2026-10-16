@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-julia-control-page.ps1"
if errorlevel 1 pause
