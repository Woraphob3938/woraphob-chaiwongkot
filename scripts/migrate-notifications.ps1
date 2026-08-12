[CmdletBinding()]
param(
    [string]$XamppRoot = 'C:\xampp',
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 3306,
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [string]$DatabaseName = 'fitconnect',
    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260812_add_notifications.sql'))

if (-not (Test-Path -LiteralPath $migrationPath)) {
    throw 'Notification migration SQL is missing.'
}
if ($PreflightOnly) {
    Write-Output 'Notification migration preflight ready.'
    return
}

$mysqlPath = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'mysql\bin\mysql.exe')).Path
$envFile = Join-Path $repositoryRoot 'backend\.env'
if (Test-Path -LiteralPath $envFile) {
    $databaseSettings = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        $databaseSettings[$key.Trim()] = $value.Trim().Trim('"').Trim("'")
    }
    if (-not $PSBoundParameters.ContainsKey('DatabaseHost') -and $databaseSettings.DB_HOST) { $DatabaseHost = $databaseSettings.DB_HOST }
    if (-not $PSBoundParameters.ContainsKey('DatabasePort') -and $databaseSettings.DB_PORT) { $DatabasePort = [int]$databaseSettings.DB_PORT }
    if (-not $PSBoundParameters.ContainsKey('DatabaseName') -and $databaseSettings.DB_NAME) { $DatabaseName = $databaseSettings.DB_NAME }
    if (-not $PSBoundParameters.ContainsKey('DatabaseUser') -and $databaseSettings.DB_USER) { $DatabaseUser = $databaseSettings.DB_USER }
    if (-not $PSBoundParameters.ContainsKey('DatabasePassword') -and $null -ne $databaseSettings.DB_PASS) { $DatabasePassword = $databaseSettings.DB_PASS }
}

$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $DatabasePassword

try {
    $migrationForMysql = $migrationPath.Replace('\', '/')
    & $mysqlPath --batch --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute="SOURCE $migrationForMysql;"
    if ($LASTEXITCODE -ne 0) { throw 'Notification migration failed.' }

    $verificationSql = @'
SELECT CONCAT(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notifications'), '|',
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'notifications' AND index_name = 'uq_notification_event'), '|',
  (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'notifications' AND delete_rule = 'CASCADE'), '|',
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'email_status' AND column_type LIKE '%pending%sent%failed%skipped%')
);
'@
    $rows = @(& $mysqlPath --batch --skip-column-names --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute=$verificationSql)
    if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 1 -or $rows[0] -ne '1|3|2|1') {
        throw "Notification schema verification failed: $($rows -join ', ')"
    }
    Write-Output 'Notification storage ready.'
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
