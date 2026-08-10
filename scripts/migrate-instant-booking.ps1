param(
    [string]$XamppRoot = 'C:\xampp',
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [string]$DatabaseName = 'fitconnect',
    [string]$BackupDirectory = 'C:\xampp\fitconnect-backups',
    [string]$MySqlExe = '',
    [string]$MySqlDumpExe = '',
    [switch]$PreflightOnly,
    [ValidateSet('legacy', 'migrated', 'partial')]
    [string]$SchemaState = ''
)

$ErrorActionPreference = 'Stop'

function Test-SchemaState([string]$State) {
    if ($State -eq 'partial') {
        throw 'Refusing migration: instant booking schema is partially migrated.'
    }
    if ($State -notin @('legacy', 'migrated')) {
        throw "Unknown schema state: $State"
    }
}

if ($PreflightOnly -and $SchemaState) {
    Test-SchemaState $SchemaState
    Write-Output "Preflight accepted schema state: $SchemaState"
    return
}

$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260810_instant_booking_payment_deadline.sql'))
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    throw "Migration SQL not found: $migrationPath"
}

if (-not $MySqlExe) { $MySqlExe = Join-Path $XamppRoot 'mysql\bin\mysql.exe' }
if (-not $MySqlDumpExe) { $MySqlDumpExe = Join-Path $XamppRoot 'mysql\bin\mysqldump.exe' }
$mysqlPath = (Resolve-Path -LiteralPath $MySqlExe).Path
$mysqlDumpPath = (Resolve-Path -LiteralPath $MySqlDumpExe).Path

if (-not (Test-Path -LiteralPath $BackupDirectory)) {
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}
$backupRoot = (Resolve-Path -LiteralPath $BackupDirectory).Path
$repositoryPrefix = $repositoryRoot.TrimEnd('\') + '\'
if ($backupRoot -eq $repositoryRoot -or $backupRoot.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BackupDirectory must be outside the FitConnect repository.'
}

$stateQuery = @"
SELECT CONCAT(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = '$DatabaseName' AND table_name = 'bookings' AND column_name = 'payment_deadline_at'), '|',
  (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
   WHERE table_schema = '$DatabaseName' AND table_name = 'bookings' AND index_name = 'idx_booking_payment_deadline'), '|',
  IF(LOCATE('expired', column_type) > 0, 1, 0), '|',
  IF(LOCATE('pending_trainer', column_type) > 0, 1, 0)
)
FROM information_schema.columns
WHERE table_schema = '$DatabaseName'
  AND table_name = 'bookings'
  AND column_name = 'status';
"@

$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $DatabasePassword

try {
    function Get-SchemaState {
        $rows = @(& $mysqlPath --batch --skip-column-names --user=$DatabaseUser --execute=$stateQuery)
        if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 1) {
            throw 'Could not inspect the FitConnect instant booking schema.'
        }
        $signature = $rows[0].Trim()
        if ($signature -eq '0|0|0|1') { return 'legacy' }
        if ($signature -eq '1|1|1|0') { return 'migrated' }
        return 'partial'
    }

    $detectedState = Get-SchemaState
    Test-SchemaState $detectedState
    Write-Output "Detected schema state: $detectedState"

    if ($PreflightOnly) { return }
    if ($detectedState -eq 'migrated') {
        Write-Output 'Database is already migrated; no backup or DDL was needed.'
        return
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $backupRoot "$DatabaseName-instant-booking-$timestamp.sql"
    & $mysqlDumpPath --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file=$backupPath --user=$DatabaseUser $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; migration was not started.' }
    if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -le 0) {
        throw 'Database backup is empty; migration was not started.'
    }
    Write-Output "Backup created: $backupPath"

    $migrationForMysql = $migrationPath.Replace('\', '/')
    & $mysqlPath --batch --user=$DatabaseUser --database=$DatabaseName --execute="SOURCE $migrationForMysql;"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed. Restore from backup: $backupPath" }

    $postflightState = Get-SchemaState
    if ($postflightState -ne 'migrated') {
        throw "Migration postflight failed with state '$postflightState'. Restore from backup: $backupPath"
    }
    Write-Output 'Migration complete: instant booking contract is active.'
    Write-Output "Recovery backup: $backupPath"
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
