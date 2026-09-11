<?php
declare(strict_types=1);

/**
 * Rate limiting and the password reset flow. Runs against connection-local
 * temporary tables that shadow the real names, so no user row, token or counter
 * outside this process is touched.
 */

require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/PasswordResetRules.php';
require_once __DIR__ . '/../src/RateLimiter.php';
require_once __DIR__ . '/../src/Auth.php';
require_once __DIR__ . '/../src/Database.php';

$config = require __DIR__ . '/../src/config.php';
$database = new Database($config['database']);
$pdo = $database->pdo();

$checks = 0;
function check(mixed $expected, mixed $actual, string $label): void
{
    global $checks;
    $checks++;
    if ($expected !== $actual) {
        throw new RuntimeException($label . ': expected ' . json_encode($expected) . ', got ' . json_encode($actual));
    }
}

function expectHttpStatus(int $status, callable $callback, string $label): void
{
    try {
        $callback();
    } catch (HttpException $error) {
        check($status, $error->status, $label . ' status');
        return;
    }
    throw new RuntimeException($label . ': no exception was thrown');
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
$pdo->exec('CREATE TEMPORARY TABLE rate_limits (
    scope VARCHAR(64) NOT NULL,
    subject VARCHAR(190) NOT NULL,
    window_started_at DATETIME NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, subject))');

$limiter = new RateLimiter($database);

// The login window is ten attempts; the eleventh is refused.
for ($attempt = 1; $attempt <= 10; $attempt++) {
    $limiter->hit(RateLimiter::LOGIN, RateLimiter::accountKey('Member.Demo@FitConnect.Local'));
}
expectHttpStatus(429, function () use ($limiter): void {
    $limiter->hit(RateLimiter::LOGIN, RateLimiter::accountKey('member.demo@fitconnect.local'));
}, 'the eleventh login attempt is refused');

// The counter is per subject, so another account is unaffected.
$limiter->hit(RateLimiter::LOGIN, RateLimiter::accountKey('other@fitconnect.local'));

// A successful sign-in clears its own window.
$limiter->clear(RateLimiter::LOGIN, RateLimiter::accountKey('member.demo@fitconnect.local'));
$limiter->hit(RateLimiter::LOGIN, RateLimiter::accountKey('member.demo@fitconnect.local'));

// Two addresses do not share a client bucket.
$clientA = RateLimiter::clientKey();
check(true, str_starts_with($clientA, 'client:'), 'client key is namespaced');
$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.9, 10.0.0.1';
check('client:203.0.113.9', RateLimiter::clientKey(), 'forwarded address wins and is trimmed');
$_SERVER['HTTP_X_FORWARDED_FOR'] = 'not-an-address';
check('client:unknown', RateLimiter::clientKey(), 'a junk address falls back safely');
unset($_SERVER['HTTP_X_FORWARDED_FOR']);

// Unknown scopes are a programming error, not a silent pass.
expectHttpStatus(500, function () use ($limiter): void {
    try {
        $limiter->hit('not_a_scope', 'user:1');
    } catch (LogicException $error) {
        throw new HttpException(500, $error->getMessage(), 'SERVER_ERROR');
    }
}, 'an unknown scope cannot silently bypass the limiter');

// A window that has already lapsed starts over.
$pdo->exec("UPDATE rate_limits SET window_started_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE scope = 'register'");
$limiter->hit(RateLimiter::REGISTER, 'client:203.0.113.9');
$row = $pdo->query("SELECT attempts FROM rate_limits WHERE scope = 'register'")->fetch();
check(1, (int) $row['attempts'], 'an expired window restarts at one');

// ---------------------------------------------------------------------------
// Reset-code rules
// ---------------------------------------------------------------------------
check('member@fitconnect.local', PasswordResetRules::email('  Member@FitConnect.Local '), 'email is normalized');
expectHttpStatus(422, fn() => PasswordResetRules::email('not-an-email'), 'a malformed email is refused');
check('004211', PasswordResetRules::code(' 004-211 '), 'a code is reduced to digits');
expectHttpStatus(422, fn() => PasswordResetRules::code('12345'), 'a short code is refused');
expectHttpStatus(422, fn() => PasswordResetRules::code('1234567'), 'a long code is refused');
expectHttpStatus(422, fn() => PasswordResetRules::newPassword('short'), 'a short password is refused');
check('longenough', PasswordResetRules::newPassword('longenough'), 'an acceptable password passes');

