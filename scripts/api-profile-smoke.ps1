param(
    [ValidateSet('profile', 'image', 'password', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiBase = 'http://localhost/fitconnect-api',
    [string]$DatabaseUser = 'root'
)

$ErrorActionPreference = 'Stop'
$mysqlExe = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path
$memberId = 0
$trainerId = 0
$uploadedPaths = @()
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "fitconnect-profile-smoke-$PID"

function Invoke-Api([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$ApiBase$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    return Invoke-RestMethod @params
}

function Invoke-ApiError([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = '') {
    try {
        Invoke-Api $Method $Path $Body $Token | Out-Null
    }
    catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }
        $payload = $_.ErrorDetails.Message | ConvertFrom-Json
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Code = [string]$payload.error.code
            Fields = $payload.error.fields
        }
    }
    throw "Expected API error for $Method $Path"
}

function Invoke-Sql([string]$Sql) {
    $output = & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --batch --skip-column-names --execute=$Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "MariaDB query failed: $output" }
    return @($output)
}

function Assert-Equal([object]$Expected, [object]$Actual, [string]$Message) {
    if ([string]$Expected -ne [string]$Actual) {
        throw "$Message. Expected '$Expected', got '$Actual'"
    }
}

function Register-User([string]$Role, [string]$Email, [string]$DisplayName) {
    return Invoke-Api 'POST' '/v1/auth/register' @{
        displayName = $DisplayName
        email = $Email
        password = 'profile-pass-123'
        role = $Role
    }
}

