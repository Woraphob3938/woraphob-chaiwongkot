[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BookingId,
    [string]$DatabaseUser = 'root'
)

$ErrorActionPreference = 'Stop'

if ($BookingId -cnotmatch '^BK-[A-Z0-9-]{3,32}$') {
    throw 'BookingId ต้องอยู่ในรูปแบบ BK- ตามด้วย A-Z, 0-9 หรือขีดกลาง 3-32 ตัว'
}

$mysqlExe = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path
$sqlPath = (Resolve-Path (Join-Path $PSScriptRoot '..\backend\database\audit_booking.sql')).Path.Replace('\', '/')

$countSql = @"
SELECT
  (SELECT COUNT(*) FROM bookings WHERE public_id = '$BookingId'),
  (SELECT COUNT(*) FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM chat_rooms cr JOIN bookings b ON b.id = cr.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM messages m JOIN chat_rooms cr ON cr.id = m.chat_room_id JOIN bookings b ON b.id = cr.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT status FROM bookings WHERE public_id = '$BookingId'),
  (SELECT s.state FROM availability_slots s JOIN bookings b ON b.availability_slot_id = s.id WHERE b.public_id = '$BookingId');
"@
$countOutput = & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --batch --skip-column-names --execute=$countSql
if ($LASTEXITCODE -ne 0) { throw 'ตรวจจำนวนข้อมูล booking ไม่สำเร็จ' }
$counts = ([string]$countOutput) -split "`t"
if ($counts.Count -ne 8 -or [int]$counts[0] -ne 1 -or [int]$counts[1] -lt 2 -or [int]$counts[3] -ne 1) {
    throw "ข้อมูล flow ไม่ครบ: booking=$($counts[0]) history=$($counts[1]) payments=$($counts[2]) rooms=$($counts[3]) messages=$($counts[4]) reviews=$($counts[5]) status=$($counts[6]) slot=$($counts[7])"
}

$status = [string]$counts[6]
$slotState = [string]$counts[7]
if ($status -eq 'completed') {
    if ([int]$counts[1] -lt 6 -or [int]$counts[2] -lt 2 -or [int]$counts[4] -lt 2 -or [int]$counts[5] -ne 1 -or $slotState -ne 'booked') {
        throw "ข้อมูล approved flow ไม่ครบ: history=$($counts[1]) payments=$($counts[2]) messages=$($counts[4]) reviews=$($counts[5]) slot=$slotState"
    }
} elseif ($status -eq 'expired') {
    if ([int]$counts[2] -ne 0 -or [int]$counts[5] -ne 0 -or $slotState -ne 'held') {
        throw "ข้อมูล expired/rebook flow ไม่ครบ: payments=$($counts[2]) reviews=$($counts[5]) slot=$slotState"
    }
}

Write-Host "Counts: booking=$($counts[0]) history=$($counts[1]) payments=$($counts[2]) rooms=$($counts[3]) messages=$($counts[4]) reviews=$($counts[5]) status=$status slot=$slotState"
$detailSql = "SET @booking_public_id='$BookingId';`nSOURCE $sqlPath"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --table --execute=$detailSql
if ($LASTEXITCODE -ne 0) { throw 'ตรวจข้อมูล booking ไม่สำเร็จ' }
Write-Host "PASS ข้อมูลทุกขั้นตอนของ $BookingId เชื่อมกันครบ"
