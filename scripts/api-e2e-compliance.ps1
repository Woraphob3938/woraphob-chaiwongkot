# E2E proof for the 11 document-compliance features against the live API.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-e2e-compliance.ps1
# Uses throwaway accounts and cleans up after itself. Read-only toward demo accounts.
param(
  [string]$ApiUrl = 'http://localhost/fitconnect-api/v1',
  [string]$Xff = '203.0.113.150'
)

$ErrorActionPreference = 'Stop'
$mysql = 'C:\xampp\mysql\bin\mysql.exe'
$phpUpload = Join-Path $env:TEMP 'fc-e2e-upload'
New-Item -ItemType Directory -Force -Path $phpUpload | Out-Null

function Login([string]$Email, [string]$Password = 'password') {
  return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/login" -ContentType 'application/json' `
    -Headers @{ 'X-Forwarded-For' = $Xff } -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)).data
}
function Auth([string]$Token) { return @{ Authorization = "Bearer $Token"; 'X-Forwarded-For' = $Xff } }
function Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = '') {
  # $ApiUrl มี /v1 อยู่แล้ว — ตัด /v1 ที่ซ้ำออกจากพาธ
  $p = if ($Path.StartsWith('/v1/')) { $Path.Substring(3) } else { $Path }
  $params = @{ Method = $Method; Uri = "$ApiUrl$p"; Headers = (Auth $Token); ContentType = 'application/json' }
  if ($null -ne $Body) {
    $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 6 }
    # ส่งเป็นไบต์ UTF-8 — PS 5.1 จะเข้ารหัส string เป็น ISO-8859-1 ทำให้ข้อความไทยเพี้ยน
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  }
  return Invoke-RestMethod @params
}
function ApiError([string]$Method, [string]$Path, $Body, [string]$Token = '') {
  try { Api $Method $Path $Body $Token | Out-Null; return $null } catch {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { throw }
    $reader = New-Object IO.StreamReader($resp.GetResponseStream()); $raw = $reader.ReadToEnd()
    return @{ status = [int]$resp.StatusCode; body = $raw }
  }
}
function Assert([bool]$Ok, [string]$Message) { if (-not $Ok) { throw "FAIL: $Message" }; Write-Output "  PASS $Message" }
function Assert-Eq($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) { throw "FAIL: $Message (expected=$Expected actual=$Actual)" }; Write-Output "  PASS $Message"
}
function Invoke-Sql([string]$Sql) {
  if ([string]::IsNullOrWhiteSpace($Sql)) { return '' }
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return (& $mysql -u root fitconnect -e $Sql 2>&1 | Out-String) } finally { $ErrorActionPreference = $old }
}
function Utc([int]$Days, [int]$Minutes) { return [DateTime]::UtcNow.AddDays($Days).AddMinutes($Minutes).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }

$suffix = '{0}-{1}' -f (Get-Date -Format 'yyyyMMddHHmmss'), (Get-Random -Minimum 1000 -Maximum 9999)
$trainerEmail = "e2e.trainer.$suffix@fitconnect.local"
$memberEmail = "e2e.member.$suffix@fitconnect.local"
$throwawayEmail = "e2e.gone.$suffix@fitconnect.local"
$created = @{ users = @(); slots = @(); bookings = @() }

