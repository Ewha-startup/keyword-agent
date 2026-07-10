@echo off
REM ── 인기 키워드 일일 수집 실행기 (Windows 작업 스케줄러가 매일 오전 8시에 호출) ──
REM scrape.js 는 __dirname 기준으로 경로를 잡으므로 현재 폴더(CWD)와 무관하게 동작한다.
chcp 65001 >nul
setlocal

set "NODE=node"
where node >nul 2>nul
if not %errorlevel%==0 if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"

"%NODE%" "%~dp0scraper\scrape.js" >> "%~dp0data\scheduler.log" 2>&1

REM 베스트 키워드들의 검색 추이(증감) 수집 — 월별 데이터라 최근 갱신분은 자동 스킵
"%NODE%" "%~dp0scraper\trends.js" >> "%~dp0data\scheduler.log" 2>&1
endlocal
