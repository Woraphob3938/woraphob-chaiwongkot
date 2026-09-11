[CmdletBinding()]
param(
    [ValidateSet('payment', 'chat', 'review', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiUrl = 'http://localhost/fitconnect-api'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Invoke-RestMethod:TimeoutSec'] = 20
$PSDefaultParameterValues['Invoke-WebRequest:TimeoutSec'] = 20

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) { throw "$Message (expected: $Expected, actual: $Actual)" }
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

function Expect-ApiError {
    param([int]$Status, [string]$Code, [scriptblock]$Action)
    try {
        & $Action | Out-Null
    } catch {
        $actual = [int]$_.Exception.Response.StatusCode
        Assert-True ($actual -eq $Status) "Expected HTTP $Status, got $actual"
        $payload = $_.ErrorDetails.Message | ConvertFrom-Json
        Assert-True ($payload.error.code -eq $Code) "Expected API error $Code, got $($payload.error.code)"
        return
    }
    throw "Expected HTTP $Status / $Code, request succeeded"
}

if ($Scenario -eq 'all') {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $admin = Login 'admin.demo@fitconnect.local'
    $secondMemberEmail = "instant.rebook.$([Guid]::NewGuid().ToString('N').Substring(0, 10))@fitconnect.local"
    $secondMemberBody = @{
        displayName = 'สมาชิกจองต่อ'
        email = $secondMemberEmail
        password = 'password'
        role = 'member'
    } | ConvertTo-Json
    $secondMember = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/register" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($secondMemberBody))).data
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token
    $secondMemberHeaders = Auth-Headers $secondMember.token
    $adminHeaders = Auth-Headers $admin.token
    $evidencePath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-a.png')).Path
    $evidenceFile = Get-Item -LiteralPath $evidencePath
    $mysqlExe = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path

    function Invoke-AllFlowSql {
        param([string]$Sql)
        $output = & $mysqlExe --host=127.0.0.1 --port=3306 --user=root --database=fitconnect --batch --skip-column-names --execute=$Sql 2>&1
        Assert-True ($LASTEXITCODE -eq 0) "Post-booking smoke SQL failed: $output"
        return @($output)
    }

    function New-AllFlowSlot {
        for ($attempt = 1; $attempt -le 30; $attempt++) {
            $start = (Get-Date).ToUniversalTime().Date.AddDays((Get-Random -Minimum 2 -Maximum 50)).AddMinutes((Get-Random -Minimum 0 -Maximum 1380))
            $body = @{
                startsAt = $start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
                endsAt = $start.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            } | ConvertTo-Json
            try {
                return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body).data
            } catch {
                if ([int]$_.Exception.Response.StatusCode -ne 409 -or $attempt -eq 30) { throw }
            }
        }
    }

    function Submit-AllFlowPayment {
        param([string]$BookingId)
        $paymentJson = & curl.exe --silent --show-error --fail-with-body `
            --max-time 20 `
            -H "Authorization: Bearer $($member.token)" `
            -F "bookingId=$BookingId" `
            -F "slip=@$evidencePath;type=image/png" `
            "$ApiUrl/v1/payments"
        Assert-True ($LASTEXITCODE -eq 0) "Payment upload failed: $paymentJson"
        $payment = ($paymentJson | ConvertFrom-Json).data
        Assert-True ($payment.status -eq 'reviewing') 'Payment must enter reviewing'
        return $payment
    }

    function Get-AllFlowQueuePayment {
        param([string]$BookingId)
        $queue = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/admin/review-queue" -Headers $adminHeaders).data
        return $queue.payments |
            Where-Object { $_.bookingId -eq $BookingId } |
            Sort-Object id -Descending |
            Select-Object -First 1
    }

    $slot = New-AllFlowSlot
    $label = [Guid]::NewGuid().ToString('N').Substring(0, 10).ToUpperInvariant()
    $bookingBody = @{
        trainerId = 1
        slotId = $slot.id
        note = "post-booking smoke $label"
    } | ConvertTo-Json
    $booking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($bookingBody))
    ).data
    Assert-True ($booking.id -match '^BK-[A-Z0-9-]{3,32}$') 'Created booking must expose a safe public booking id'
    Assert-Equal 'awaiting_payment' $booking.status 'New booking must start in awaiting_payment'
    Assert-True ([decimal]$booking.quotedPrice -gt 0) 'New booking must snapshot a positive trainer price'
    Assert-True ([DateTime]::Parse($booking.paymentDeadlineAt).ToUniversalTime() -gt [DateTime]::UtcNow) 'New booking deadline must be in the future'

    $memberBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $createdBooking = $memberBookings | Where-Object { $_.id -eq $booking.id } | Select-Object -First 1
    Assert-True ($createdBooking.chatRoomId -gt 0) 'Instant booking must expose its chat room'
    $roomId = [int]$createdBooking.chatRoomId

    $text = "พร้อมเจอกันตามนัด $label"
    $textMessage = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ message = $text } | ConvertTo-Json)))
    ).data
    Assert-True ($textMessage.message -eq $text) 'Member text message must remain intact'

    $attachmentJson = & curl.exe --silent --show-error --fail-with-body `
        --max-time 20 `
        -H "Authorization: Bearer $($member.token)" `
        -F "attachment=@$evidencePath;type=image/png" `
        "$ApiUrl/v1/chat-rooms/$roomId/messages"
    Assert-True ($LASTEXITCODE -eq 0) "Chat attachment upload failed: $attachmentJson"
    $attachmentMessage = ($attachmentJson | ConvertFrom-Json).data
    Assert-True ($attachmentMessage.id -gt $textMessage.id) 'Member image message must follow the text message'
    Assert-True ($attachmentMessage.attachment.name -eq $evidenceFile.Name) 'Member image metadata must preserve its safe name'

    Submit-AllFlowPayment $booking.id | Out-Null
    $firstQueuePayment = Get-AllFlowQueuePayment $booking.id
    Assert-True ($null -ne $firstQueuePayment) 'First payment must appear in the admin queue'
    $rejectionReason = 'ยอดและหลักฐานไม่ตรงกัน กรุณาส่งใหม่'
    $rejected = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($firstQueuePayment.id)/reject" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = $rejectionReason } | ConvertTo-Json)))
    ).data
    Assert-True ($rejected.status -eq 'rejected') 'Admin rejection must reject the first payment'
    Assert-True ($rejected.bookingStatus -eq 'awaiting_payment') 'Admin rejection must return the booking to awaiting_payment'
    Assert-True ([DateTime]::Parse($rejected.paymentDeadlineAt).ToUniversalTime() -gt [DateTime]::UtcNow) 'First rejection must grant one fresh 10-minute deadline'

    Submit-AllFlowPayment $booking.id | Out-Null
    $secondQueuePayment = Get-AllFlowQueuePayment $booking.id
    Assert-True ($secondQueuePayment.id -ne $firstQueuePayment.id) 'Second payment must create a new attempt'
    $approved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($secondQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = 'หลักฐานรอบที่สองถูกต้อง'; bankConfirmed = $true } | ConvertTo-Json)))
    ).data
    Assert-True ($approved.status -eq 'approved') 'Admin approval must approve the second payment'
    Assert-True ($approved.bookingStatus -eq 'confirmed') 'Admin approval must confirm the booking'

    $expirySlot = New-AllFlowSlot
    $expiryBookingBody = @{
        trainerId = 1
        slotId = $expirySlot.id
        note = "expiry smoke $label"
    } | ConvertTo-Json
    $expiryBooking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($expiryBookingBody))
    ).data
    Assert-Equal 'awaiting_payment' $expiryBooking.status 'Expiry fixture must start in awaiting_payment'
    Assert-True ([decimal]$expiryBooking.quotedPrice -gt 0) 'Expiry fixture must snapshot a positive trainer price'
    Assert-True ([DateTime]::Parse($expiryBooking.paymentDeadlineAt).ToUniversalTime() -gt [DateTime]::UtcNow) 'Expiry fixture deadline must start in the future'

    $expirySetup = @(Invoke-AllFlowSql "UPDATE bookings SET payment_deadline_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE public_id = '$($expiryBooking.id)' AND status = 'awaiting_payment'; SELECT ROW_COUNT();")
    Assert-True ([int]$expirySetup[-1] -eq 1) 'Expiry setup must update exactly one awaiting-payment booking'
    $phpExe = (Resolve-Path 'C:\xampp\php\php.exe').Path
    $expiryCommand = (Resolve-Path (Join-Path $PSScriptRoot '..\backend\scripts\expire-bookings.php')).Path
    $expiryCommandOutput = @(& $phpExe $expiryCommand 2>&1)
    Assert-True ($LASTEXITCODE -eq 0) "Booking expiry command failed: $expiryCommandOutput"
    $expiryCommandResult = ([string]$expiryCommandOutput[-1]) | ConvertFrom-Json
    Assert-True ([int]$expiryCommandResult.expired -ge 1) 'Booking expiry command must expire at least the overdue fixture'

    $expiryAuditSql = @"
SELECT
  (SELECT status FROM bookings WHERE public_id = '$($expiryBooking.id)'),
  (SELECT COUNT(*) FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id WHERE b.public_id = '$($expiryBooking.id)' AND h.from_status = 'awaiting_payment' AND h.to_status = 'expired'),
  (SELECT s.state FROM availability_slots s WHERE s.id = $($expirySlot.id));
"@
    $expiryAuditOutput = @(Invoke-AllFlowSql $expiryAuditSql)
    $expiryAudit = ([string]$expiryAuditOutput[-1]) -split "`t"
    Assert-Equal 'expired' $expiryAudit[0] 'Background command must expire the overdue booking'
    Assert-True ([int]$expiryAudit[1] -eq 1) 'Expiry must write exactly one awaiting_payment to expired history row'
    Assert-Equal 'available' $expiryAudit[2] 'Expiry must release the original slot'

    $rebookBody = @{
        trainerId = 1
        slotId = $expirySlot.id
        note = "rebook after expiry $label"
    } | ConvertTo-Json
    $rebookedBooking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $secondMemberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($rebookBody))
    ).data
    Assert-Equal 'awaiting_payment' $rebookedBooking.status 'Another member must be able to hold the released slot'
    Assert-True ($rebookedBooking.id -ne $expiryBooking.id) 'Rebooking must create a distinct booking'
    $rebookSlotOutput = @(Invoke-AllFlowSql "SELECT state FROM availability_slots WHERE id = $($expirySlot.id);")
    Assert-Equal 'held' ([string]$rebookSlotOutput[-1]) 'Rebooked slot must be held by the new booking'

    Expect-Status 404 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings/$($rebookedBooking.id)/cancel" -Headers $memberHeaders
    }
    $cancelledRebooking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings/$($rebookedBooking.id)/cancel" -Headers $secondMemberHeaders
    ).data
    Assert-Equal 'cancelled' $cancelledRebooking.status 'The member must be able to cancel their unpaid booking'

    $cancellationAuditOutput = @(Invoke-AllFlowSql @"
SELECT
  b.status,
  IF(b.payment_deadline_at IS NULL, 1, 0),
  b.cancellation_reason,
  s.state,
  (SELECT COUNT(*) FROM booking_status_history h WHERE h.booking_id = b.id AND h.from_status = 'awaiting_payment' AND h.to_status = 'cancelled')
FROM bookings b
JOIN availability_slots s ON s.id = b.availability_slot_id
WHERE b.public_id = '$($rebookedBooking.id)';
"@)
    $cancellationAudit = ([string]$cancellationAuditOutput[-1]) -split "`t"
    Assert-Equal 'cancelled' $cancellationAudit[0] 'Cancellation must persist the cancelled status'
    Assert-Equal 1 ([int]$cancellationAudit[1]) 'Cancellation must clear the payment deadline'
    Assert-Equal 'สมาชิกยกเลิกก่อนส่งหลักฐานการชำระเงิน' $cancellationAudit[2] 'Cancellation must store its reason'
    Assert-Equal 'available' $cancellationAudit[3] 'Cancellation must release the held slot'
    Assert-Equal 1 ([int]$cancellationAudit[4]) 'Cancellation must write one history row'

    $completed = $null
    try {
        $endUpdateOutput = @(Invoke-AllFlowSql "SET GLOBAL check_constraint_checks = OFF; SET SESSION check_constraint_checks = OFF; UPDATE bookings SET ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE public_id = '$($booking.id)'; SELECT ROW_COUNT();")
        Assert-True ([int]$endUpdateOutput[-1] -eq 1) 'Test setup must move only this booking end time into the past'
        $completed = (
            Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($booking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ status = 'completed'; note = 'ฝึกเสร็จตามนัด' } | ConvertTo-Json)))
        ).data
    } finally {
        Invoke-AllFlowSql 'SET GLOBAL check_constraint_checks = ON;' | Out-Null
    }
    Assert-True ($completed.status -eq 'completed') 'Owning trainer must complete the paid booking'

    $review = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{
            bookingId = $booking.id
            rating = 5
            comment = 'ฝึกดี ตรงเวลา และดูแลครบถ้วน'
        } | ConvertTo-Json)))
    ).data
    Assert-True ($review.rating -eq 5) 'Member review must persist five stars'
    Assert-True ($review.status -eq 'published') 'Member review must be published'

    $countSql = @"