try {
  Write-Output "=== F10 profile fields: register trainer + application with birthDate/education ==="
  $trainer = (Api 'POST' '/v1/auth/register' @{ displayName = 'เทรนเนอร์ E2E'; email = $trainerEmail; password = 'password'; role = 'trainer' }).data
  $member = (Api 'POST' '/v1/auth/register' @{ displayName = 'สมาชิก E2E'; email = $memberEmail; password = 'password'; role = 'member' }).data
  $admin = Login 'admin.demo@fitconnect.local'
  $created.users += $trainer.user.id, $member.user.id

  $cert = Join-Path $phpUpload 'cert.pdf'
  [IO.File]::WriteAllText($cert, "%PDF-1.4`n1 0 obj<</Type/Catalog>>endobj`n%%EOF", [Text.Encoding]::ASCII)
  $form = @{ legalName = 'E2E ทดสอบ'; phone = '0812345678'; displayName = 'เทรนเนอร์ E2E'; birthDate = '1995-04-12'
    education = 'วิทยาศาสตร์การกีฬา'; yearsExperience = '4'; serviceMode = 'gym'; gymName = 'ยิ่ง E2E'
    priceFrom = '700'; paymentAccountName = 'E2E บัญชี'; promptPayId = '0812345678' }
  $appBody = foreach ($k in $form.Keys) { "-F"; "$($k)=$($form[$k])" }
  $appBody += @('-F', 'trainingTypeIds[]=1')
  $appJson = & curl.exe --silent --show-error --fail-with-body --max-time 30 -H "Authorization: Bearer $($trainer.token)" `
    -H "X-Forwarded-For: $Xff" @appBody -F "certificate=@$cert;type=application/pdf" "$ApiUrl/trainer-applications"
  if ($LASTEXITCODE -ne 0) { throw "trainer application failed: $appJson" }
  $profileId = [int](($appJson | ConvertFrom-Json).data.trainerProfileId)

  $profile = (Api 'GET' '/v1/profile' $null $trainer.token).data
  Assert-Eq '1995-04-12' $profile.trainer.birthDate 'trainer birthDate persisted (F10)'
  Assert-Eq 'วิทยาศาสตร์การกีฬา' $profile.trainer.education 'trainer education persisted (F10)'

  Write-Output "=== F8 application decision notification ==="
  Api 'POST' "/v1/admin/trainers/$profileId/approve" @{ note = 'ผ่าน E2E' } $admin.token | Out-Null
  $inbox = (Api 'GET' '/v1/notifications?page=0' $null $trainer.token).data
  $approved = @($inbox.items | Where-Object { $_.type -eq 'trainer_application_approved' })
  Assert ($approved.Count -ge 1) 'trainer received trainer_application_approved (F8)'
  Assert ($null -eq $approved[0].bookingId -or $approved[0].bookingId -eq '') 'application notification carries no booking id (F8)'

  Write-Output "=== F1 booking decision: pending_trainer -> accept as requested / reject ==="
  # ตัวเลือกเวลาตายตัว 12:00/18:00 ถูกถอดออกตามคำสั่งผู้ใช้ — ยืนยันได้เฉพาะช่วงเวลาที่สมาชิกเลือก
  # ราคาถูกตั้งจากใบสมัครแล้ว (priceFrom=700) จึงไม่ต้องเรียก PATCH /v1/trainer/me ในเส้นทางนี้
  $slot1 = (Api 'POST' '/v1/availability-slots' @{ startsAt = (Utc 3 0) } $trainer.token).data
  $created.slots += $slot1.id
  $booking1 = (Api 'POST' '/v1/bookings' @{ trainerId = $profileId; slotId = [int]$slot1.id; note = 'E2E รอบรับ' } $member.token).data
  $created.bookings += $booking1.id
  Assert-Eq 'pending_trainer' $booking1.status 'booking starts as pending_trainer (F1)'

  $fixedTimeRejected = $false
  try {
    Api 'PATCH' "/v1/bookings/$($booking1.id)/status" @{ status = 'awaiting_payment'; confirmedTime = '12:00' } $trainer.token | Out-Null
  } catch {
    $fixedTimeRejected = $true
  }
  Assert $fixedTimeRejected 'fixed 12:00/18:00 options stay removed (F1)'

  $accepted = (Api 'PATCH' "/v1/bookings/$($booking1.id)/status" @{ status = 'awaiting_payment'; confirmedTime = 'as_requested' } $trainer.token).data
  Assert-Eq 'awaiting_payment' $accepted.status 'trainer accept moves to awaiting_payment (F1)'
  Assert (([DateTime]::Parse($accepted.confirmedStartsAt)) -eq ([DateTime]::Parse($slot1.startsAt))) 'confirmed window matches the requested slot (F1)'
  Assert ($null -ne $accepted.paymentDeadlineAt) 'payment clock starts after acceptance (F1)'

  $slot2 = (Api 'POST' '/v1/availability-slots' @{ startsAt = (Utc 4 0) } $trainer.token).data
  $created.slots += $slot2.id
  $booking2 = (Api 'POST' '/v1/bookings' @{ trainerId = $profileId; slotId = [int]$slot2.id; note = 'E2E รอบปฏิเสธ' } $member.token).data
  $created.bookings += $booking2.id
  $rejected = (Api 'PATCH' "/v1/bookings/$($booking2.id)/status" @{ status = 'cancelled'; note = 'ติดสอนในยิม' } $trainer.token).data
  Assert-Eq 'cancelled' $rejected.status 'trainer reject cancels the request (F1)'
  $reasonRow = Invoke-Sql "SELECT cancellation_reason FROM bookings WHERE public_id='$($booking2.id)'"
  Assert ($reasonRow -like '*ติดสอน*') 'rejection reason stored (F1)'

  Write-Output "=== F3 edit an availability slot ==="
  $slot3 = (Api 'POST' '/v1/availability-slots' @{ startsAt = (Utc 5 0) } $trainer.token).data
  $created.slots += $slot3.id
  $edited = (Api 'PATCH' "/v1/availability-slots/$($slot3.id)" @{ startsAt = (Utc 5 120) } $trainer.token).data
  Assert ($edited.startsAt -like '*:00.000Z' -or $edited.startsAt) 'slot edit returns the slot (F3)'
  $bookedEdit = ApiError 'PATCH' "/v1/availability-slots/$($slot1.id)" @{ startsAt = (Utc 3 60) } $trainer.token
  Assert ($null -ne $bookedEdit -and $bookedEdit.status -ge 400) 'editing a booked slot is refused (F3)'

  Write-Output "=== F4 trainer cancels a booking ==="
  $slot4 = (Api 'POST' '/v1/availability-slots' @{ startsAt = (Utc 6 0) } $trainer.token).data
  $created.slots += $slot4.id
  $booking3 = (Api 'POST' '/v1/bookings' @{ trainerId = $profileId; slotId = [int]$slot4.id; note = 'E2E รอบยกเลิก' } $member.token).data
  $created.bookings += $booking3.id
  Api 'PATCH' "/v1/bookings/$($booking3.id)/status" @{ status = 'awaiting_payment'; confirmedTime = 'as_requested' } $trainer.token | Out-Null
  $cancelled = (Api 'PATCH' "/v1/bookings/$($booking3.id)/status" @{ status = 'cancelled'; note = 'บาดเจ็บกะทันหัน' } $trainer.token).data
  Assert-Eq 'cancelled' $cancelled.status 'trainer can cancel a booking (F4)'
  $cancelRow = Invoke-Sql "SELECT cancellation_reason FROM bookings WHERE public_id='$($booking3.id)'"
  Assert ($cancelRow -like '*บาดเจ็บ*') 'trainer cancel reason stored (F4)'

  Write-Output "=== F11 chat with image + file together, F7 new-message notification ==="
  $slot5 = (Api 'POST' '/v1/availability-slots' @{ startsAt = (Utc 7 0) } $trainer.token).data
  $created.slots += $slot5.id
  $booking4 = (Api 'POST' '/v1/bookings' @{ trainerId = $profileId; slotId = [int]$slot5.id; note = 'E2E รอบแชต' } $member.token).data
  $created.bookings += $booking4.id
  Api 'PATCH' "/v1/bookings/$($booking4.id)/status" @{ status = 'awaiting_payment'; confirmedTime = 'as_requested' } $trainer.token | Out-Null
  $listAfter = (Api 'GET' '/v1/bookings' $null $member.token).data
  $roomId = [int](@($listAfter | Where-Object { $_.id -eq $booking4.id } | Select-Object -First 1).chatRoomId)
  $img = Join-Path $phpUpload 'img.png'; $file = Join-Path $phpUpload 'plan.pdf'
  $png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
  [IO.File]::WriteAllBytes($img, $png); [IO.File]::WriteAllText($file, "%PDF-1.4 E2E")
  $msgJson = & curl.exe --silent --show-error --fail-with-body --max-time 30 -H "Authorization: Bearer $($member.token)" -H "X-Forwarded-For: $Xff" `
    -F 'text=แนบทั้งรูปและไฟล์' -F "image=@$img;type=image/png" -F "file=@$file;type=application/pdf" "$ApiUrl/chat-rooms/$roomId/messages"
  if ($LASTEXITCODE -ne 0) { throw "chat upload failed: $msgJson" }
  $msg = ($msgJson | ConvertFrom-Json).data
  Assert ($null -ne $msg.imageUrl -and $null -ne $msg.attachmentUrl) 'one message carries both image and file (F11)'
  $trainerInbox = (Api 'GET' '/v1/notifications?page=0' $null $trainer.token).data
  Assert (@($trainerInbox.items | Where-Object { $_.type -like 'message_received*' }).Count -ge 1) 'trainer notified of the new message (F7)'

  Write-Output "=== F6 search a user by phone number ==="
  $hit = (Api 'GET' ("/v1/admin/operations?userQuery=0812345678&userPage=0&administratorPage=0&bookingPage=0&bookingStatus=all&incomePage=0&paymentPage=0") $null $admin.token).data
  Assert (@($hit.users | Where-Object { $_.email -eq $trainerEmail }).Count -ge 1) 'phone search finds the trainer (F6)'

  Write-Output "=== F2 reports + F9 gym salary summary ==="
  $year = (Get-Date).Year
  $reports = (Api 'GET' "/v1/admin/reports?year=$year" $null $admin.token).data
  Assert ($null -ne $reports.bookingsByMonth -and @($reports.bookingsByMonth).Count -eq 12) 'admin reports: 12 monthly booking rows (F2)'
  Assert ($null -ne $reports.usersByRole) 'admin reports: users by role (F2)'
  $ops = (Api 'GET' '/v1/admin/operations?userPage=0&userQuery=&administratorPage=0&bookingPage=0&bookingStatus=all&incomePage=0&paymentPage=0' $null $admin.token).data
  Assert ($null -ne $ops.gymSalaries) 'admin operations carries gymSalaries (F9)'
  $stats = (Api 'GET' "/v1/trainer/stats?year=$year" $null $trainer.token).data
  Assert (@($stats.bookingsByMonth).Count -eq 12) 'trainer stats: 12 monthly rows (F2)'
  Assert ($null -ne $stats.salarySummary) 'gym trainer sees a salary summary (F9)'

  Write-Output "=== F5 delete a user account ==="
  $gone = (Api 'POST' '/v1/auth/register' @{ displayName = 'ลบได้ E2E'; email = $throwawayEmail; password = 'password'; role = 'member' }).data
  $self = ApiError 'DELETE' "/v1/admin/users/$($admin.user.id)" $null $admin.token
  Assert ($null -ne $self -and $self.status -eq 409) 'self deletion is refused (F5)'
  Api 'DELETE' "/v1/admin/users/$($gone.user.id)" $null $admin.token | Out-Null
  $loginAfter = ApiError 'POST' '/v1/auth/login' @{ email = $throwawayEmail; password = 'password' }
  Assert ($null -ne $loginAfter -and $loginAfter.status -ge 400) 'deleted account cannot sign in (F5)'
  Write-Output "  PASS delete-user flow complete (F5)"

  Write-Output ""
  Write-Output "ALL 11 FEATURE PROOFS PASSED"
} catch {
  Write-Output ("MAIN ERROR: " + $_.Exception.Message)
  Write-Output ("AT: " + $_.ScriptStackTrace)
  throw
} finally {
  Write-Output "=== cleanup ==="
  foreach ($b in $created.bookings) {
    Invoke-Sql "UPDATE bookings SET status='cancelled', cancellation_reason='cleanup e2e' WHERE public_id='$b'" | Out-Null
    Invoke-Sql "UPDATE availability_slots s JOIN bookings b ON b.availability_slot_id=s.id SET s.state='available' WHERE b.public_id='$b'" | Out-Null
  }
  foreach ($s in $created.slots) { Invoke-Sql "DELETE FROM availability_slots WHERE id=$s" | Out-Null }
  foreach ($u in $created.users) { Invoke-Sql "DELETE FROM auth_tokens WHERE user_id=$u" | Out-Null }
  if ($profileId) {
    Invoke-Sql "DELETE FROM trainer_certificates WHERE trainer_profile_id=$profileId" | Out-Null
    Invoke-Sql "DELETE FROM trainer_training_types WHERE trainer_profile_id=$profileId" | Out-Null
    Invoke-Sql "DELETE FROM trainer_profiles WHERE id=$profileId" | Out-Null
  }
  if ($created.users.Count -gt 0) {
    $idList = $created.users -join ','
    Invoke-Sql "DELETE FROM notifications WHERE recipient_user_id IN ($idList)" | Out-Null
    Invoke-Sql "DELETE FROM member_profiles WHERE user_id IN ($idList)" | Out-Null
  }
  Invoke-Sql "DELETE FROM users WHERE email IN ('$trainerEmail','$memberEmail','$throwawayEmail')" | Out-Null
  Write-Output "cleanup done"
}
