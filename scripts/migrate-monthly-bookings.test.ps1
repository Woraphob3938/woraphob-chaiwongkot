$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'migrate-monthly-bookings.ps1'
$migrationPath = Join-Path $PSScriptRoot '..\backend\database\manual-migrations\20260813_add_monthly_bookings.sql'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Monthly booking migration wrapper is missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Monthly booking migration SQL is missing.' }

& $scriptPath -PreflightOnly

$sql = Get-Content -LiteralPath $migrationPath -Raw
foreach ($required in @('monthly_price', 'monthly_session_count', 'booking_type', 'CREATE TABLE IF NOT EXISTS booking_sessions', 'INSERT IGNORE INTO booking_sessions')) {
    if (-not $sql.Contains($required)) { throw "Monthly booking migration is missing: $required" }
}

Write-Output 'PASS monthly booking migration preflight checks'