SELECT
  (SELECT COUNT(*) FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id WHERE b.public_id = '$($booking.id)'),
  (SELECT COUNT(*) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.public_id = '$($booking.id)'),
  (SELECT COUNT(*) FROM messages m JOIN chat_rooms cr ON cr.id = m.chat_room_id JOIN bookings b ON b.id = cr.booking_id WHERE b.public_id = '$($booking.id)'),
  (SELECT COUNT(*) FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.public_id = '$($booking.id)');
"@
    $countOutput = @(Invoke-AllFlowSql $countSql)
    $counts = ([string]$countOutput[-1]) -split "`t"
    Assert-True ($counts.Count -eq 4) 'Smoke count query must return four counts'
    $historyCount = [int]$counts[0]
    $paymentCount = [int]$counts[1]
    $messageCount = [int]$counts[2]
    $reviewCount = [int]$counts[3]
    Assert-True ($historyCount -ge 6) 'Booking must have a complete instant-booking status history'
    Assert-True ($paymentCount -eq 2) 'Rejected and approved payment attempts must remain stored'
    Assert-True ($messageCount -ge 2) 'Chat text and attachment must remain stored'
    Assert-True ($reviewCount -eq 1) 'Completed booking must have one review'

    $evidenceDirectory = Join-Path $PSScriptRoot '..\output\smoke'
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    $evidence = [ordered]@{
        approvedBookingId = $booking.id
        expiredBookingId = $expiryBooking.id
        rebookedBookingId = $rebookedBooking.id
        generatedAt = [DateTime]::UtcNow.ToString('o')
    }
    $evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'instant-booking-result.json') -Encoding utf8

    Write-Host "Approved smoke booking id: $($booking.id)"
    Write-Host "Expired smoke booking id: $($expiryBooking.id)"
    Write-Host "Rebooked smoke booking id: $($rebookedBooking.id)"
    Write-Host "Smoke counts: history=$historyCount payments=$paymentCount messages=$messageCount reviews=$reviewCount"
    & (Join-Path $PSScriptRoot 'audit-booking.ps1') -BookingId $booking.id
    & (Join-Path $PSScriptRoot 'audit-booking.ps1') -BookingId $expiryBooking.id
    Write-Host 'PASS payment/chat/review API scenario: all'
    return
}

