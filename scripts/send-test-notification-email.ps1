[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$RecipientEmail,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ConfirmSend,

    [string]$XamppRoot = 'C:\xampp'
)

$ErrorActionPreference = 'Stop'

if ($ConfirmSend -cne 'SEND') {
    throw 'ยังไม่ได้ส่งอีเมล: ต้องระบุ -ConfirmSend SEND ให้ตรงทุกตัวอักษร'
}
if ($RecipientEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw 'อีเมลผู้รับไม่ถูกต้อง'
}

$phpExe = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'php\php.exe')).Path
$configPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\backend\src\config.php')).Path
$mailerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\backend\src\GmailMailer.php')).Path
$phpCode = @'
$config = require $argv[1];
require_once $argv[2];
$mail = $config['mail'] + ['app_url' => $config['app_url']];
$mailer = new GmailMailer($mail);
if (!$mailer->isEnabled()) {
    throw new RuntimeException('MAIL_ENABLED=false');
}
$mailer->send(
    $argv[3],
    'ผู้รับทดสอบ',
    'ทดสอบการแจ้งเตือน Gmail',
    'หากได้รับอีเมลนี้ แสดงว่า FitConnect เชื่อมต่อ Gmail SMTP สำเร็จ',
    '/notifications'
);
echo json_encode(['accepted' => true, 'timestamp' => gmdate('c')], JSON_THROW_ON_ERROR);
'@

try {
    $rawResult = & $phpExe -r $phpCode $configPath $mailerPath $RecipientEmail 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Gmail SMTP ไม่รับอีเมลทดสอบ กรุณาตรวจ backend/.env' }
    $result = ([string]$rawResult[-1]) | ConvertFrom-Json
    $status = if ([bool]$result.accepted) { 'accepted' } else { 'failed' }
    Write-Output "Recipient=$RecipientEmail"
    Write-Output "Status=$status"
    Write-Output "Timestamp=$($result.timestamp)"
} catch {
    Write-Output "Recipient=$RecipientEmail"
    Write-Output 'Status=failed'
    Write-Output "Timestamp=$([DateTime]::UtcNow.ToString('o'))"
    throw
}
