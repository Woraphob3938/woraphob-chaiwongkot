[CmdletBinding()]
param(
    [string]$ApiUrl = 'http://localhost/fitconnect-api'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Auth-Headers {
    param([string]$Token)
    return @{ Authorization = "Bearer $Token" }
}

function Login {
    param([string]$Email, [string]$Password)
    $body = @{ email = $Email; password = $Password } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/login" -ContentType 'application/json' -Body $body).data
}

function Submit-Application {
    param([string]$Token, [string]$CertificatePath, [int]$TrainingTypeId)
    $json = & curl.exe --silent --show-error --fail-with-body `
        -X POST "$ApiUrl/v1/trainer-applications" `
        -H "Authorization: Bearer $Token" `
        -F 'legalName=เทรนเนอร์ทดสอบระบบ' `
        -F 'phone=0812345678' `
        -F 'serviceMode=freelance' `
        -F "trainingTypeId=$TrainingTypeId" `
        -F 'experience=ใช้ตรวจขั้นตอนสมัครและอนุมัติเทรนเนอร์' `
        -F "certificate=@$CertificatePath;type=application/pdf"
    if ($LASTEXITCODE -ne 0) { throw 'Trainer application request failed.' }
    return ($json | ConvertFrom-Json).data
}

$suffix = "{0}-{1}" -f (Get-Date -Format 'yyyyMMddHHmmss'), (Get-Random -Minimum 1000 -Maximum 9999)
$email = "trainer.smoke.$suffix@fitconnect.local"
$password = 'fitconnect-smoke-password'
$certificatePath = Join-Path ([IO.Path]::GetTempPath()) "fitconnect-certificate-$suffix.pdf"

try {
    [IO.File]::WriteAllText($certificatePath, "%PDF-1.4`n1 0 obj<</Type/Catalog>>endobj`n%%EOF", [Text.Encoding]::ASCII)

    $registrationBody = @{
        displayName = 'เทรนเนอร์ทดสอบระบบ'
        email = $email
        password = $password
        role = 'trainer'
    } | ConvertTo-Json
    $trainer = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/register" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($registrationBody))
    ).data
    $trainerHeaders = Auth-Headers $trainer.token

    $initial = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True ($null -eq $initial.profile) 'A new trainer account must start without a professional profile.'

    $trainingTypes = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/training-types").data
    Assert-True ($trainingTypes.Count -gt 0) 'At least one active training type is required.'
    $trainingTypeId = [int]$trainingTypes[0].id

    $application = Submit-Application $trainer.token $certificatePath $trainingTypeId
    Assert-True ($application.status -eq 'pending') 'The first application must become pending.'
    $trainerProfileId = [int]$application.trainerProfileId

    $pending = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True ($pending.profile.approvalStatus -eq 'pending') 'Trainer workspace must report pending after submission.'

    $admin = Login 'admin.demo@fitconnect.local' 'password'
    $adminHeaders = Auth-Headers $admin.token
    $rejectionNote = 'กรุณาตรวจเอกสารแล้วส่งใหม่สำหรับ smoke test'
    $rejectionBody = [Text.Encoding]::UTF8.GetBytes((@{ note = $rejectionNote } | ConvertTo-Json))
    $rejected = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/$trainerProfileId/reject" -Headers $adminHeaders -ContentType 'application/json' -Body $rejectionBody
    ).data
    Assert-True ($rejected.status -eq 'rejected') 'Admin must be able to reject a pending trainer.'

    $rejectedWorkspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True ($rejectedWorkspace.profile.approvalStatus -eq 'rejected') 'Trainer workspace must report rejected.'
    Assert-True ($rejectedWorkspace.profile.approvalNote -eq $rejectionNote) 'Trainer must receive the rejection reason.'

    $resubmission = Submit-Application $trainer.token $certificatePath $trainingTypeId
    Assert-True ($resubmission.status -eq 'pending') 'A corrected application must return to pending.'

    $approvalBody = [Text.Encoding]::UTF8.GetBytes((@{ note = 'ผ่านการตรวจ smoke test' } | ConvertTo-Json))
    $approved = (
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/$trainerProfileId/approve" -Headers $adminHeaders -ContentType 'application/json' -Body $approvalBody
    ).data
    Assert-True ($approved.status -eq 'approved') 'Admin must be able to approve the resubmitted trainer.'

    $approvedWorkspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True ($approvedWorkspace.profile.approvalStatus -eq 'approved') 'Trainer workspace must report approved.'

    Write-Output "PASS trainer onboarding smoke: $email / profile $trainerProfileId"
}
finally {
    Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
}
