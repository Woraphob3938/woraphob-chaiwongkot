[CmdletBinding()]
param(
    [int]$ServerPort = 8097,
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 3306,
    [string]$DatabaseName = 'fitconnect',
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [string]$XamppRoot = 'C:\xampp'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Invoke-RestMethod:TimeoutSec'] = 20
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendRoot = Join-Path $repositoryRoot 'backend'
$phpExe = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'php\php.exe')).Path
$mysqlExe = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'mysql\bin\mysql.exe')).Path
$routerPath = (Resolve-Path -LiteralPath (Join-Path $backendRoot 'index.php')).Path
$apiBase = "http://127.0.0.1:$ServerPort"
$createdUserIds = @()
$createdBookingId = $null
$createdProfileId = $null
$uploadedPaths = @()
$serverProcess = $null
$certificatePath = Join-Path ([IO.Path]::GetTempPath()) "fitconnect-notification-certificate-$([Guid]::NewGuid().ToString('N')).pdf"
$serverOut = Join-Path ([IO.Path]::GetTempPath()) "fitconnect-notification-server-$ServerPort.out.log"
$serverErr = Join-Path ([IO.Path]::GetTempPath()) "fitconnect-notification-server-$ServerPort.err.log"

$envFile = Join-Path $backendRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    $settings = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        $settings[$key.Trim()] = $value.Trim().Trim('"').Trim("'")
    }
    if (-not $PSBoundParameters.ContainsKey('DatabaseHost') -and $settings.DB_HOST) { $DatabaseHost = $settings.DB_HOST }
    if (-not $PSBoundParameters.ContainsKey('DatabasePort') -and $settings.DB_PORT) { $DatabasePort = [int]$settings.DB_PORT }
    if (-not $PSBoundParameters.ContainsKey('DatabaseName') -and $settings.DB_NAME) { $DatabaseName = $settings.DB_NAME }
    if (-not $PSBoundParameters.ContainsKey('DatabaseUser') -and $settings.DB_USER) { $DatabaseUser = $settings.DB_USER }
    if (-not $PSBoundParameters.ContainsKey('DatabasePassword') -and $null -ne $settings.DB_PASS) { $DatabasePassword = $settings.DB_PASS }
}

$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$hadMailEnabled = Test-Path Env:MAIL_ENABLED
$previousMailEnabled = $env:MAIL_ENABLED
$env:MYSQL_PWD = $DatabasePassword
$env:MAIL_ENABLED = 'false'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Equal([object]$Expected, [object]$Actual, [string]$Message) {
    if ([string]$Expected -ne [string]$Actual) { throw "$Message. Expected '$Expected', got '$Actual'" }
}

function Invoke-Sql([string]$Sql) {
    $output = & $mysqlExe --default-character-set=utf8mb4 --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --batch --skip-column-names --execute=$Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "MariaDB query failed: $output" }
    return @($output)
}

function Invoke-Api([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $parameters = @{ Method = $Method; Uri = "$apiBase$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json; charset=utf-8'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
    }
    try {
        return Invoke-RestMethod @parameters
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'no response' }
        $details = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        Write-Error "API $Method $Path failed ($status): $details" -ErrorAction Continue
        throw
    }
}

