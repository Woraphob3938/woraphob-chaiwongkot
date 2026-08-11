param(
    [ValidateSet('profile', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiBase = 'http://localhost/fitconnect-api',
    [string]$DatabaseUser = 'root'
)

$ErrorActionPreference = 'Stop'
$mysqlExe = (Resolve-Path 'C:\xampp\mysql\bin\mysql.exe').Path
$memberId = 0
$trainerId = 0

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

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

try {
    $health = Invoke-Api 'GET' '/v1/health'
    Assert-Equal 'connected' $health.data.database 'PHP API database health'

    $memberAuth = Register-User 'member' "profile-member-$stamp@example.com" 'สมาชิกก่อนแก้'
    $trainerAuth = Register-User 'trainer' "profile-trainer-$stamp@example.com" 'เทรนเนอร์ก่อนแก้'
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
}
finally {
    if ($memberId -gt 0 -or $trainerId -gt 0) {
        $ids = @($memberId, $trainerId) | Where-Object { $_ -gt 0 }
        Invoke-Sql ("DELETE FROM users WHERE id IN (" + ($ids -join ',') + ');') | Out-Null
    }
}
