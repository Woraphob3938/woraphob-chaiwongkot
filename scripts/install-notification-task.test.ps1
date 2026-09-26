$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'install-notification-task.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Notification task installer is missing.' }

$source = Get-Content -LiteralPath $scriptPath -Raw
foreach ($required in @(
    'FitConnect-ProcessNotifications',
    'WindowStyle Hidden',
    'RepetitionInterval',
    'MultipleInstances IgnoreNew',
    '-Hidden'
)) {
    if (-not $source.Contains($required)) { throw "Notification task installer is missing: $required" }
}

$preview = & $scriptPath -WhatIf
if (($preview -join "`n") -notmatch 'IntervalMinutes=1') { throw 'Notification task must run every minute.' }

Write-Output 'PASS notification task installer is hidden and bounded'
