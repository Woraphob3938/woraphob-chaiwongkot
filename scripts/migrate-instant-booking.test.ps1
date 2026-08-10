$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'migrate-instant-booking.ps1'

foreach ($state in @('legacy', 'migrated')) {
    $accepted = $true
    try { & $scriptPath -PreflightOnly -SchemaState $state } catch { $accepted = $false }
    if (-not $accepted) { throw "$state schema should be accepted" }
}

$partialFailed = $false
try { & $scriptPath -PreflightOnly -SchemaState 'partial' } catch { $partialFailed = $true }
if (-not $partialFailed) { throw 'partial schema must be rejected before DDL' }

Write-Output 'PASS instant booking migration preflight state checks'