function Invoke-Multipart([string]$Token, [string]$FilePath, [string]$Mime) {
    $arguments = @('--silent', '--show-error', '--request', 'POST', '--write-out', "`n%{http_code}")
    if ($Token) { $arguments += @('-H', "Authorization: Bearer $Token") }
    $arguments += @('-F', "image=@$FilePath;type=$Mime", "$ApiBase/v1/profile/image")
    $lines = @(& curl.exe @arguments)
    if ($LASTEXITCODE -ne 0) { throw "curl upload failed: $($lines -join "`n")" }
    $status = [int]$lines[-1]
    $body = if ($lines.Count -gt 1) { ($lines[0..($lines.Count - 2)] -join "`n") } else { '' }
    return [pscustomobject]@{ Status = $status; Body = $body }
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$memberEmail = "profile-member-$stamp@example.com"
$trainerEmail = "profile-trainer-$stamp@example.com"

try {
    $health = Invoke-Api 'GET' '/v1/health'
    Assert-Equal 'connected' $health.data.database 'PHP API database health'

    $memberAuth = Register-User 'member' $memberEmail 'สมาชิกก่อนแก้'
    $trainerAuth = Register-User 'trainer' $trainerEmail 'เทรนเนอร์ก่อนแก้'
    $memberId = [int]$memberAuth.data.user.id
    $trainerId = [int]$trainerAuth.data.user.id
    $memberToken = [string]$memberAuth.data.token
    $trainerToken = [string]$trainerAuth.data.token

    Invoke-Sql "UPDATE member_profiles SET medical_note='KEEP-MEDICAL-NOTE' WHERE user_id=$memberId;"
    $trainingTypeRows = @(Invoke-Sql 'SELECT id FROM training_types WHERE active=1 ORDER BY sort_order, id LIMIT 1;')
    if ($trainingTypeRows.Count -ne 1) { throw 'Profile smoke requires one active training type.' }
    $trainingTypeId = [int]$trainingTypeRows[0]
    Invoke-Sql @"
INSERT INTO trainer_profiles
  (user_id, slug, legal_name, phone, headline, bio, years_experience, service_mode, gym_name, price_from, approval_status)
VALUES
  ($trainerId, 'profile-smoke-$trainerId', 'ชื่อจริงเดิม', '0800000000', 'หัวข้อเดิม', 'ประวัติเดิม', 2, 'freelance', NULL, 500, 'approved');
SET @profile_id = LAST_INSERT_ID();
INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (@profile_id, $trainingTypeId);
"@

    if ($Scenario -in @('profile', 'all')) {
        $memberBefore = Invoke-Api 'GET' '/v1/profile' $null $memberToken
        Assert-Equal 'member' $memberBefore.data.role 'member profile role'
        Assert-Equal 'สมาชิกก่อนแก้' $memberBefore.data.member.firstName 'legacy member name fallback'
        Assert-Equal $true $memberBefore.data.member.nameFromDisplayName 'legacy name is flagged as the display-name fallback'

        $memberAfter = Invoke-Api 'PATCH' '/v1/profile' @{
            firstName = 'สมชาย'
            lastName = 'ใจดี'
            phone = '0812345678'
            fitnessGoal = 'เพิ่มความแข็งแรง'
            experienceLevel = 'beginner'
            weight = 70.5
            height = 175
        } $memberToken
        Assert-Equal 'สมชาย ใจดี' $memberAfter.data.user.displayName 'updated member display name'
        Assert-Equal $false $memberAfter.data.member.nameFromDisplayName 'a stored name is no longer a fallback'
        Assert-Equal 'สมชาย' $memberAfter.data.member.firstName 'stored first name is returned as stored'

        $trainerBefore = Invoke-Api 'GET' '/v1/profile' $null $trainerToken
        Assert-Equal 'trainer' $trainerBefore.data.role 'trainer profile role'
        Assert-Equal 'approved' $trainerBefore.data.trainer.approvalStatus 'trainer approval before update'

        $trainerAfter = Invoke-Api 'PATCH' '/v1/profile' @{
            displayName = 'ครูเมย์'
            legalName = 'เมย์ ใจดี'
            phone = '0899999999'
            headline = 'สร้างความแข็งแรงอย่างเป็นระบบ'
            bio = 'วางแผนตามเป้าหมาย'
            yearsExperience = 6
            serviceMode = 'both'
            gymName = 'Fit Gym'
            priceFrom = 650
            paymentAccountName = 'บัญชีทดสอบ ครูเมย์'
            promptPayId = '0899999999'
            trainingTypeIds = @($trainingTypeId)
        } $trainerToken
        Assert-Equal 'ครูเมย์' $trainerAfter.data.user.displayName 'updated trainer display name'
        Assert-Equal 'approved' $trainerAfter.data.trainer.approvalStatus 'trainer approval after update'

        $memberAuditRows = @(Invoke-Sql "SELECT CONCAT_WS('|', first_name, last_name, phone, experience_level, weight, height, medical_note) FROM member_profiles WHERE user_id=$memberId;")
        $memberAudit = $memberAuditRows[0]
        Assert-Equal 'สมชาย|ใจดี|0812345678|beginner|70.50|175.00|KEEP-MEDICAL-NOTE' $memberAudit 'member database audit'
        $trainerAuditRows = @(Invoke-Sql "SELECT CONCAT_WS('|', legal_name, phone, headline, years_experience, service_mode, gym_name, price_from, approval_status) FROM trainer_profiles WHERE user_id=$trainerId;")
        $trainerAudit = $trainerAuditRows[0]
        Assert-Equal 'เมย์ ใจดี|0899999999|สร้างความแข็งแรงอย่างเป็นระบบ|6|both|Fit Gym|650.00|approved' $trainerAudit 'trainer database audit'

        Write-Output 'PASS profile GET/PATCH and database audit'
    }

    if ($Scenario -in @('image', 'all')) {
        New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
        $pngFixture = Join-Path $fixtureRoot 'avatar.png'
        $pdfFixture = Join-Path $fixtureRoot 'not-an-image.pdf'
        $largeFixture = Join-Path $fixtureRoot 'oversize.png'
        [IO.File]::WriteAllBytes($pngFixture, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        [IO.File]::WriteAllText($pdfFixture, '%PDF-1.4 profile smoke')
        $largeStream = [IO.File]::Open($largeFixture, [IO.FileMode]::Create, [IO.FileAccess]::Write)
        try { $largeStream.SetLength((5 * 1024 * 1024) + 1) } finally { $largeStream.Dispose() }

        $memberUpload = Invoke-Multipart $memberToken $pngFixture 'image/png'
        Assert-Equal 200 $memberUpload.Status 'valid member PNG upload status'
        $memberUploadPayload = $memberUpload.Body | ConvertFrom-Json
        Assert-Equal "/v1/profile-images/member/$memberId" $memberUploadPayload.data.imageUrl 'member image URL'
        $memberImageRows = @(Invoke-Sql "SELECT image_path FROM member_profiles WHERE user_id=$memberId;")
        $memberImagePath = [string]$memberImageRows[0]
        $uploadedPaths += $memberImagePath

        $publicImage = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBase$($memberUploadPayload.data.imageUrl)"
        Assert-Equal 200 $publicImage.StatusCode 'public member image status'
        Assert-Equal 'image/png' $publicImage.Headers['Content-Type'] 'public member image MIME'

        $invalidUpload = Invoke-Multipart $memberToken $pdfFixture 'application/pdf'
        Assert-Equal 422 $invalidUpload.Status 'PDF upload rejection status'
        Assert-Equal 'VALIDATION_FAILED' (($invalidUpload.Body | ConvertFrom-Json).error.code) 'PDF upload error code'
        Assert-Equal $memberImagePath (@(Invoke-Sql "SELECT image_path FROM member_profiles WHERE user_id=$memberId;"))[0] 'failed upload keeps member image'

        $oversizeUpload = Invoke-Multipart $memberToken $largeFixture 'image/png'
        Assert-Equal 422 $oversizeUpload.Status 'oversize upload rejection status'

        $unauthenticatedUpload = Invoke-Multipart '' $pngFixture 'image/png'
        Assert-Equal 401 $unauthenticatedUpload.Status 'unauthenticated upload status'

        $memberDelete = Invoke-Api 'DELETE' '/v1/profile/image' $null $memberToken
        if ($null -ne $memberDelete.data.imageUrl) { throw 'deleted member image URL must be null' }
        $memberImageAfterDelete = @(Invoke-Sql "SELECT IFNULL(image_path, 'NULL') FROM member_profiles WHERE user_id=$memberId;")
        Assert-Equal 'NULL' $memberImageAfterDelete[0] 'member image path cleared after delete'
        $deletedMemberImage = Invoke-ApiError 'GET' "/v1/profile-images/member/$memberId"
        Assert-Equal 404 $deletedMemberImage.Status 'deleted member image public status'
        $memberProfileAfterDelete = Invoke-Api 'GET' '/v1/profile' $null $memberToken
        if ($null -ne $memberProfileAfterDelete.data.imageUrl) { throw 'member profile image URL must be null after delete' }

        $trainerUpload = Invoke-Multipart $trainerToken $pngFixture 'image/png'
        Assert-Equal 200 $trainerUpload.Status 'valid trainer PNG upload status'
        Assert-Equal "/v1/profile-images/trainer/$trainerId" (($trainerUpload.Body | ConvertFrom-Json).data.imageUrl) 'trainer image URL'
        $trainerImageRows = @(Invoke-Sql "SELECT image_path FROM trainer_profiles WHERE user_id=$trainerId;")
        $uploadedPaths += [string]$trainerImageRows[0]
        $trainerPublic = Invoke-Api 'GET' "/v1/trainers/profile-smoke-$trainerId"
        Assert-Equal "/v1/profile-images/trainer/$trainerId" $trainerPublic.data.image 'public trainer image URL'

        Write-Output 'PASS profile image upload, deletion, validation and delivery'
    }

    if ($Scenario -in @('password', 'all')) {
        $secondLogin = Invoke-Api 'POST' '/v1/auth/login' @{
            email = $memberEmail
            password = 'profile-pass-123'
        }
        $secondToken = [string]$secondLogin.data.token

        $wrongCurrent = Invoke-ApiError 'PATCH' '/v1/profile/password' @{
            currentPassword = 'wrong-password'
            newPassword = 'new-profile-pass-456'
        } $memberToken
        Assert-Equal 401 $wrongCurrent.Status 'wrong current password status'
        Assert-Equal 'INVALID_CREDENTIALS' $wrongCurrent.Code 'wrong current password code'

        $shortPassword = Invoke-ApiError 'PATCH' '/v1/profile/password' @{
            currentPassword = 'profile-pass-123'
            newPassword = 'short'
        } $memberToken
        Assert-Equal 422 $shortPassword.Status 'short password status'
        Assert-Equal 'VALIDATION_FAILED' $shortPassword.Code 'short password code'

        $changed = Invoke-Api 'PATCH' '/v1/profile/password' @{
            currentPassword = 'profile-pass-123'
            newPassword = 'new-profile-pass-456'
            confirmPassword = 'ignored-by-server'
            userId = 999999
        } $memberToken
        Assert-Equal $true $changed.data.changed 'password changed response'

        $currentSession = Invoke-Api 'GET' '/v1/me' $null $memberToken
        Assert-Equal $memberId $currentSession.data.id 'current token remains active'
        $revokedSession = Invoke-ApiError 'GET' '/v1/me' $null $secondToken
        Assert-Equal 401 $revokedSession.Status 'secondary token revoked status'
        Assert-Equal 'INVALID_TOKEN' $revokedSession.Code 'secondary token revoked code'

        $oldLogin = Invoke-ApiError 'POST' '/v1/auth/login' @{
            email = $memberEmail
            password = 'profile-pass-123'
        }
        Assert-Equal 401 $oldLogin.Status 'old password login status'
        $newLogin = Invoke-Api 'POST' '/v1/auth/login' @{
            email = $memberEmail
            password = 'new-profile-pass-456'
        }
        Assert-Equal $memberId $newLogin.data.user.id 'new password login user'

        Write-Output 'PASS profile password change and session revocation'
    }
}
finally {
    if ($memberId -gt 0 -or $trainerId -gt 0) {
        $ids = @($memberId, $trainerId) | Where-Object { $_ -gt 0 }
        Invoke-Sql ("DELETE FROM users WHERE id IN (" + ($ids -join ',') + ');') | Out-Null
    }
    $uploadRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot -Parent) 'backend\uploads\profile-images'))
    foreach ($relativePath in $uploadedPaths) {
        if (-not $relativePath) { continue }
        $target = [IO.Path]::GetFullPath((Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'backend') $relativePath))
        if ($target.StartsWith($uploadRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $target -PathType Leaf)) {
            Remove-Item -LiteralPath $target
        }
    }
    if ((Test-Path -LiteralPath $fixtureRoot) -and $fixtureRoot.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
