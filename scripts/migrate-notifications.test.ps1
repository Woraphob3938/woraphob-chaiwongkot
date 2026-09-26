$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'migrate-notifications.ps1'
$migrationPath = Join-Path $PSScriptRoot '..\backend\database\manual-migrations\20260812_add_notifications.sql'

if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Notification migration wrapper is missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Notification migration SQL is missing.' }

& $scriptPath -PreflightOnly

$sql = Get-Content -LiteralPath $migrationPath -Raw
foreach ($required in @(
    'CREATE TABLE IF NOT EXISTS notifications',
    'uq_notification_event',
    'idx_notification_email_queue',
    'ON DELETE CASCADE',
    "ENUM('pending', 'sent', 'failed', 'skipped')"
)) {
    if (-not $sql.Contains($required)) { throw "Notification migration is missing: $required" }
}

Write-Output 'PASS notification migration preflight checks'
