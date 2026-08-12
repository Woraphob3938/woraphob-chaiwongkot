[CmdletBinding()]
param(
    [string]$ApiUrl = 'http://localhost/fitconnect-api',
    [string]$XamppRoot = 'C:\xampp',
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 3306,
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [string]$DatabaseName = 'fitconnect'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Api([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$ApiUrl$Path"; Headers = $headers; TimeoutSec = 20 }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = $Body | ConvertTo-Json -Depth 8 -Compress
    }
    return Invoke-RestMethod @params
}

function Login([string]$Email) {
    return (Invoke-Api 'POST' '/v1/auth/login' @{ email = $Email; password = 'password' }).data
}

$envFile = Join-Path $repositoryRoot 'backend\.env'
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

$mysqlPath = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'mysql\bin\mysql.exe')).Path
$hadMysqlPassword = Test-Path Env:MYSQL_PWD
$previousMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $DatabasePassword
$bookingIds = [Collections.Generic.List[string]]::new()
$slotIds = [Collections.Generic.List[int]]::new()
$trainer = $null
$originalProfile = $null

function Invoke-MySql([string]$Sql) {
    $rows = @(& $mysqlPath --batch --skip-column-names --host=$DatabaseHost --port=$DatabasePort --user=$DatabaseUser --database=$DatabaseName --execute=$Sql)
    if ($LASTEXITCODE -ne 0) { throw 'Monthly booking database check failed.' }
    return $rows
}

function New-TestSlot([string]$Token, [int]$Days, [int]$Minutes) {
    $start = [DateTime]::UtcNow.Date.AddDays($Days).AddHours(9).AddMinutes($Minutes)
    $slot = (Invoke-Api 'POST' '/v1/availability-slots' @{
        startsAt = $start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        endsAt = $start.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    } $Token).data
    $slotIds.Add([int]$slot.id)
    return $slot
}

try {
    $health = (Invoke-Api 'GET' '/v1/health').data
    Assert-True ($health.database -eq 'connected') 'PHP API is not connected to the database.'

    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $originalProfile = (Invoke-Api 'GET' '/v1/profile' $null $trainer.token).data
    $trainerData = $originalProfile.trainer
    $profileBody = @{
        displayName = $originalProfile.user.displayName
        legalName = $trainerData.legalName
        phone = $trainerData.phone
        headline = $trainerData.headline
        bio = $trainerData.bio
        yearsExperience = $trainerData.yearsExperience
        serviceMode = $trainerData.serviceMode
        gymName = $trainerData.gymName
        priceFrom = $trainerData.priceFrom
        monthlyPrice = 2400
        monthlySessionCount = 2
        trainingTypeIds = @($trainerData.trainingTypeIds)
    }
    Invoke-Api 'PATCH' '/v1/profile' $profileBody $trainer.token | Out-Null

    $publicTrainer = (Invoke-Api 'GET' '/v1/trainers/demo-trainer-a').data
    $offset = Get-Random -Minimum 1 -Maximum 400

    $cancelSlots = @(New-TestSlot $trainer.token 12 $offset; New-TestSlot $trainer.token 18 $offset)
    $cancelBooking = (Invoke-Api 'POST' '/v1/bookings' @{
        trainerId = $publicTrainer.id
        bookingType = 'monthly'
        slotIds = @($cancelSlots.id)
        note = 'monthly smoke cancellation'
    } $member.token).data
    $bookingIds.Add([string]$cancelBooking.id)
    Assert-True ($cancelBooking.bookingType -eq 'monthly' -and $cancelBooking.sessionCount -eq 2) 'Monthly booking summary is incorrect.'
    Assert-True ([decimal]$cancelBooking.quotedPrice -eq 2400) 'Monthly package price is incorrect.'

    $heldWorkspace = (Invoke-Api 'GET' '/v1/trainer/me' $null $trainer.token).data
    foreach ($slot in $cancelSlots) {
        $state = ($heldWorkspace.slots | Where-Object id -eq $slot.id | Select-Object -First 1).state
        Assert-True ($state -eq 'held') "Slot $($slot.id) was not held."
    }
    Invoke-Api 'POST' "/v1/bookings/$($cancelBooking.id)/cancel" @{} $member.token | Out-Null

    $releasedWorkspace = (Invoke-Api 'GET' '/v1/trainer/me' $null $trainer.token).data
    foreach ($slot in $cancelSlots) {
        $state = ($releasedWorkspace.slots | Where-Object id -eq $slot.id | Select-Object -First 1).state
        Assert-True ($state -eq 'available') "Cancelled slot $($slot.id) was not released."
    }

    $expirySlots = @(New-TestSlot $trainer.token 20 ($offset + 10); New-TestSlot $trainer.token 24 ($offset + 10))
    $expiryBooking = (Invoke-Api 'POST' '/v1/bookings' @{
        trainerId = $publicTrainer.id
        bookingType = 'monthly'
        slotIds = @($expirySlots.id)
        note = 'monthly smoke expiry'
    } $member.token).data
    $bookingIds.Add([string]$expiryBooking.id)
    Invoke-MySql "UPDATE bookings SET payment_deadline_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE public_id = '$($expiryBooking.id)';" | Out-Null

    $memberBookings = (Invoke-Api 'GET' '/v1/bookings' $null $member.token).data
    $expired = $memberBookings | Where-Object id -eq $expiryBooking.id | Select-Object -First 1
    Assert-True ($expired.status -eq 'expired') 'Monthly booking did not expire after its payment deadline.'
    Assert-True (@($expired.sessions).Count -eq 2) 'Monthly booking did not retain both sessions.'

    $expiredWorkspace = (Invoke-Api 'GET' '/v1/trainer/me' $null $trainer.token).data
    foreach ($slot in $expirySlots) {
        $state = ($expiredWorkspace.slots | Where-Object id -eq $slot.id | Select-Object -First 1).state
        Assert-True ($state -eq 'available') "Expired slot $($slot.id) was not released."
    }

    Write-Output "PASS monthly booking: one package, one payment deadline, all slots released on cancel and expiry ($($expiryBooking.id))."
}
finally {
    if ($bookingIds.Count -gt 0) {
        $quotedIds = ($bookingIds | ForEach-Object { "'$_'" }) -join ','
        Invoke-MySql "DELETE FROM bookings WHERE public_id IN ($quotedIds);" | Out-Null
    }
    if ($trainer -and $originalProfile) {
        $data = $originalProfile.trainer
        Invoke-Api 'PATCH' '/v1/profile' @{
            displayName = $originalProfile.user.displayName; legalName = $data.legalName; phone = $data.phone
            headline = $data.headline; bio = $data.bio; yearsExperience = $data.yearsExperience
            serviceMode = $data.serviceMode; gymName = $data.gymName; priceFrom = $data.priceFrom
            monthlyPrice = $data.monthlyPrice; monthlySessionCount = $data.monthlySessionCount
            trainingTypeIds = @($data.trainingTypeIds)
        } $trainer.token | Out-Null
    }
    foreach ($slotId in $slotIds) {
        try { Invoke-Api 'DELETE' "/v1/availability-slots/$slotId" $null $trainer.token | Out-Null } catch { }
    }
    if ($hadMysqlPassword) { $env:MYSQL_PWD = $previousMysqlPassword }
    else { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}
