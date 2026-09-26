[CmdletBinding()]
param(
    [string]$XamppRoot = 'C:\xampp',
    [string]$DatabaseUser = 'root',
    [string]$DatabasePassword = '',
    [switch]$SkipDatabaseImport
)

$ErrorActionPreference = 'Stop'

function Resolve-RequiredPath {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "ไม่พบ $Label ที่ $Path — กรุณาติดตั้งหรือซ่อม XAMPP แบบ Full ก่อน"
    }
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
}

$xamppFull = Resolve-RequiredPath -Path $XamppRoot -Label 'โฟลเดอร์ XAMPP'
$requiredFiles = @(
    @{ Path = Join-Path $xamppFull 'xampp-control.exe'; Label = 'XAMPP Control Panel' },
    @{ Path = Join-Path $xamppFull 'apache\bin\httpd.exe'; Label = 'Apache' },
    @{ Path = Join-Path $xamppFull 'php\php.exe'; Label = 'PHP' },
    @{ Path = Join-Path $xamppFull 'mysql\bin\mysqld.exe'; Label = 'MySQL Server' },
    @{ Path = Join-Path $xamppFull 'mysql\bin\mysql.exe'; Label = 'MySQL Client' }
)

foreach ($required in $requiredFiles) {
    Resolve-RequiredPath -Path $required.Path -Label $required.Label | Out-Null
}

$htdocsFull = Resolve-RequiredPath -Path (Join-Path $xamppFull 'htdocs') -Label 'htdocs'
$workspaceFull = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendFull = Resolve-RequiredPath -Path (Join-Path $workspaceFull 'backend') -Label 'FitConnect PHP API'
$targetFull = [System.IO.Path]::GetFullPath((Join-Path $htdocsFull 'fitconnect-api'))
$htdocsPrefix = $htdocsFull.TrimEnd('\') + '\'

if (-not $targetFull.StartsWith($htdocsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ยกเลิกเพื่อความปลอดภัย: ตำแหน่งปลายทางอยู่นอก htdocs ($targetFull)"
}

if (Test-Path -LiteralPath $targetFull) {
    $existing = Get-Item -LiteralPath $targetFull -Force
    $targets = @($existing.Target) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
    if (-not ($targets -contains $backendFull)) {
        throw "มี fitconnect-api อยู่แล้วและไม่ได้ชี้มาที่โปรเจกต์นี้ จึงไม่เขียนทับ: $targetFull"
    }
    Write-Host "จุดเชื่อม API ถูกต้องอยู่แล้ว: $targetFull"
} else {
    New-Item -ItemType Junction -Path $targetFull -Target $backendFull | Out-Null
    Write-Host "เชื่อม PHP API เข้ากับ XAMPP แล้ว: $targetFull"
}

if (-not $SkipDatabaseImport) {
    $mysqlPort = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue
    if (-not $mysqlPort) {
        throw 'เชื่อมโฟลเดอร์ API แล้ว แต่ MySQL ยังไม่ทำงาน กรุณาเปิด Apache และ MySQL ใน XAMPP Control Panel แล้วรันคำสั่งนี้อีกครั้ง'
    }

    $mysqlExe = Join-Path $xamppFull 'mysql\bin\mysql.exe'
    $schemaPath = Resolve-RequiredPath -Path (Join-Path $backendFull 'database\schema.sql') -Label 'schema.sql'
    $seedPath = Resolve-RequiredPath -Path (Join-Path $backendFull 'database\seed.sql') -Label 'seed.sql'
    $oldPassword = $env:MYSQL_PWD
    try {
        if ($DatabasePassword) { $env:MYSQL_PWD = $DatabasePassword }
        # Let the MySQL client read UTF-8 files itself. Piping Thai SQL through
        # Windows PowerShell 5.1 can replace non-ASCII characters with "?".
        $schemaSource = $schemaPath.Replace('\', '/')
        & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --default-character-set=utf8mb4 --execute="SOURCE $schemaSource"
        if ($LASTEXITCODE -ne 0) { throw 'นำเข้าโครงสร้างฐานข้อมูลไม่สำเร็จ' }
        $migrationRoot = Join-Path $backendFull 'database\migrations'
        if (Test-Path -LiteralPath $migrationRoot) {
            foreach ($migration in Get-ChildItem -LiteralPath $migrationRoot -Filter '*.sql' -File | Sort-Object Name) {
                $migrationSource = $migration.FullName.Replace('\', '/')
                & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --default-character-set=utf8mb4 --execute="SOURCE $migrationSource"
                if ($LASTEXITCODE -ne 0) { throw "นำเข้า migration ไม่สำเร็จ: $($migration.Name)" }
            }
        }
        # The manual migrations carry the schema changes that schema.sql was
        # never updated with (pending_trainer, the notifications booking_id
        # relaxations, the message image columns, ...). They are written to be
        # idempotent, so replaying them is a no-op on an up-to-date database.
        # Filename order is the intended order: the 20260922 file re-adds
        # pending_trainer after the 20260810 file retires it.
        $manualMigrationRoot = Join-Path $backendFull 'database\manual-migrations'
        if (Test-Path -LiteralPath $manualMigrationRoot) {
            foreach ($migration in Get-ChildItem -LiteralPath $manualMigrationRoot -Filter '*.sql' -File | Sort-Object Name) {
                $migrationSource = $migration.FullName.Replace('\', '/')
                & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --default-character-set=utf8mb4 --execute="SOURCE $migrationSource"
                if ($LASTEXITCODE -ne 0) { throw "นำเข้า manual migration ไม่สำเร็จ: $($migration.Name)" }
            }
        }
        $seedSource = $seedPath.Replace('\', '/')
        & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --default-character-set=utf8mb4 --execute="SOURCE $seedSource"
        if ($LASTEXITCODE -ne 0) { throw 'นำเข้าข้อมูลสาธิตไม่สำเร็จ' }
    } finally {
        if ($null -eq $oldPassword) { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue } else { $env:MYSQL_PWD = $oldPassword }
    }
    Write-Host 'สร้างฐานข้อมูล fitconnect และข้อมูลสาธิตแล้ว'
}

Write-Host 'พร้อมตรวจสอบ API ที่ http://localhost/fitconnect-api/v1/health'
Write-Host 'เปิดหน้าเว็บด้วย npm run dev แล้วไปที่ http://localhost:3000'
