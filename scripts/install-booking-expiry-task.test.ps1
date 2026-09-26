$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$installer = Join-Path $PSScriptRoot 'install-booking-expiry-task.ps1'
Assert-True (Test-Path -LiteralPath $installer) 'Booking expiry task installer is missing'

$taskName = "FitConnect-Expiry-Test-$([Guid]::NewGuid().ToString('N'))"
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -TaskName $taskName -WhatIf 2>&1
Assert-True ($LASTEXITCODE -eq 0) "Installer preview failed: $output"

$text = $output -join "`n"
Assert-True ($text -match [regex]::Escape("TaskName=$taskName")) 'Preview must show the requested task name'
Assert-True ($text -match 'IntervalMinutes=1') 'Preview must schedule expiry once per minute'
Assert-True ($text -match 'RunsOnBattery=true') 'Expiry task must keep running while the computer uses battery power'
Assert-True ($text -match 'expire-bookings\.php') 'Preview must invoke the booking expiry command'
Assert-True ($null -eq (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) 'WhatIf must not create a scheduled task'

Write-Output 'PASS booking expiry task installer preview'
