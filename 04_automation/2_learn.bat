@echo off
cd /d "%~dp0"
node adobe_agent.js --learn %1
pause
