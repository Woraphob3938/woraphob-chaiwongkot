[CmdletBinding()]
param(
    [ValidateSet('availability', 'admin', 'booking', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiUrl = 'http://localhost/fitconnect-api'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Login {
    param([string]$Email)
    $body = @{ email = $Email; password = 'password' } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/login" -ContentType 'application/json' -Body $body).data
}

function Auth-Headers {
    param([string]$Token)
    return @{ Authorization = "Bearer $Token" }
}

function Expect-Status {
    param([int]$Status, [scriptblock]$Action)
    try {
        & $Action | Out-Null
    } catch {
        $actual = [int]$_.Exception.Response.StatusCode
        Assert-True ($actual -eq $Status) "Expected HTTP $Status, got $actual"
        return
    }
    throw "Expected HTTP $Status, request succeeded"
}

if ($Scenario -in @('availability', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $startsAt = (Get-Date).ToUniversalTime().AddDays(7).AddMinutes((Get-Random -Minimum 1 -Maximum 300)).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $endsAt = ([DateTime]::Parse($startsAt)).ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $body = @{ startsAt = $startsAt; endsAt = $endsAt } | ConvertTo-Json

    $created = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body).data
    Assert-True ($created.state -eq 'available') 'New slot must be available'

    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body
    }

    $overlapBody = @{
        startsAt = ([DateTime]::Parse($startsAt)).ToUniversalTime().AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        endsAt = ([DateTime]::Parse($endsAt)).ToUniversalTime().AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    } | ConvertTo-Json
    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $overlapBody
    }

    $workspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True (($workspace.slots.id -contains $created.id)) 'Trainer workspace must include the new slot'

    $publicTrainer = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainers/demo-trainer-a").data
    Assert-True (($publicTrainer.slots.id -contains $created.id)) 'Public trainer profile must include the available slot'
    Assert-True (-not ($publicTrainer.slots.id -contains 102)) 'Public trainer profile must hide held slots'
    Assert-True (-not ($publicTrainer.slots.available -contains $false)) 'Every public slot must be available'

    Invoke-RestMethod -Method Delete -Uri "$ApiUrl/v1/availability-slots/$($created.id)" -Headers $trainerHeaders | Out-Null

    $pendingTrainer = Login 'trainer.c@fitconnect.local'
    $pendingHeaders = Auth-Headers $pendingTrainer.token
    Expect-Status 403 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $pendingHeaders -ContentType 'application/json' -Body $body
    }
}

if ($Scenario -in @('admin', 'all')) {
    $admin = Login 'admin.demo@fitconnect.local'
    $headers = Auth-Headers $admin.token
    $queue = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/admin/review-queue" -Headers $headers).data
    $candidate = $queue.trainers | Where-Object { $_.id -eq 3 } | Select-Object -First 1
    Assert-True ($null -ne $candidate) 'Seeded pending trainer must be in the review queue'
    Assert-True ($candidate.certificates.Count -gt 0) 'Review queue must include certificate records'
    Assert-True (
        $candidate.certificates[0].fileUrl -eq "/v1/admin/files/certificate/$($candidate.certificates[0].id)"
    ) 'Certificate URL must use the protected route'

    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/reject" -Headers $headers -ContentType 'application/json' -Body (@{ note = '' } | ConvertTo-Json)
    }

    $approved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/approve" -Headers $headers -ContentType 'application/json' -Body (@{ note = 'ผ่านการตรวจสำหรับ smoke test' } | ConvertTo-Json)
    ).data
    Assert-True ($approved.status -eq 'approved') 'Pending trainer must become approved'

    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/approve" -Headers $headers -ContentType 'application/json' -Body (@{ note = 'กดซ้ำ' } | ConvertTo-Json)
    }
}

