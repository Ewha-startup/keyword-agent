@echo off
REM Daily keyword scraper (Task Scheduler calls this at 08:00)
REM NOTE: keep this file ASCII + CRLF (cmd breaks on LF-only or Korean comments)
chcp 65001 >nul
setlocal
set "NODE=node"
where node >nul 2>nul
if not %errorlevel%==0 if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"

"%NODE%" "%~dp0scraper\scrape.js" >> "%~dp0data\scheduler.log" 2>&1
"%NODE%" "%~dp0scraper\trends.js" >> "%~dp0data\scheduler.log" 2>&1

REM Upload accumulated data to GitHub (FEDI chatbot reads raw.githubusercontent)
cd /d "%~dp0"
git add data >> "%~dp0data\scheduler.log" 2>&1
git commit -m "data: daily keyword collection" >> "%~dp0data\scheduler.log" 2>&1
git push origin main >> "%~dp0data\scheduler.log" 2>&1
endlocal