if ($Scenario -in @('payment', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $admin = Login 'admin.demo@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token
    $adminHeaders = Auth-Headers $admin.token
    $slipPath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-a.png')).Path

    function New-LegacyPaymentFixture {
        $publicId = "BK-LEGACY-$([Guid]::NewGuid().ToString('N').Substring(0, 10).ToUpperInvariant())"
        $sql = @"
INSERT INTO bookings
    (public_id, member_user_id, trainer_profile_id, starts_at, ends_at, member_note, quoted_price, payment_service_mode, status, payment_status, is_demo)
VALUES
    ('$publicId', 1, 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY) + INTERVAL 1 HOUR,
     'legacy payment regression fixture', NULL, 'gym', 'payment_review', 'reviewing', 0);
SET @legacy_booking_id = LAST_INSERT_ID();
INSERT INTO payments
    (booking_id, submitted_by_user_id, amount, slip_path, mime_type, status, submitted_at)
VALUES
    (@legacy_booking_id, 1, NULL, 'uploads/payments/legacy-regression-fixture.png', 'image/png', 'reviewing', UTC_TIMESTAMP());
"@
        $mysqlPath = 'C:\xampp\mysql\bin\mysql.exe'
        $output = $sql | & $mysqlPath --default-character-set=utf8mb4 -u root fitconnect 2>&1
        Assert-True ($LASTEXITCODE -eq 0) "Could not create legacy payment fixture: $output"
        return $publicId
    }

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
        $bookingBody = @{
            trainerId = 1
            slotId = $slot.id
            note = "payment smoke $Label"
        } | ConvertTo-Json
        $booking = (
            Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($bookingBody))
        ).data
        Assert-True ($booking.status -eq 'awaiting_payment') 'Instant booking must move directly to awaiting_payment'
        Assert-True ([decimal]$booking.quotedPrice -gt 0) 'Instant booking must snapshot the trainer price'
        return [pscustomobject]@{ booking = $booking; slot = $slot }
    }

    function Submit-Payment {
        param([string]$BookingId)
        $paymentJson = & curl.exe --silent --show-error --fail-with-body `
            --max-time 20 `
            -H "Authorization: Bearer $($member.token)" `
            -F "bookingId=$BookingId" `
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
        Assert-True ([decimal]$QueuePayment.amount -eq [decimal]$Case.booking.quotedPrice) 'Admin queue must show the server-locked amount'
        Assert-True ([decimal]$QueuePayment.quotedPrice -eq [decimal]$Case.booking.quotedPrice) 'Admin queue must show the quote'
        Assert-True ([decimal]$QueuePayment.difference -eq 0) 'Admin queue must show the numeric payment difference'
        Assert-True ($QueuePayment.trainerName -eq 'เทรนเนอร์สาธิต ก.') 'Admin queue must show the trainer'
        Assert-True (
            ([DateTimeOffset]::Parse($QueuePayment.startsAt)).ToUniversalTime() -eq ([DateTimeOffset]::Parse($Case.slot.startsAt)).ToUniversalTime()
        ) 'Admin queue must show the appointment start'
        Assert-True (
            ([DateTimeOffset]::Parse($QueuePayment.endsAt)).ToUniversalTime() -eq ([DateTimeOffset]::Parse($Case.slot.endsAt)).ToUniversalTime()
        ) 'Admin queue must show the appointment end'
    }

    $legacyBookingId = New-LegacyPaymentFixture
    $legacyQueuePayment = $null
    try {
        $legacyQueuePayment = Get-QueuePayment $legacyBookingId
        Assert-True ($null -ne $legacyQueuePayment) 'Legacy reviewing payment must remain visible in the admin queue'
        Assert-True ($null -eq $legacyQueuePayment.amount) 'Legacy unknown payment amount must remain null'
        Assert-True ($null -eq $legacyQueuePayment.quotedPrice) 'Legacy unknown quote must remain null'
        Assert-True ($null -eq $legacyQueuePayment.difference) 'Legacy unknown payment difference must remain null'
    } finally {
        if ($null -ne $legacyQueuePayment) {
            Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($legacyQueuePayment.id)/reject" -Headers $adminHeaders -ContentType 'application/json' -Body (@{ note = 'legacy regression fixture complete' } | ConvertTo-Json) | Out-Null
        }
    }

    $approvalCase = New-AcceptedPaymentBooking "approve-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    Submit-Payment $approvalCase.booking.id | Out-Null
    $approvalQueuePayment = Get-QueuePayment $approvalCase.booking.id
    Assert-PaymentQueueDetails $approvalQueuePayment $approvalCase

    Expect-ApiError 422 'BANK_CONFIRMATION_REQUIRED' {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($approvalQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body '{}'
    }

    $approved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($approvalQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = 'หลักฐานถูกต้อง'; bankConfirmed = $true } | ConvertTo-Json)))
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
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/payments/$($retryQueuePayment.id)/approve" -Headers $adminHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ note = 'หลักฐานใหม่ถูกต้อง'; bankConfirmed = $true } | ConvertTo-Json)))
    ).data
    Assert-True ($retryApproved.bookingStatus -eq 'confirmed') 'Approved retry must confirm the booking'
}

