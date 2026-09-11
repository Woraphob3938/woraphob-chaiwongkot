param(
    [string]$XamppRoot = 'C:\xampp',
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 3306,
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [string]$DatabaseName = 'fitconnect'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260912_add_rate_limits.sql'))
$mysqlPath = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'mysql\bin\mysql.exe')).Path
$dumpPath = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'mysql\bin\mysqldump.exe')).Path
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
    # The table is new, so nothing is overwritten; the dump still runs first so a
    # failed run can be compared against the state before the change.
    $backupDirectory = Join-Path $XamppRoot 'fitconnect-backups'
    if (-not (Test-Path -LiteralPath $backupDirectory)) { New-Item -ItemType Directory -Path $backupDirectory | Out-Null }
    $backupPath = Join-Path $backupDirectory ("fitconnect-rate-limits-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    & $dumpPath --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --databases $DatabaseName --result-file=$backupPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not back up the database before adding rate limits.' }
    Write-Output "Recovery backup: $backupPath"

    $migrationForMysql = $migrationPath.Replace('\', '/')
    & $mysqlPath --batch --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute="SOURCE $migrationForMysql;"
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed before the rate limit table was ready.' }
    $rows = @(& $mysqlPath --batch --skip-column-names --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'rate_limits';")
    if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 1 -or $rows[0].Trim() -ne '1') { throw 'Could not verify the rate limit table.' }
    Write-Output 'Rate limit counters ready.'
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
