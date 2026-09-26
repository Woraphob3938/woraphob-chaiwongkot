<?php
declare(strict_types=1);

function loadEnvironment(string $path): void
{
    if (!is_file($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = trim($value, "\"'");
        if ($key !== '' && getenv($key) === false) {
            putenv($key . '=' . $value);
        }
    }
}

loadEnvironment(dirname(__DIR__) . '/.env');

function env(string $key, ?string $fallback = null): ?string
{
    $value = getenv($key);
    return $value === false ? $fallback : $value;
}

return [
    'environment' => env('APP_ENV', 'local'),
    'origin' => env('APP_ORIGIN', 'http://localhost:3000'),
    'app_url' => rtrim((string) env('APP_URL', 'http://localhost:3000'), '/'),
    'database' => [
        'host' => env('DB_HOST', '127.0.0.1'),
        'port' => env('DB_PORT', '3306'),
        'name' => env('DB_NAME', 'fitconnect'),
        'user' => env('DB_USER', 'root'),
        'pass' => env('DB_PASS', ''),
    ],
    'mail' => [
        'enabled' => filter_var(env('MAIL_ENABLED', 'false'), FILTER_VALIDATE_BOOL),
        'host' => env('MAIL_HOST', 'smtp.gmail.com'),
        'port' => (int) env('MAIL_PORT', '587'),
        'username' => env('MAIL_USERNAME', ''),
        'app_password' => env('MAIL_APP_PASSWORD', ''),
        'from_email' => env('MAIL_FROM_EMAIL', ''),
        'from_name' => env('MAIL_FROM_NAME', 'FitConnect'),
    ],
    'upload_max_bytes' => (int) env('UPLOAD_MAX_BYTES', '5242880'),
];