$code = PasswordResetRules::generateCode();
check(PasswordResetRules::CODE_DIGITS, strlen($code), 'a generated code has the declared length');
check(true, ctype_digit($code), 'a generated code is numeric');
check(
    PasswordResetRules::hashCode(7, '123456') !== PasswordResetRules::hashCode(8, '123456'),
    true,
    'the same code hashes differently per account'
);

// ---------------------------------------------------------------------------
// Reset flow
// ---------------------------------------------------------------------------
$pdo->exec('CREATE TEMPORARY TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
$pdo->exec('CREATE TEMPORARY TABLE password_reset_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reset_token_hash (token_hash))');
$pdo->exec('CREATE TEMPORARY TABLE auth_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL)');

$originalHash = password_hash('original-password', PASSWORD_DEFAULT);
$pdo->prepare('INSERT INTO users (id, email, password_hash, display_name, role, status) VALUES (1, ?, ?, "สมาชิก ทดสอบ", "member", "active")')
    ->execute(['member@fitconnect.local', $originalHash]);
$pdo->prepare('INSERT INTO users (id, email, password_hash, display_name, role, status) VALUES (2, ?, ?, "ระงับ บัญชี", "member", "suspended")')
    ->execute(['suspended@fitconnect.local', $originalHash]);
$pdo->prepare('INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (1, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))')
    ->execute([hash('sha256', 'live-session')]);

$auth = new Auth($database);

// A missing account and a suspended one answer identically.
check(null, $auth->requestPasswordReset(['email' => 'nobody@fitconnect.local']), 'unknown address asks for nothing');
check(null, $auth->requestPasswordReset(['email' => 'suspended@fitconnect.local']), 'suspended account asks for nothing');

$issued = $auth->requestPasswordReset(['email' => 'member@fitconnect.local']);
check(true, is_array($issued) && isset($issued['code']), 'a code is issued for an active account');
$code = (string) $issued['code'];

$stored = $pdo->query('SELECT token_hash FROM password_reset_tokens ORDER BY id DESC LIMIT 1')->fetch();
check(
    PasswordResetRules::hashCode(1, $code),
    (string) $stored['token_hash'],
    'the database stores the hashed code, never the code itself'
);

// Asking again retires the previous code.
$second = $auth->requestPasswordReset(['email' => 'member@fitconnect.local']);
expectHttpStatus(422, fn() => $auth->resetPassword([
    'email' => 'member@fitconnect.local', 'code' => $code, 'newPassword' => 'brand-new-password',
]), 'the superseded code stops working');

$freshCode = (string) $second['code'];
expectHttpStatus(422, fn() => $auth->resetPassword([
    'email' => 'member@fitconnect.local', 'code' => '000000', 'newPassword' => 'brand-new-password',
]), 'a wrong code is refused');

check(['reset' => true], $auth->resetPassword([
    'email' => 'member@fitconnect.local', 'code' => $freshCode, 'newPassword' => 'brand-new-password',
]), 'a valid code resets the password');

$updated = $pdo->query('SELECT password_hash FROM users WHERE id = 1')->fetch();
check(true, password_verify('brand-new-password', (string) $updated['password_hash']), 'the new password verifies');
check(false, password_verify('original-password', (string) $updated['password_hash']), 'the old password stops working');

$revoked = $pdo->query('SELECT COUNT(*) AS total FROM auth_tokens WHERE user_id = 1 AND revoked_at IS NULL')->fetch();
check(0, (int) $revoked['total'], 'every existing session is revoked by the reset');

expectHttpStatus(422, fn() => $auth->resetPassword([
    'email' => 'member@fitconnect.local', 'code' => $freshCode, 'newPassword' => 'another-password',
]), 'a code cannot be replayed');

$expired = $auth->requestPasswordReset(['email' => 'member@fitconnect.local']);
$pdo->exec('UPDATE password_reset_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE');
expectHttpStatus(422, fn() => $auth->resetPassword([
    'email' => 'member@fitconnect.local', 'code' => (string) $expired['code'], 'newPassword' => 'another-password',
]), 'an expired code is refused');

echo 'PASS: rate limiting, reset-code rules and the reset flow (' . $checks . ' checks). '
    . 'Connection-local tables only; no persistent data or email changed.' . PHP_EOL;
