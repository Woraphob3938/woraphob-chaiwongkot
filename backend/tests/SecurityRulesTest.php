<?php
declare(strict_types=1);

/**
 * Rate limiting, request-field hardening and the password reset flow. Runs
 * against connection-local temporary tables that shadow the real names, so no
 * user row, token or counter outside this process is touched.
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

/** Runs the callback as a failed test if PHP emits any warning while it runs. */
function withoutWarnings(callable $callback, string $label): mixed
{
    set_error_handler(function (int $severity, string $message) use ($label): bool {
        throw new ErrorException($label . ' emitted a PHP warning: ' . $message, 0, $severity);
    });
    try {
        return $callback();
    } finally {
        restore_error_handler();
    }
}

/** The HttpException a call raised, or null when it raised none. */
function captureHttp(callable $callback): ?HttpException
{
    try {
        withoutWarnings($callback, 'request field handling');
    } catch (HttpException $error) {
        return $error;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Request field hardening
// ---------------------------------------------------------------------------
// A list sent for a text field used to be cast to the literal "Array", which is
// non-empty: the required-field check passed, PHP printed an array-to-string
// warning into the response, and the row stored the word "Array".
$listRefusal = captureHttp(fn() => Http::requireFields(['email' => ['x'], 'password' => 'y'], ['email', 'password']));
check(422, $listRefusal?->status, 'a list-valued required field is refused with 422');
check('VALIDATION_FAILED', $listRefusal?->errorCode, 'the refusal is a validation failure');
check(true, isset($listRefusal?->fields['email']), 'the refusal names the field that carried the list');
check(false, isset($listRefusal?->fields['password']), 'a text field alongside it is not reported');

check(422, captureHttp(fn() => Http::requireFields(['role' => true], ['role']))?->status, 'a boolean required field is refused');
check(422, captureHttp(fn() => Http::requireFields(['role' => null], ['role']))?->status, 'a null required field is refused');
check(422, captureHttp(fn() => Http::requireFields(['role' => ' '], ['role']))?->status, 'a blank required field is still refused');
check(422, captureHttp(fn() => Http::requireFields([], ['role']))?->status, 'a missing required field is still refused');
check(null, captureHttp(fn() => Http::requireFields(['priceFrom' => ' 650 '], ['priceFrom'])), 'a text field passes the required check');

check('', Http::stringField(['email' => ['x']], 'email'), 'a list field reads as empty text, never as "Array"');
check('', Http::stringField(['email' => true], 'email'), 'a boolean field reads as empty text');
check('42', Http::stringField(['trainerId' => 42], 'trainerId'), 'a number field reads as its digits');
check('fallback', Http::stringField([], 'note', 'fallback'), 'a missing field takes the given default');

check(422, captureHttp(fn() => Http::assertTextFields(['headline' => ['x']], ['headline']))?->status, 'a list is refused before it reaches a rule class');
check(null, captureHttp(fn() => Http::assertTextFields(['birthDate' => null], ['birthDate'])), 'null is how an optional field is cleared');
check(null, captureHttp(fn() => Http::assertTextFields(['trainingTypeIds' => [1, 2]], ['headline'])), 'a list field that was not listed is left alone');

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

// X-Forwarded-For is caller-supplied, so it is only believed when the direct
// peer is a configured proxy. With TRUSTED_PROXIES unset — the default — a
// rotating header must not hand out a fresh bucket, or the register cap is free
// to bypass.
$previousProxies = getenv('TRUSTED_PROXIES');
$previousRemoteAddress = $_SERVER['REMOTE_ADDR'] ?? null;
$previousForwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null;
try {
    putenv('TRUSTED_PROXIES');
    $_SERVER['REMOTE_ADDR'] = '198.51.100.7';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.9, 10.0.0.1';
    check('client:198.51.100.7', RateLimiter::clientKey(), 'a spoofed header is ignored by default');

    // The same header is honoured once the peer that sent it is trusted.
    putenv('TRUSTED_PROXIES=198.51.100.7');
    check('client:203.0.113.9', RateLimiter::clientKey(), 'a trusted proxy may name the client');

    // An untrusted peer stays on its own socket address, allowlist or not.
    $_SERVER['REMOTE_ADDR'] = '198.51.100.8';
    check('client:198.51.100.8', RateLimiter::clientKey(), 'an unlisted peer cannot spoof the header');

    // Junk in the allowlist and in the header both fail closed.
    putenv('TRUSTED_PROXIES=not-an-address');
    check('client:198.51.100.8', RateLimiter::clientKey(), 'a junk allowlist trusts nobody');
    putenv('TRUSTED_PROXIES=198.51.100.8');
    $_SERVER['HTTP_X_FORWARDED_FOR'] = 'not-an-address';
    check('client:unknown', RateLimiter::clientKey(), 'a junk address falls back safely');
} finally {
    if ($previousProxies === false) {
        putenv('TRUSTED_PROXIES');
    } else {
        putenv('TRUSTED_PROXIES=' . $previousProxies);
    }
    if ($previousRemoteAddress === null) {
        unset($_SERVER['REMOTE_ADDR']);
    } else {
        $_SERVER['REMOTE_ADDR'] = $previousRemoteAddress;
    }
    if ($previousForwarded === null) {
        unset($_SERVER['HTTP_X_FORWARDED_FOR']);
    } else {
        $_SERVER['HTTP_X_FORWARDED_FOR'] = $previousForwarded;
    }
}

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

// ---------------------------------------------------------------------------
// User deletion guards
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/UserAdminRules.php';

UserAdminRules::assertDeletionAllowed(5, 9, false, 2);
UserAdminRules::assertDeletionAllowed(5, 9, true, 1);
UserAdminRules::assertDeletionAllowed(5, 9, false, 0);

$selfDeletion = null;
try {
    UserAdminRules::assertDeletionAllowed(5, 5, true, 3);
} catch (HttpException $error) {
    $selfDeletion = $error;
}
check('SELF_DELETION', $selfDeletion?->errorCode, 'an administrator never deletes their own account');
check(409, $selfDeletion?->status, 'self deletion answers 409');

$lastManager = null;
try {
    UserAdminRules::assertDeletionAllowed(5, 9, true, 0);
} catch (HttpException $error) {
    $lastManager = $error;
}
check('LAST_USER_MANAGER', $lastManager?->errorCode, 'the last account manager cannot be deleted');
check(409, $lastManager?->status, 'the last manager guard answers 409');

// A deleted account cannot sign in and cannot use a lingering token.
$pdo->prepare('INSERT INTO users (id, email, password_hash, display_name, role, status) VALUES (3, ?, ?, "ลบ แล้ว", "member", "deleted")')
    ->execute(['deleted@fitconnect.local', $originalHash]);
$pdo->prepare('INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (3, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))')
    ->execute([hash('sha256', 'deleted-session')]);
expectHttpStatus(403, fn() => $auth->login([
    'email' => 'deleted@fitconnect.local', 'password' => 'original-password',
]), 'a deleted account cannot sign in');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer deleted-session';
check(null, $auth->currentUser(), 'a deleted account cannot use an existing token');
unset($_SERVER['HTTP_AUTHORIZATION']);

echo 'PASS: rate limiting, request-field hardening and the reset flow (' . $checks . ' checks). '
    . 'Connection-local tables only; no persistent data or email changed.' . PHP_EOL;
