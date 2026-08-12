param(
    [string]$ApiBase = 'http://localhost/fitconnect-api',
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 3306,
    [string]$DatabaseName = 'fitconnect',
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = ''
)

$ErrorActionPreference = 'Stop'
$mysqlExe = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path
$createdUserIds = @()

$envFile = Join-Path $PSScriptRoot '..\backend\.env'
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

function Invoke-Api([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$ApiBase$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    return Invoke-RestMethod @params
}

function Invoke-ApiError([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    try { Invoke-Api $Method $Path $Body $Token | Out-Null }
    catch {
        if ($null -eq $_.Exception.Response) { throw }
        $payload = $_.ErrorDetails.Message | ConvertFrom-Json
        return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Code = [string]$payload.error.code }
    }
    throw "Expected API error for $Method $Path"
}

function Assert-Equal([object]$Expected, [object]$Actual, [string]$Message) {
    if ([string]$Expected -ne [string]$Actual) { throw "$Message. Expected '$Expected', got '$Actual'" }
}

function Invoke-Sql([string]$Sql) {
    $output = & $mysqlExe --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --batch --skip-column-names --execute=$Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "MariaDB query failed: $output" }
    return @($output)
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$memberEmail = "admin-scope-member-$stamp@example.com"
$renamedMemberEmail = "admin-scope-member-updated-$stamp@example.com"
$limitedEmail = "admin-scope-limited-$stamp@example.com"

try {
    $health = Invoke-Api 'GET' '/v1/health'
    Assert-Equal 'connected' $health.data.database 'PHP API database health'
    $rootLogin = Invoke-Api 'POST' '/v1/auth/login' @{ email = 'admin.demo@fitconnect.local'; password = 'password' }
    $rootToken = [string]$rootLogin.data.token

    $member = Invoke-Api 'POST' '/v1/auth/register' @{ displayName = 'สมาชิกตรวจสิทธิ์'; email = $memberEmail; password = 'password123'; role = 'member' }
    $memberId = [int]$member.data.user.id
    $memberToken = [string]$member.data.token
    $createdUserIds += $memberId

    $operations = Invoke-Api 'GET' '/v1/admin/operations' $null $rootToken
    Assert-Equal 'True' $operations.data.permissions.manageUsers 'root manage-users permission'
    if ($null -eq $operations.data.users -or $null -eq $operations.data.bookings -or $null -eq $operations.data.payments) {
        throw 'Root operations response must include users, bookings and payments.'
    }
    Assert-Equal 10 $operations.data.pagination.pageSize 'administrator server-side page size'
    if (@($operations.data.users).Count -gt 10 -or @($operations.data.bookings).Count -gt 10 -or @($operations.data.payments).Count -gt 10) {
        throw 'Administrator operations must return no more than one page per record group.'
    }

    Invoke-Api 'PATCH' "/v1/admin/users/$memberId" @{ displayName = 'สมาชิกแก้ไขแล้ว'; email = $renamedMemberEmail } $rootToken | Out-Null
    Assert-Equal 'สมาชิกแก้ไขแล้ว|active' (@(Invoke-Sql "SELECT CONCAT(display_name, '|', status) FROM users WHERE id=$memberId;"))[0] 'member edit audit'
    Invoke-Api 'PATCH' "/v1/admin/users/$memberId" @{ status = 'suspended' } $rootToken | Out-Null
    $revoked = Invoke-ApiError 'GET' '/v1/me' $null $memberToken
    Assert-Equal 401 $revoked.Status 'suspension revokes active member token'
    $disabledLogin = Invoke-ApiError 'POST' '/v1/auth/login' @{ email = $renamedMemberEmail; password = 'password123' }
    Assert-Equal 403 $disabledLogin.Status 'suspended member login'
    Invoke-Api 'PATCH' "/v1/admin/users/$memberId" @{ status = 'active' } $rootToken | Out-Null
    Invoke-Api 'POST' '/v1/auth/login' @{ email = $renamedMemberEmail; password = 'password123' } | Out-Null

    $limited = Invoke-Api 'POST' '/v1/admin/users' @{
        displayName = 'ผู้ดูแลบัญชีทดสอบ'
        email = $limitedEmail
        password = 'password123'
        permissions = @{ manageUsers = $true; reviewTrainers = $false; manageBookings = $false; reviewPayments = $false }
    } $rootToken
    $limitedId = [int]$limited.data.id
    $createdUserIds += $limitedId
    $limitedLogin = Invoke-Api 'POST' '/v1/auth/login' @{ email = $limitedEmail; password = 'password123' }
    $limitedToken = [string]$limitedLogin.data.token
    $escalation = Invoke-ApiError 'POST' '/v1/admin/users' @{
        displayName = 'บัญชียกระดับที่ต้องถูกปฏิเสธ'
        email = "admin-scope-escalation-$stamp@example.com"
        password = 'password123'
        permissions = @{ manageUsers = $false; reviewTrainers = $false; manageBookings = $false; reviewPayments = $true }
    } $limitedToken
    Assert-Equal 403 $escalation.Status 'administrator permission escalation denial'
    Invoke-Api 'PATCH' "/v1/admin/users/$limitedId" @{
        displayName = 'ผู้ดูแลการเงินทดสอบ'
        email = $limitedEmail
        permissions = @{ manageUsers = $false; reviewTrainers = $false; manageBookings = $false; reviewPayments = $true }
    } $rootToken | Out-Null
    $limitedOperations = Invoke-Api 'GET' '/v1/admin/operations' $null $limitedToken
    Assert-Equal 0 @($limitedOperations.data.users).Count 'limited administrator user data'
    Assert-Equal 0 @($limitedOperations.data.bookings).Count 'limited administrator booking data'
    if ($null -ne $limitedOperations.data.summary.activeMembers -or $null -ne $limitedOperations.data.summary.totalBookings) {
        throw 'Limited administrator must not receive summary values outside assigned permissions.'
    }
    $paymentQueue = Invoke-Api 'GET' '/v1/admin/review-queue' $null $limitedToken
    Assert-Equal 0 @($paymentQueue.data.trainers).Count 'payment-only administrator trainer queue'
    $forbidden = Invoke-ApiError 'PATCH' "/v1/admin/users/$memberId" @{ status = 'suspended' } $limitedToken
    Assert-Equal 403 $forbidden.Status 'limited administrator user-management denial'

    Invoke-Api 'PATCH' '/v1/profile/password' @{ currentPassword = 'password123'; newPassword = 'password456' } $limitedToken | Out-Null
    Invoke-Api 'POST' '/v1/auth/login' @{ email = $limitedEmail; password = 'password456' } | Out-Null

    Invoke-Api 'PATCH' "/v1/admin/users/$limitedId" @{
        displayName = 'ผู้ดูแลการจองทดสอบ'
        email = $limitedEmail
        permissions = @{ manageUsers = $false; reviewTrainers = $false; manageBookings = $true; reviewPayments = $false }
    } $rootToken | Out-Null
    $bookingOnly = Invoke-Api 'GET' '/v1/admin/operations' $null $limitedToken
    Assert-Equal 'True' $bookingOnly.data.permissions.manageBookings 'updated booking permission'
    if ($null -eq $bookingOnly.data.summary.totalBookings -or $null -ne $bookingOnly.data.summary.approvedRevenue) {
        throw 'Updated permissions must expose only booking summary data.'
    }
    $queueDenied = Invoke-ApiError 'GET' '/v1/admin/review-queue' $null $limitedToken
    Assert-Equal 403 $queueDenied.Status 'booking-only administrator review queue denial'

    Write-Output 'PASS administrator account lifecycle, permission boundaries and scoped data visibility'
}
finally {
    if ($createdUserIds.Count -gt 0) {
        $ids = ($createdUserIds | ForEach-Object { [int]$_ }) -join ','
        Invoke-Sql "DELETE FROM users WHERE id IN ($ids);" | Out-Null
    }
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
