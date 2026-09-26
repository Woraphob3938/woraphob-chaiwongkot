$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'migrate-member-profile.ps1'

foreach ($accepted in @('legacy', 'migrated')) {
    try { & $scriptPath -PreflightOnly -SchemaState $accepted }
    catch { throw "$accepted schema must be accepted: $($_.Exception.Message)" }
}

$partialAccepted = $true
try { & $scriptPath -PreflightOnly -SchemaState 'partial' } catch { $partialAccepted = $false }
if ($partialAccepted) { throw 'partial schema must be rejected before DDL' }

Write-Output 'PASS member profile migration preflight checks'
