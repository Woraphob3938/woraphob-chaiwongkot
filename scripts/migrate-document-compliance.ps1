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
        throw 'Refusing migration: document compliance schema is partially migrated. Restore a consistent backup before continuing.'
    }
    if ($State -notin @('legacy', 'migrated')) {
        throw "Unknown schema state: $State"
    }
}

# Unlike the modelled member-profile migration, every statement in this
# migration is idempotent, so a half-applied database can be resumed safely
# (after a fresh backup) instead of forcing a restore. An explicitly asserted
# -SchemaState 'partial' still refuses.
function Test-ResumableSchemaState([string]$State) {
    if ($State -eq 'partial') {
        Write-Warning 'Document compliance schema is partially migrated; the migration SQL is idempotent, so it will be re-applied after a fresh backup.'
        return
    }
    Test-SchemaState $State
}

if ($PreflightOnly -and $SchemaState) {
    Test-SchemaState $SchemaState
    Write-Output "Preflight accepted schema state: $SchemaState"
    return
}

$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260922_document_compliance.sql'))
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

# 9 columns plus the extended bookings.status enum plus the nullable
# notifications.booking_id = 11 checks.
$targetQuery = @"
SELECT CONCAT(table_name, '.', column_name)
FROM information_schema.columns
WHERE table_schema = '$DatabaseName'
  AND (
    (table_name = 'bookings' AND column_name IN ('confirmed_starts_at', 'confirmed_ends_at'))
    OR (table_name = 'member_profiles' AND column_name = 'birth_date')
    OR (table_name = 'trainer_profiles' AND column_name IN ('birth_date', 'education'))
    OR (table_name = 'messages' AND column_name IN ('image_path', 'image_mime', 'image_name', 'image_size'))
    OR (table_name = 'notifications' AND column_name = 'booking_id' AND is_nullable = 'YES')
  );
"@

$enumQuery = @"
SELECT column_type
FROM information_schema.columns
WHERE table_schema = '$DatabaseName'
  AND table_name = 'bookings'
  AND column_name = 'status';
"@

$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $DatabasePassword

try {
    function Get-TargetCount {
        $rows = @(& $mysqlPath --batch --skip-column-names --user=$DatabaseUser --database=$DatabaseName --execute=$targetQuery)
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the FitConnect document compliance schema.' }
        $columnCount = @($rows | Where-Object { $_ -and $_.Trim() }).Count
        $enumRow = @(& $mysqlPath --batch --skip-column-names --user=$DatabaseUser --database=$DatabaseName --execute=$enumQuery)
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the FitConnect bookings.status column.' }
        $enumType = (@($enumRow | Where-Object { $_ -and $_.Trim() }) -join '')
        $enumCount = if ($enumType -match 'pending_trainer') { 1 } else { 0 }
        return $columnCount + $enumCount
    }

    $targetCount = Get-TargetCount
    $detectedState = if ($targetCount -eq 0) { 'legacy' } elseif ($targetCount -eq 11) { 'migrated' } else { 'partial' }
    Test-ResumableSchemaState $detectedState
    Write-Output "Detected schema state: $detectedState ($targetCount/11 document compliance targets present)"

    if ($PreflightOnly) { return }
    if ($detectedState -eq 'migrated') {
        Write-Output 'Database is already migrated; no backup or DDL was needed.'
        return
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $backupRoot "$DatabaseName-document-compliance-$timestamp.sql"
    & $mysqlDumpPath --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file=$backupPath --user=$DatabaseUser $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; migration was not started.' }
    if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -le 0) {
        throw 'Database backup is empty; migration was not started.'
    }
    Write-Output "Backup created: $backupPath"

    $migrationForMysql = $migrationPath.Replace('\', '/')
    & $mysqlPath --batch --user=$DatabaseUser --database=$DatabaseName --execute="SOURCE $migrationForMysql;"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed. Restore from backup: $backupPath" }

    $presentTargets = Get-TargetCount
    if ($presentTargets -ne 11) {
        throw "Migration postflight failed: $presentTargets/11 document compliance targets present. Restore from backup: $backupPath"
    }
    Write-Output 'Migration complete: 11/11 document compliance targets present.'
    Write-Output "Recovery backup: $backupPath"
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