if ($Scenario -in @('chat', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $admin = Login 'admin.demo@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token
    $adminHeaders = Auth-Headers $admin.token
    $attachmentPath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-a.png')).Path
    $attachmentFile = Get-Item -LiteralPath $attachmentPath

    function Get-OrCreate-ChatOutsider {
        $email = 'chat.outsider@fitconnect.local'
        try {
            return Login $email
        } catch {
            if ([int]$_.Exception.Response.StatusCode -ne 401) { throw }
        }

        $body = @{
            displayName = 'สมาชิกนอกห้องสนทนา'
            email = $email
            password = 'password'
            role = 'member'
        } | ConvertTo-Json
        return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/register" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))).data
    }

    function New-ChatTestSlot {
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

    function Invoke-ChatSql {
        param([string]$Sql)
        $mysqlPath = 'C:\xampp\mysql\bin\mysql.exe'
        $output = $Sql | & $mysqlPath --connect-timeout=5 --default-character-set=utf8mb4 --batch --skip-column-names -u root fitconnect 2>&1
        Assert-True ($LASTEXITCODE -eq 0) "Chat fixture SQL failed: $output"
        return @($output)
    }

    $outsider = Get-OrCreate-ChatOutsider
    $outsiderHeaders = Auth-Headers $outsider.token
    $slot = New-ChatTestSlot
    $label = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $bookingBody = @{
        trainerId = 1
        slotId = $slot.id
        note = "chat smoke $label"
    } | ConvertTo-Json
    $booking = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($bookingBody))
    ).data
    Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($booking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment'; quotedPrice = 1200 } | ConvertTo-Json) | Out-Null

    $memberBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $acceptedBooking = $memberBookings | Where-Object { $_.id -eq $booking.id } | Select-Object -First 1
    Assert-True ($acceptedBooking.chatRoomId -gt 0) 'Accepted booking must expose its chat room'
    $roomId = [int]$acceptedBooking.chatRoomId

    $text = "พร้อมเจอกันตามนัด $label"
    $textMessage = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{ message = $text } | ConvertTo-Json)))
    ).data
    Assert-True ($textMessage.id -gt 0) 'Text message must be persisted'
    Assert-True ($textMessage.message -eq $text) 'Text message response must preserve the message'

    $memberOwnPoll = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=0" -Headers $memberHeaders).data
    $memberOwnMessage = $memberOwnPoll | Where-Object { $_.id -eq $textMessage.id } | Select-Object -First 1
    Assert-True ($null -ne $memberOwnMessage) 'Message polling must return the persisted text message'
    Assert-True ($null -eq $memberOwnMessage.readAt) 'Polling must not mark the participant own message as read'

    Expect-Status 422 {
        Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=-1" -Headers $memberHeaders
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=not-a-number" -Headers $memberHeaders
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ message = ('ก' * 4001) } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ message = '   ' } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ message = @('not', 'text') } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ message = @{ nested = 'not text' } } | ConvertTo-Json -Depth 4)
    }

    $multipartArrayStatus = & curl.exe --silent --show-error --output NUL --write-out '%{http_code}' `
        --max-time 20 `
        -H "Authorization: Bearer $($member.token)" `
        -F 'message[]=not-text' `
        "$ApiUrl/v1/chat-rooms/$roomId/messages"
    Assert-True ($LASTEXITCODE -eq 0) 'Multipart array validation request failed before receiving an HTTP status'
    Assert-True ([int]$multipartArrayStatus -eq 422) "Multipart message array must return HTTP 422, got $multipartArrayStatus"

    $attachmentJson = & curl.exe --silent --show-error --fail-with-body `
        --max-time 20 `
        -H "Authorization: Bearer $($trainer.token)" `
        -F "attachment=@$attachmentPath;type=image/png" `
        "$ApiUrl/v1/chat-rooms/$roomId/messages"
    Assert-True ($LASTEXITCODE -eq 0) "Chat attachment upload failed: $attachmentJson"
    $attachmentMessage = ($attachmentJson | ConvertFrom-Json).data
    Assert-True ($attachmentMessage.id -gt $textMessage.id) 'Attachment message must be inserted after the text message'

    $laterMessages = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=$($textMessage.id)" -Headers $memberHeaders).data
    Assert-True ($laterMessages.Count -eq 1) 'Cursor polling must return only messages after afterId'
    Assert-True ($laterMessages[0].id -eq $attachmentMessage.id) 'Cursor polling must return the later attachment message'
    Assert-True ($laterMessages[0].attachment.name -eq $attachmentFile.Name) 'Attachment metadata must preserve a safe display name'
    Assert-True ($laterMessages[0].attachment.mime -eq 'image/png') 'Attachment metadata must expose detected MIME type'
    Assert-True ([int64]$laterMessages[0].attachment.size -eq $attachmentFile.Length) 'Attachment metadata must expose the exact byte size'
    Assert-True ($laterMessages[0].attachment.url -eq "/v1/chat-rooms/$roomId/messages/$($attachmentMessage.id)/attachment") 'Attachment metadata must expose only the protected API URL'
    Assert-True (-not [string]::IsNullOrWhiteSpace($laterMessages[0].readAt)) 'Polling must mark the other participant message as read'
    $attachmentPayload = $laterMessages[0].attachment | ConvertTo-Json -Compress
    Assert-True ($attachmentPayload -notmatch 'uploads[/\\]') 'Attachment metadata must never expose the upload path'
    Assert-True ($attachmentPayload -notmatch '\\') 'Attachment metadata must never expose a filesystem path'

    $trainerPoll = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=0" -Headers $trainerHeaders).data
    $trainerViewOfMemberMessage = $trainerPoll | Where-Object { $_.id -eq $textMessage.id } | Select-Object -First 1
    Assert-True (-not [string]::IsNullOrWhiteSpace($trainerViewOfMemberMessage.readAt)) 'Trainer polling must mark the member message as read'

    $paginationBaseId = [int64]$attachmentMessage.id
    $bulkValues = 1..501 | ForEach-Object { "($roomId, $($trainer.user.id), 'pagination unread fixture $_')" }
    $bulkSql = "INSERT INTO messages (chat_room_id, sender_user_id, message_text) VALUES $($bulkValues -join ','); SELECT MAX(id) FROM messages WHERE chat_room_id = $roomId;"
    $bulkOutput = @(Invoke-ChatSql $bulkSql)
    $bulkMaxId = [int64]$bulkOutput[-1]

    $pageOne = @((Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=$paginationBaseId" -Headers $memberHeaders).data)
    Assert-True ($pageOne.Count -eq 500) 'First unread page must return exactly 500 messages'
    Assert-True (($pageOne | Where-Object { [string]::IsNullOrWhiteSpace($_.readAt) }).Count -eq 0) 'Every returned page-one trainer message must be marked read'
    $pageOneLastId = [int64]$pageOne[-1].id
    Assert-True ($pageOneLastId -lt $bulkMaxId) 'The overflow message must remain outside page one'

    $pageOneReadOutput = @(Invoke-ChatSql "SELECT COUNT(*) FROM messages WHERE chat_room_id = $roomId AND id > $paginationBaseId AND id <= $bulkMaxId AND read_at IS NOT NULL;")
    $pageOneUnreadOutput = @(Invoke-ChatSql "SELECT COUNT(*) FROM messages WHERE chat_room_id = $roomId AND id > $paginationBaseId AND id <= $bulkMaxId AND read_at IS NULL;")
    $pageOneReadCount = [int]$pageOneReadOutput[-1]
    $pageOneUnreadCount = [int]$pageOneUnreadOutput[-1]
    Assert-True ($pageOneReadCount -eq 500) "Page one must mark exactly 500 messages read, got $pageOneReadCount"
    Assert-True ($pageOneUnreadCount -eq 1) "The page-two overflow message must remain unread, got $pageOneUnreadCount unread"

    $pageTwo = @((Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=$pageOneLastId" -Headers $memberHeaders).data)
    Assert-True ($pageTwo.Count -eq 1) 'Second unread page must return only the overflow message'
    Assert-True ([int64]$pageTwo[0].id -eq $bulkMaxId) 'Second unread page must return the exact overflow message'
    Assert-True (-not [string]::IsNullOrWhiteSpace($pageTwo[0].readAt)) 'The overflow message must be marked read when page two returns it'
    $allReadOutput = @(Invoke-ChatSql "SELECT COUNT(*) FROM messages WHERE chat_room_id = $roomId AND id > $paginationBaseId AND id <= $bulkMaxId AND read_at IS NOT NULL;")
    $allReadCount = [int]$allReadOutput[-1]
    Assert-True ($allReadCount -eq 501) 'Both pages together must mark all 501 fixture messages read'

    Expect-Status 403 {
        Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $outsiderHeaders
    }
    Expect-Status 403 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $outsiderHeaders -ContentType 'application/json' -Body (@{ message = 'ห้ามส่งเข้าห้องของผู้อื่น' } | ConvertTo-Json)
    }
    Expect-Status 403 {
        Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages/$($attachmentMessage.id)/attachment" -Headers $outsiderHeaders
    }
    Expect-Status 403 {
        Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $adminHeaders
    }

    $attachmentResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages/$($attachmentMessage.id)/attachment" -Headers $memberHeaders
    Assert-True ($attachmentResponse.StatusCode -eq 200) 'Participant must be able to download a protected attachment'
    Assert-True ([string]$attachmentResponse.Headers['Content-Type'] -eq 'image/png') 'Attachment response must use the detected MIME type'
    Assert-True ([int64]$attachmentResponse.Headers['Content-Length'] -eq $attachmentFile.Length) 'Attachment response must use the exact byte length'
    Assert-True ([string]$attachmentResponse.Headers['Content-Disposition'] -match [regex]::Escape($attachmentFile.Name)) 'Attachment response must use the safe display filename'
    Assert-True ([string]$attachmentResponse.Headers['Content-Disposition'] -notmatch 'uploads[/\\]') 'Attachment response must not reveal its upload path'
    Assert-True ([string]$attachmentResponse.Headers['X-Content-Type-Options'] -match '(^|,)nosniff(,|$)') 'Attachment response must disable MIME sniffing'
    Assert-True ([string]$attachmentResponse.Headers['Cache-Control'] -eq 'private, no-store') 'Attachment response must not be publicly cached'

    Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($booking.id)/status" -Headers $adminHeaders -ContentType 'application/json' -Body (@{ status = 'cancelled'; note = 'chat smoke complete' } | ConvertTo-Json) | Out-Null
    $cancelledMessages = @((Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=$pageOneLastId" -Headers $memberHeaders).data)
    Assert-True ($cancelledMessages.Count -eq 1) 'Cancelled booking chat must remain readable'
    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ message = 'ข้อความหลังยกเลิก' } | ConvertTo-Json)
    }
}

if ($Scenario -in @('review', 'all')) {
    $member = Login 'member.demo@fitconnect.local'
    $memberHeaders = Auth-Headers $member.token

    function Get-OrCreate-ReviewOutsider {
        $email = 'review.outsider@fitconnect.local'
        try {
            return Login $email
        } catch {
            if ([int]$_.Exception.Response.StatusCode -ne 401) { throw }
        }

        $body = @{
            displayName = 'สมาชิกนอกการจองรีวิว'
            email = $email
            password = 'password'
            role = 'member'
        } | ConvertTo-Json
        return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/register" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))).data
    }

    function New-ReviewBookingFixture {
        param([ValidateSet('completed', 'confirmed')][string]$Status)
        $publicId = "BK-REVIEW-$([Guid]::NewGuid().ToString('N').Substring(0, 10).ToUpperInvariant())"
        $sql = @"
INSERT INTO bookings
    (public_id, member_user_id, trainer_profile_id, starts_at, ends_at, member_note, quoted_price, status, payment_status, is_demo)
VALUES
    ('$publicId', 1, 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR),
     'review smoke $Status fixture', 1200, '$Status', 'approved', 0);
"@
        $mysqlPath = 'C:\xampp\mysql\bin\mysql.exe'
        $output = $sql | & $mysqlPath --connect-timeout=5 --default-character-set=utf8mb4 -u root fitconnect 2>&1
        Assert-True ($LASTEXITCODE -eq 0) "Could not create review fixture: $output"
        return $publicId
    }

    $outsider = Get-OrCreate-ReviewOutsider
    $outsiderHeaders = Auth-Headers $outsider.token
    $completedBookingId = New-ReviewBookingFixture 'completed'
    $confirmedBookingId = New-ReviewBookingFixture 'confirmed'

    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = 5
            comment = '   '
        } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = 6
            comment = 'คะแนนเกินช่วงที่กำหนด'
        } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = @(5)
            comment = 'คะแนนต้องไม่เป็นอาร์เรย์'
        } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = 5
            comment = @('ความคิดเห็น', 'หลายค่า')
        } | ConvertTo-Json)
    }
    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = @($completedBookingId)
            rating = 5
            comment = 'รหัสการจองต้องไม่เป็นอาร์เรย์'
        } | ConvertTo-Json)
    }

    $trimmedComment = 'บริการดีและตรงต่อเวลา'
    $createReviewResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((@{
            bookingId = $completedBookingId
            rating = '5'
            comment = "  $trimmedComment  "
        } | ConvertTo-Json)))
    Assert-True ($createReviewResponse.StatusCode -eq 201) "Created review must return HTTP 201, got $($createReviewResponse.StatusCode)"
    $createdReview = ($createReviewResponse.Content | ConvertFrom-Json).data
    Assert-True ($createdReview.bookingId -eq $completedBookingId) 'Created review must return its booking ID'
    Assert-True ($createdReview.rating -is [int] -and $createdReview.rating -eq 5) 'Created review must return a normalized numeric rating'
    Assert-True ($createdReview.comment -eq $trimmedComment) 'Created review must return the trimmed comment'
    Assert-True ($createdReview.status -eq 'published') 'Created review must be published'

    Expect-ApiError 409 'REVIEW_EXISTS' {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = 4
            comment = 'ไม่ควรรีวิวซ้ำได้'
        } | ConvertTo-Json)
    }
    Expect-ApiError 404 'BOOKING_NOT_FOUND' {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $outsiderHeaders -ContentType 'application/json' -Body (@{
            bookingId = $completedBookingId
            rating = 5
            comment = 'ไม่ใช่เจ้าของการจอง'
        } | ConvertTo-Json)
    }
    Expect-ApiError 409 'REVIEW_NOT_READY' {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{
            bookingId = $confirmedBookingId
            rating = 5
            comment = 'ยังฝึกไม่เสร็จ'
        } | ConvertTo-Json)
    }

    $memberBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
    $reviewedBooking = $memberBookings | Where-Object { $_.id -eq $completedBookingId } | Select-Object -First 1
    Assert-True ($null -ne $reviewedBooking) 'Reviewed booking must remain in the member booking aggregate'
    Assert-True ($reviewedBooking.review.rating -eq 5) 'Booking aggregate must expose the persisted review rating'
    Assert-True ($reviewedBooking.review.comment -eq $trimmedComment) 'Booking aggregate must expose the persisted trimmed comment'
    Assert-True ($reviewedBooking.review.status -eq 'published') 'Booking aggregate must expose the published review status'
    Assert-True ($reviewedBooking.actions.canReview -eq $false) 'Member must not be able to review again after publication'

    $publicTrainer = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainers/demo-trainer-a").data
    Assert-True ($publicTrainer.reviews.Count -eq $publicTrainer.reviewCount) 'Public trainer review detail count must match the aggregate'
    Assert-True ($publicTrainer.reviews.Count -gt 0) 'Public trainer detail must expose completed-booking reviews'
    $latestPublicReview = $publicTrainer.reviews[0]
    Assert-True ($latestPublicReview.comment -eq $trimmedComment) 'Newest public review must be ordered first'
    Assert-True ($latestPublicReview.rating -eq 5) 'Public review must expose its numeric rating'
    Assert-True (-not [string]::IsNullOrWhiteSpace($latestPublicReview.createdAt)) 'Public review must expose its creation date'
    $publicReviewFields = @($latestPublicReview.PSObject.Properties.Name | Sort-Object)
    Assert-True (($publicReviewFields -join ',') -eq 'comment,createdAt,rating') 'Public reviews must not expose internal IDs or member identity'

    Write-Host "Review smoke fixtures: completed=$completedBookingId confirmed=$confirmedBookingId outsider=review.outsider@fitconnect.local"
}

Write-Host "PASS payment/chat/review API scenario: $Scenario"