if ($Scenario -in @('booking', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token
    $script:slotOffset = Get-Random -Minimum 1000 -Maximum 5000

    function New-TestSlot {
        $script:slotOffset += 90
        $start = (Get-Date).ToUniversalTime().AddDays(10).AddMinutes($script:slotOffset).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $end = ([DateTime]::Parse($start)).ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $payload = @{ startsAt = $start; endsAt = $end } | ConvertTo-Json
        return (
            Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $payload
        ).data
    }

    $acceptedSlot = New-TestSlot
    $bookingBody = @{
        trainerId = 1
        slotId = $acceptedSlot.id
        location = 'จุดนัดหมายทดสอบ'
        note = 'ทดสอบตอบรับ'
    } | ConvertTo-Json
    $acceptedBooking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body $bookingBody
    ).data

    Expect-Status 409 {
        Invoke-RestMethod -Method Delete -Uri "$ApiUrl/v1/availability-slots/$($acceptedSlot.id)" -Headers $trainerHeaders
    }

    $otherTrainer = Login 'trainer.b@fitconnect.local'
    $otherTrainerHeaders = Auth-Headers $otherTrainer.token
    Expect-Status 403 {
        Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $otherTrainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment' } | ConvertTo-Json)
    }

    $accepted = (
        Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment'; quotedPrice = 1200 } | ConvertTo-Json)
    ).data
    Assert-True ($accepted.status -eq 'awaiting_payment') 'Trainer acceptance must move booking to awaiting_payment'
    Assert-True ([decimal]$accepted.quotedPrice -eq 1200) 'Trainer acceptance must save the final quote'

    $memberBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $memberView = $memberBookings | Where-Object { $_.id -eq $acceptedBooking.id } | Select-Object -First 1
    Assert-True ([decimal]$memberView.quotedPrice -eq 1200) 'Member booking payload must expose the final quote'
    Assert-True ($memberView.chatRoomId -gt 0) 'Booking payload must expose its chat room'
    Assert-True ($memberView.actions.canPay) 'Accepted member booking must allow payment'
    Expect-Status 409 {
        Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'cancelled' } | ConvertTo-Json)
    }

    $rejectedSlot = New-TestSlot
    $rejectBody = @{
        trainerId = 1
        slotId = $rejectedSlot.id
        location = 'จุดนัดหมายทดสอบ'
        note = 'ทดสอบปฏิเสธ'
    } | ConvertTo-Json
    $rejectedBooking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($rejectBody))
    ).data
    Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($rejectedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'cancelled'; note = 'เวลาไม่สะดวก' } | ConvertTo-Json) | Out-Null

    $workspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    $released = $workspace.slots | Where-Object { $_.id -eq $rejectedSlot.id } | Select-Object -First 1
    Assert-True ($released.state -eq 'available') 'Rejected booking must release its slot'

    $trainerBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $trainerHeaders).data
    $trainerView = $trainerBookings | Where-Object { $_.id -eq $rejectedBooking.id } | Select-Object -First 1
    Assert-True (-not [string]::IsNullOrWhiteSpace($trainerView.member.displayName)) 'Trainer booking payload must include member name'
    Assert-True ($trainerView.note -eq 'ทดสอบปฏิเสธ') 'Trainer booking payload must include the member note'

    $contestedSlot = New-TestSlot
    $contestedBody = @{
        trainerId = 1
        slotId = $contestedSlot.id
        location = 'ทดสอบการจองพร้อมกัน'
        note = 'concurrency'
    } | ConvertTo-Json
    $bookingRequest = {
        param([string]$Uri, [string]$Token, [string]$Body)
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Uri -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body $Body
            return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content }
        } catch {
            return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = '' }
        }
    }
    $jobs = 1..2 | ForEach-Object {
        Start-Job -ScriptBlock $bookingRequest -ArgumentList "$ApiUrl/v1/bookings", $member.token, $contestedBody
    }
    $results = @($jobs | Receive-Job -Wait -AutoRemoveJob)
    $codes = (($results.Status | Sort-Object) -join ',')
    Assert-True ($codes -eq '201,409') "Concurrent booking must return 201 and 409, got $codes"
}

Write-Host "PASS API workflow scenario: $Scenario"
