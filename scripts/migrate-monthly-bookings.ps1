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
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260813_add_monthly_bookings.sql'))
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Monthly booking migration SQL is missing.' }
if ($PreflightOnly) { Write-Output 'Monthly booking migration preflight ready.'; return }

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
    if ($LASTEXITCODE -ne 0) { throw 'Monthly booking migration failed.' }

    $verificationSql = @'
SELECT CONCAT(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trainer_profiles' AND column_name IN ('monthly_price', 'monthly_session_count')), '|',
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name IN ('booking_type', 'period_start', 'period_end')), '|',
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'booking_sessions')
);
'@
    $rows = @(& $mysqlPath --batch --skip-column-names --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute=$verificationSql)
    if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 1 -or $rows[0] -ne '2|3|1') {
        throw "Monthly booking schema verification failed: $($rows -join ', ')"
    }
    Write-Output 'Monthly booking storage ready.'
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
