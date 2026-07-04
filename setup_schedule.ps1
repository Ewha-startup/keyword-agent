# ─────────────────────────────────────────────────────────────
#  인기 키워드 수집 - Windows 작업 스케줄러 등록 스크립트
#  매일 오전 8시에 run_daily.bat 를 자동 실행하도록 등록한다.
#
#  사용법 (관리자 권한 PowerShell 권장):
#     powershell -ExecutionPolicy Bypass -File setup_schedule.ps1
#  해제:
#     powershell -ExecutionPolicy Bypass -File setup_schedule.ps1 -Remove
# ─────────────────────────────────────────────────────────────
param([switch]$Remove)

$TaskName = "KeywordScraperDaily"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Bat  = Join-Path $Root "run_daily.bat"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "작업 '$TaskName' 등록을 해제했습니다." -ForegroundColor Yellow
    return
}

if (-not (Test-Path $Bat)) { Write-Error "run_daily.bat 을 찾을 수 없습니다: $Bat"; return }

# 기존 등록 제거 후 재등록 (멱등)
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute $Bat -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
# -StartWhenAvailable : PC가 꺼져 있어 놓친 실행을 켜진 뒤 즉시 보충 실행
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "매일 오전 8시 플랫폼 인기 키워드 수집" -Force | Out-Null

Write-Host "[완료] 작업 '$TaskName' 등록됨 - 매일 오전 8:00 실행" -ForegroundColor Green
Write-Host "지금 즉시 한 번 실행하려면:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "상태 확인:  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
