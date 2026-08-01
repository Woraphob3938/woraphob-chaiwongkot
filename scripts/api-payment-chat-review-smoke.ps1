[CmdletBinding()]
param(
    [ValidateSet('payment', 'chat', 'review', 'all')]
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

if ($Scenario -in @('payment', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $admin = Login 'admin.demo@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token
    $adminHeaders = Auth-Headers $admin.token
    $slipPath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-a.png')).Path

    function New-PaymentTestSlot {
        for ($attempt = 1; $attempt -le 30; $attempt++) {
            $start = (Get-Date).ToUniversalTime().Date.AddDays((Get-Random -Minimum 2 -Maximum 50)).AddMinutes((Get-Random -Minimum 0 -Maximum 1380))
            $end = $start.AddHours(1)
            $body = @{
                startsAt = $start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
                endsAt = $end.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            } | ConvertTo-Json
            try {
                return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body).data
            } catch {
                if ([int]$_.Exception.Response.StatusCode -ne 409 -or $attempt -eq 30) { throw }
            }
        }
    }

    function New-AcceptedPaymentBooking {
        param([string]$Label)
        $slot = New-PaymentTestSlot
        $location = "จุดนัดหมายทดสอบการชำระเงิน $Label"
        $bookingBody = @{
            trainerId = 1
            slotId = $slot.id
            location = $location
            note = "payment smoke $Label"
        } | ConvertTo-Json
        $booking = (
            Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($bookingBody))
        ).data
        $accepted = (
            Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($booking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment'; quotedPrice = 1200 } | ConvertTo-Json)
        ).data
        Assert-True ($accepted.status -eq 'awaiting_payment') 'Trainer acceptance must move booking to awaiting_payment'
        Assert-True ([decimal]$accepted.quotedPrice -eq 1200) 'Trainer acceptance must save quotedPrice 1200'
        return [pscustomobject]@{ booking = $booking; slot = $slot; location = $location }
    }

    function Submit-Payment {
        param([string]$BookingId)
        $paymentJson = & curl.exe --silent --show-error --fail-with-body `
            -H "Authorization: Bearer $($member.token)" `
            -F "bookingId=$BookingId" `
            -F 'amount=1200' `
            -F "slip=@$slipPath;type=image/png" `
            "$ApiUrl/v1/payments"
        Assert-True ($LASTEXITCODE -eq 0) "Payment upload failed: $paymentJson"
        $payment = ($paymentJson | ConvertFrom-Json).data
        Assert-True ($payment.status -eq 'reviewing') 'Payment must enter reviewing'
        return $payment
    }

    function Get-QueuePayment {
        param([string]$BookingId)
        $queue = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/admin/review-queue" -Headers $adminHeaders).data
        return $queue.payments | Where-Object { $_.bookingId -eq $BookingId } | Select-Object -First 1
    }

    function Assert-PaymentQueueDetails {
        param([object]$QueuePayment, [object]$Case)
        Assert-True ($null -ne $QueuePayment) 'Submitted payment must appear in the admin queue'
        Assert-True ([decimal]$QueuePayment.amount -eq 1200) 'Admin queue must show the transferred amount'
        Assert-True ([decimal]$QueuePayment.quotedPrice -eq 1200) 'Admin queue must show the quote'
        Assert-True ([decimal]$QueuePayment.difference -eq 0) 'Admin queue must show the numeric payment difference'
        Assert-True ($QueuePayment.trainerName -eq 'เทรนเนอร์สาธิต ก.') 'Admin queue must show the trainer'
        Assert-True (
            ([DateTimeOffset]::Parse($QueuePayment.startsAt)).ToUniversalTime() -eq ([DateTimeOffset]::Parse($Case.slot.startsAt)).ToUniversalTime()
        ) 'Admin queue must show the appointment start'
        Assert-True (
            ([DateTimeOffset]::Parse($QueuePayment.endsAt)).ToUniversalTime() -eq ([DateTimeOffset]::Parse($Case.slot.endsAt)).ToUniversalTime()
        ) 'Admin queue must show the appointment end'
        Assert-True ($QueuePayment.location -eq $Case.location) 'Admin queue must show the appointment location'
    }

    $approvalCase = New-AcceptedPaymentBooking "approve-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    Submit-Payment $approvalCase.booking.id | Out-Null
    $approvalQueuePayment = Get-QueuePayment $approvalCase.booking.id
    Assert-PaymentQueueDetails $approvalQueuePayment $approvalCase

    $approved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($approvalQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = 'หลักฐานถูกต้อง' } | ConvertTo-Json)))
    ).data
    Assert-True ($approved.status -eq 'approved') 'Approved payment must become approved'
    Assert-True ($approved.bookingStatus -eq 'confirmed') 'Approved payment must confirm the booking'
    $approvalBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $approvedBooking = $approvalBookings | Where-Object { $_.id -eq $approvalCase.booking.id } | Select-Object -First 1
    Assert-True ($approvedBooking.status -eq 'confirmed') 'Approved booking must stay confirmed in the booking aggregate'
    Assert-True ($approvedBooking.paymentStatus -eq 'approved') 'Approved booking must expose approved payment status'
    $trainerWorkspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    $approvedSlot = $trainerWorkspace.slots | Where-Object { $_.id -eq $approvalCase.slot.id } | Select-Object -First 1
    Assert-True ($approvedSlot.state -eq 'booked') 'Approval must atomically book the appointment slot'

    $rejectionCase = New-AcceptedPaymentBooking "reject-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    Submit-Payment $rejectionCase.booking.id | Out-Null
    $rejectionQueuePayment = Get-QueuePayment $rejectionCase.booking.id
    Assert-PaymentQueueDetails $rejectionQueuePayment $rejectionCase

    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($rejectionQueuePayment.id)/reject" -Headers $adminHeaders -ContentType 'application/json' -Body (@{ note = '   ' } | ConvertTo-Json)
    }
    $rejectionNote = 'ยอดและหลักฐานไม่ตรงกัน'
    $rejected = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($rejectionQueuePayment.id)/reject" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = $rejectionNote } | ConvertTo-Json)))
    ).data
    Assert-True ($rejected.status -eq 'rejected') 'Rejected payment must become rejected'
    Assert-True ($rejected.bookingStatus -eq 'awaiting_payment') 'Rejected payment must return the booking to awaiting_payment'

    $rejectedBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $rejectedBooking = $rejectedBookings | Where-Object { $_.id -eq $rejectionCase.booking.id } | Select-Object -First 1
    Assert-True ($rejectedBooking.payment.reviewNote -eq $rejectionNote) 'Rejection reason must be saved on the payment'
    $trainerWorkspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    $heldSlot = $trainerWorkspace.slots | Where-Object { $_.id -eq $rejectionCase.slot.id } | Select-Object -First 1
    Assert-True ($heldSlot.state -eq 'held') 'Rejection must preserve the held appointment slot'

    Submit-Payment $rejectionCase.booking.id | Out-Null
    $retryQueuePayment = Get-QueuePayment $rejectionCase.booking.id
    Assert-PaymentQueueDetails $retryQueuePayment $rejectionCase
    Assert-True ($retryQueuePayment.id -ne $rejectionQueuePayment.id) 'Retry must insert a new payment row'
    $retryApproved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($retryQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = 'หลักฐานใหม่ถูกต้อง' } | ConvertTo-Json)))
    ).data
    Assert-True ($retryApproved.bookingStatus -eq 'confirmed') 'Approved retry must confirm the booking'
}

Write-Host "PASS payment/chat/review API scenario: $Scenario"
