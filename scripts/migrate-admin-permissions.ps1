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
$migrationPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'backend\database\manual-migrations\20260812_add_admin_permissions.sql'))
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
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed before administrator permissions were ready.' }
    $rows = @(& $mysqlPath --batch --skip-column-names --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute='SELECT COUNT(*) FROM admin_permissions;')
    if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 1) { throw 'Could not verify administrator permissions.' }
    Write-Output "Administrator permissions ready: $($rows[0]) account(s)."
}
finally {
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
