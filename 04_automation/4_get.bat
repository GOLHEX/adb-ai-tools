@echo off
cd /d "%~dp0"
node adobe_agent.js --get %1
pause
