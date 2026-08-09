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
        throw 'Refusing migration: schema is partially migrated. Restore a consistent backup before continuing.'
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
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260810_remove_province_and_booking_location.sql'))
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

$targetQuery = @"
SELECT CONCAT('table:', table_name)
FROM information_schema.tables
WHERE table_schema = '$DatabaseName'
  AND table_name IN ('provinces', 'trainer_service_areas')
UNION ALL
SELECT CONCAT('column:', table_name, '.', column_name)
FROM information_schema.columns
WHERE table_schema = '$DatabaseName'
  AND (
    (table_name = 'member_profiles' AND column_name = 'home_province_id')
    OR (table_name = 'gyms' AND column_name = 'province_id')
    OR (table_name = 'trainer_profiles' AND column_name = 'primary_province_id')
    OR (table_name = 'bookings' AND column_name = 'location_text')
  );
"@

$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $DatabasePassword

try {
    function Get-TargetCount {
        $rows = @(& $mysqlPath --batch --skip-column-names --user=$DatabaseUser --execute=$targetQuery)
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the FitConnect schema.' }
        return @($rows | Where-Object { $_ -and $_.Trim() }).Count
    }

    $targetCount = Get-TargetCount
    $detectedState = if ($targetCount -eq 6) { 'legacy' } elseif ($targetCount -eq 0) { 'migrated' } else { 'partial' }
    Test-SchemaState $detectedState
    Write-Output "Detected schema state: $detectedState ($targetCount/6 legacy targets remain)"

    if ($PreflightOnly) { return }
    if ($detectedState -eq 'migrated') {
        Write-Output 'Database is already migrated; no backup or DDL was needed.'
        return
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $backupRoot "$DatabaseName-$timestamp.sql"
    & $mysqlDumpPath --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file=$backupPath --user=$DatabaseUser $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; migration was not started.' }
    if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -le 0) {
        throw 'Database backup is empty; migration was not started.'
    }
    Write-Output "Backup created: $backupPath"

    $migrationForMysql = $migrationPath.Replace('\', '/')
    & $mysqlPath --batch --user=$DatabaseUser --database=$DatabaseName --execute="SOURCE $migrationForMysql;"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed. Restore from backup: $backupPath" }

    $remainingTargets = Get-TargetCount
    if ($remainingTargets -ne 0) {
        throw "Migration postflight failed: $remainingTargets legacy targets remain. Restore from backup: $backupPath"
    }
    Write-Output 'Migration complete: 0/6 legacy targets remain.'
    Write-Output "Recovery backup: $backupPath"
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
