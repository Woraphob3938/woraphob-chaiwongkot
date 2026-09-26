# Syntax gate for every PHP file in the backend.
#
# `npm run check` covered only ESLint + tsc + next build, so nothing parsed the
# PHP at all. This runs `php -l` across backend/ and fails the check on the
# first file that does not compile.
$php = 'C:\xampp\php\php.exe'
if (-not (Test-Path $php)) {
    Write-Error "lint-php-syntax: php.exe not found at $php"
    exit 1
}

$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'
if (-not (Test-Path $backend)) {
    Write-Error "lint-php-syntax: backend directory not found at $backend"
    exit 1
}

$files = Get-ChildItem -Path $backend -Recurse -File -Filter '*.php'
$failed = @()

foreach ($file in $files) {
    $output = & $php -l $file.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        $failed += ("{0}`n{1}" -f $file.FullName, ($output -join "`n"))
    }
}

if ($failed.Count -gt 0) {
    Write-Output "lint-php-syntax: $($failed.Count) file(s) failed"
    foreach ($entry in $failed) { Write-Output $entry }
    exit 1
}

Write-Output "lint-php-syntax: ok ($($files.Count) files)"
