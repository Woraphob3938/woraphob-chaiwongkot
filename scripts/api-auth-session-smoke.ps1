[CmdletBinding()]
param(
    [string]$ApiUrl = 'http://localhost/fitconnect-api',
    [string]$DatabaseUser = 'root'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$loginBody = @{ email = 'member.demo@fitconnect.local'; password = 'password' } | ConvertTo-Json
$session = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/login" -ContentType 'application/json' -Body $loginBody).data
$headers = @{ Authorization = "Bearer $($session.token)" }

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $tokenHash = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($session.token)))).Replace('-', '').ToLowerInvariant()
} finally {
    $sha256.Dispose()
}

$mysql = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path
$sessionRow = & $mysql --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --batch --skip-column-names --execute="SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), expires_at), IF(revoked_at IS NULL, 1, 0) FROM auth_tokens WHERE token_hash = '$tokenHash';"
Assert-True ($LASTEXITCODE -eq 0) 'อ่านอายุ session จากฐานข้อมูลไม่สำเร็จ'
$sessionFacts = ([string]$sessionRow) -split "`t"
Assert-True ($sessionFacts.Count -eq 2) 'ไม่พบ session ที่เพิ่งเข้าสู่ระบบ'
Assert-True ([int]$sessionFacts[0] -ge (29 * 24 * 60 * 60)) 'session ต้องมีอายุอย่างน้อย 29 วัน'
Assert-True ([int]$sessionFacts[0] -le (30 * 24 * 60 * 60)) 'session ต้องมีอายุไม่เกิน 30 วัน'
Assert-True ([int]$sessionFacts[1] -eq 1) 'session ใหม่ต้องยังไม่ถูกเพิกถอน'

Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/logout" -Headers $headers | Out-Null

$revoked = & $mysql --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --batch --skip-column-names --execute="SELECT IF(revoked_at IS NULL, 0, 1) FROM auth_tokens WHERE token_hash = '$tokenHash';"
Assert-True ($LASTEXITCODE -eq 0 -and [int]$revoked -eq 1) 'logout ต้องบันทึกการเพิกถอน token'

try {
    Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/me" -Headers $headers | Out-Null
    throw 'token เดิมยังเรียกข้อมูลบัญชีได้หลัง logout'
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}

Write-Host 'PASS server session expiry and logout revocation'