function Invoke-ApiError([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $parameters = @{ Method = $Method; Uri = "$apiBase$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json; charset=utf-8'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
    }
    try { Invoke-RestMethod @parameters | Out-Null }
    catch {
        if ($null -eq $_.Exception.Response) { throw }
        return [int]$_.Exception.Response.StatusCode
    }
    throw "Expected API error for $Method $Path"
}

function Get-Inbox([string]$Token, [string]$Category = 'all', [bool]$Unread = $false, [int]$Page = 0) {
    return (Invoke-Api 'GET' "/v1/notifications?page=$Page&category=$Category&unread=$($Unread.ToString().ToLowerInvariant())" $null $Token).data
}

function Remove-UploadedPath([string]$StoredPath) {
    if (-not $StoredPath -or -not $StoredPath.StartsWith('uploads/')) { return }
    $candidate = [IO.Path]::GetFullPath((Join-Path $backendRoot ($StoredPath -replace '/', '\')))
    $uploadRoot = [IO.Path]::GetFullPath((Join-Path $backendRoot 'uploads'))
    if (-not $candidate.StartsWith($uploadRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove an upload outside backend/uploads: $candidate"
    }
    Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
}

try {
    $portInUse = Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction SilentlyContinue
    if ($portInUse) { throw "Port $ServerPort is already in use." }
    Remove-Item -LiteralPath $serverOut, $serverErr -Force -ErrorAction SilentlyContinue
    $serverProcess = Start-Process -FilePath $phpExe -ArgumentList @('-S', "127.0.0.1:$ServerPort", $routerPath) -WorkingDirectory $backendRoot -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-Api 'GET' '/v1/health'
            if ($health.data.database -eq 'connected') { break }
        } catch {
            if ($attempt -eq 30) { throw }
            Start-Sleep -Milliseconds 200
        }
    }
    Assert-Equal 'connected' $health.data.database 'PHP API database health'
    Assert-Equal 1 ([int](@(Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='notifications';")[-1])) 'notifications table'

    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $password = 'fitconnect-smoke-password'
    $memberEmail = "notification-member-$stamp@example.com"
    $trainerEmail = "notification-trainer-$stamp@example.com"
    $member = (Invoke-Api 'POST' '/v1/auth/register' @{ displayName = 'สมาชิกแจ้งเตือนทดสอบ'; email = $memberEmail; password = $password; role = 'member' }).data
    $trainer = (Invoke-Api 'POST' '/v1/auth/register' @{ displayName = 'เทรนเนอร์แจ้งเตือนทดสอบ'; email = $trainerEmail; password = $password; role = 'trainer' }).data
    $createdUserIds = @([int]$member.user.id, [int]$trainer.user.id)
    $memberToken = [string]$member.token
    $trainerToken = [string]$trainer.token
    $adminToken = [string](Invoke-Api 'POST' '/v1/auth/login' @{ email = 'admin.demo@fitconnect.local'; password = 'password' }).data.token

    [IO.File]::WriteAllText($certificatePath, "%PDF-1.4`n1 0 obj<</Type/Catalog>>endobj`n%%EOF", [Text.Encoding]::ASCII)
    $trainingTypeId = [int]((Invoke-Api 'GET' '/v1/training-types').data[0].id)
    $applicationJson = & curl.exe --silent --show-error --fail-with-body --max-time 20 `
        -H "Authorization: Bearer $trainerToken" `
        -F 'legalName=เทรนเนอร์แจ้งเตือนทดสอบ' `
        -F 'phone=0812345678' `
        -F 'serviceMode=freelance' `
        -F "trainingTypeId=$trainingTypeId" `
        -F 'experience=ใช้ตรวจระบบแจ้งเตือน FitConnect' `
        -F "certificate=@$certificatePath;type=application/pdf" `
        "$apiBase/v1/trainer-applications"
    Assert-True ($LASTEXITCODE -eq 0) "Trainer application failed: $applicationJson"
    $application = ($applicationJson | ConvertFrom-Json).data
    $createdProfileId = [int]$application.trainerProfileId
    Invoke-Api 'POST' "/v1/admin/trainers/$createdProfileId/approve" @{ note = 'ผ่านการตรวจระบบแจ้งเตือน' } $adminToken | Out-Null
    Assert-Equal 1 ([int](@(Invoke-Sql "UPDATE trainer_profiles SET price_from=650 WHERE id=$createdProfileId; SELECT ROW_COUNT();")[-1])) 'trainer test price setup'

    $startsAt = [DateTime]::UtcNow.AddHours(12)
    $slot = (Invoke-Api 'POST' '/v1/availability-slots' @{
        startsAt = $startsAt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        endsAt = $startsAt.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    } $trainerToken).data
    $booking = (Invoke-Api 'POST' '/v1/bookings' @{
        trainerId = $createdProfileId
        slotId = [int]$slot.id
        note = 'ตรวจระบบแจ้งเตือน'
    } $memberToken).data
    $createdBookingId = [string]$booking.id

    $slipPath = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot 'public\demo\trainer-a.png')).Path
    $paymentJson = & curl.exe --silent --show-error --fail-with-body --max-time 20 `
        -H "Authorization: Bearer $memberToken" `
        -F "bookingId=$createdBookingId" `
        -F "slip=@$slipPath;type=image/png" `
        "$apiBase/v1/payments"
    Assert-True ($LASTEXITCODE -eq 0) "Payment upload failed: $paymentJson"
    $payment = ($paymentJson | ConvertFrom-Json).data
    $queue = (Invoke-Api 'GET' '/v1/admin/review-queue' $null $adminToken).data
    $queuedPayment = @($queue.payments | Where-Object { $_.bookingId -eq $createdBookingId })[0]
    Assert-True ($null -ne $queuedPayment) 'Payment must appear in review queue.'
    Invoke-Api 'POST' "/v1/admin/payments/$($queuedPayment.id)/approve" @{ note = 'หลักฐานถูกต้อง'; bankConfirmed = $true } $adminToken | Out-Null

    $memberInbox = Get-Inbox $memberToken
    $trainerInbox = Get-Inbox $trainerToken
    Assert-Equal 10 $memberInbox.pagination.pageSize 'notification page size'
    Assert-True (@($memberInbox.items).Count -le 10) 'notification page must contain at most 10 items'
    $memberTypes = @($memberInbox.items.type)
    Assert-True ($memberTypes -contains 'booking_created') 'member booking-created notification'
    Assert-True ($memberTypes -contains 'payment_submitted') 'member payment-submitted notification'
    Assert-True ($memberTypes -contains 'payment_approved_member') 'member payment-approved notification'
    Assert-Equal 1 @($trainerInbox.items | Where-Object { $_.type -eq 'payment_approved_trainer' }).Count 'trainer payment-approved notification'
    Assert-Equal 1 @($trainerInbox.items).Count 'trainer receives nothing before payment approval'

    $statusRows = @(Invoke-Sql "SELECT type, email_status FROM notifications n JOIN bookings b ON b.id=n.booking_id WHERE b.public_id='$createdBookingId' ORDER BY n.id;")
    $statusMap = @{}
    foreach ($row in $statusRows) { $parts = ([string]$row) -split "`t"; $statusMap[$parts[0]] = $parts[1] }
    Assert-Equal 'pending' $statusMap.booking_created 'booking-created email status while mail is disabled'
    Assert-Equal 'skipped' $statusMap.payment_submitted 'payment-submitted email status'
    Assert-Equal 'pending' $statusMap.payment_approved_member 'member payment-approved email status while mail is disabled'
    Assert-Equal 'pending' $statusMap.payment_approved_trainer 'trainer payment-approved email status while mail is disabled'

    $paymentOnly = Get-Inbox $memberToken 'payment'
    Assert-True (@($paymentOnly.items | Where-Object { $_.category -ne 'payment' }).Count -eq 0) 'payment category filter'
    $unreadOnly = Get-Inbox $memberToken 'all' $true
    Assert-True (@($unreadOnly.items | Where-Object { $null -ne $_.readAt }).Count -eq 0) 'unread filter'
    $memberNotificationId = [int]($memberInbox.items | Where-Object { $_.type -eq 'booking_created' } | Select-Object -First 1).id
    Assert-Equal 404 (Invoke-ApiError 'GET' "/v1/notifications/$memberNotificationId" $null $trainerToken) 'notification detail ownership'
    Invoke-Api 'PATCH' "/v1/notifications/$memberNotificationId/read" $null $memberToken | Out-Null
    Invoke-Api 'PATCH' "/v1/notifications/$memberNotificationId/read" $null $memberToken | Out-Null
    $readDetail = (Invoke-Api 'GET' "/v1/notifications/$memberNotificationId" $null $memberToken).data
    Assert-True ($null -ne $readDetail.readAt) 'idempotent read timestamp'
    Invoke-Api 'POST' '/v1/notifications/read-all' $null $memberToken | Out-Null
    Assert-Equal 0 (Get-Inbox $memberToken).unread.all 'read-all clears member unread count'

    $workerPath = (Resolve-Path -LiteralPath (Join-Path $backendRoot 'scripts\process-notifications.php')).Path
    $firstWorker = ([string](@(& $phpExe $workerPath 2>&1)[-1])) | ConvertFrom-Json
    Assert-True ($LASTEXITCODE -eq 0) 'first notification worker run'
    $secondWorker = ([string](@(& $phpExe $workerPath 2>&1)[-1])) | ConvertFrom-Json
    Assert-True ($LASTEXITCODE -eq 0) 'second notification worker run'
    Assert-Equal 2 $firstWorker.reminders 'member and trainer reminders created once'
    Assert-Equal 0 $secondWorker.reminders 'reminder unique key prevents duplicates'

    Invoke-Api 'PATCH' "/v1/bookings/$createdBookingId/status" @{ status = 'cancelled'; note = 'ยกเลิกเพื่อทดสอบการแจ้งเตือน' } $adminToken | Out-Null
    $memberAfterCancel = Get-Inbox $memberToken
    $trainerAfterCancel = Get-Inbox $trainerToken
    Assert-Equal 1 @($memberAfterCancel.items | Where-Object { $_.type -eq 'booking_cancelled_member' }).Count 'member cancellation notification'
    Assert-Equal 1 @($trainerAfterCancel.items | Where-Object { $_.type -eq 'booking_cancelled_trainer' }).Count 'trainer cancellation notification'

    $uploadedPaths = @(Invoke-Sql "SELECT file_path FROM trainer_certificates WHERE trainer_profile_id=$createdProfileId UNION ALL SELECT p.slip_path FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.public_id='$createdBookingId';")
    Write-Output "PASS notification smoke: booking=$createdBookingId mail=disabled externalEmails=0"
} catch {
    if (Test-Path -LiteralPath $serverErr) {
        $serverDiagnostics = Get-Content -LiteralPath $serverErr -Tail 20
        if ($serverDiagnostics) { Write-Error ($serverDiagnostics -join [Environment]::NewLine) -ErrorAction Continue }
    }
    throw
} finally {
    try {
        if ($createdProfileId) {
            $uploadedPaths += @(Invoke-Sql "SELECT file_path FROM trainer_certificates WHERE trainer_profile_id=$createdProfileId;")
        }
        if ($createdBookingId) {
            $uploadedPaths += @(Invoke-Sql "SELECT p.slip_path FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.public_id='$createdBookingId';")
        }
        foreach ($storedPath in @($uploadedPaths | Select-Object -Unique)) { Remove-UploadedPath ([string]$storedPath) }
        if ($createdBookingId) {
            Invoke-Sql "DELETE FROM bookings WHERE public_id='$createdBookingId';" | Out-Null
        }
        if ($createdUserIds.Count -gt 0) {
            $ids = ($createdUserIds | ForEach-Object { [int]$_ }) -join ','
            Invoke-Sql "DELETE FROM users WHERE id IN ($ids);" | Out-Null
        }
    } finally {
        Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
        if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
        Remove-Item -LiteralPath $serverOut, $serverErr -Force -ErrorAction SilentlyContinue
        if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword } else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
        if ($hadMailEnabled) { $env:MAIL_ENABLED = $previousMailEnabled } else { Remove-Item Env:MAIL_ENABLED -ErrorAction SilentlyContinue }
    }
}
