$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'migrate-remove-province-location.ps1'

$legacyFailed = $false
try { & $scriptPath -PreflightOnly -SchemaState 'legacy' } catch { $legacyFailed = $true }
if ($legacyFailed) { throw 'legacy schema must be accepted' }

$migratedFailed = $false
try { & $scriptPath -PreflightOnly -SchemaState 'migrated' } catch { $migratedFailed = $true }
if ($migratedFailed) { throw 'migrated schema must be idempotent' }

$partialFailed = $false
try { & $scriptPath -PreflightOnly -SchemaState 'partial' } catch { $partialFailed = $true }
if (-not $partialFailed) { throw 'partial schema must be rejected before DDL' }

Write-Output 'PASS migration preflight state checks'
