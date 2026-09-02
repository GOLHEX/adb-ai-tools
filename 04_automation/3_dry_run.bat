@echo off
cd /d "%~dp0"
node adobe_agent.js --csv page13_first10.csv --dry --limit 5
pause
