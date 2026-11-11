@echo off
cd /d "%~dp0"
python rooms.py --open
if errorlevel 1 pause
