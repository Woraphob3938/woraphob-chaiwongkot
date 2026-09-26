<?php
declare(strict_types=1);

final class Auth
{
    public function __construct(private readonly Database $database)
    {
    }

    public function register(array $input): array
    {
        Http::requireFields($input, ['displayName', 'email', 'password', 'role']);
        // Every request value is read through Http::stringField(), which answers
        // '' for anything that is not text: a cast would turn an array into the
        // literal "Array" and write it to the row.
        $email = strtolower(trim(Http::stringField($input, 'email')));
        $role = Http::stringField($input, 'role');
        $password = Http::stringField($input, 'password');
        $displayName = trim(Http::stringField($input, 'displayName'));

        $fields = [];
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $fields['email'] = 'อีเมลไม่ถูกต้อง';
        }
        if (mb_strlen($password) < 8) {
            $fields['password'] = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
        }
        if (!in_array($role, ['member', 'trainer'], true)) {
            $fields['role'] = 'ประเภทบัญชีไม่ถูกต้อง';
        }
        if ($fields !== []) {
            throw new HttpException(422, 'ข้อมูลสมัครสมาชิกไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        }
        if ($this->database->fetchOne('SELECT id FROM users WHERE email = ?', [$email])) {
            throw new HttpException(409, 'อีเมลนี้ถูกใช้งานแล้ว', 'EMAIL_EXISTS', ['email' => 'อีเมลนี้ถูกใช้งานแล้ว']);
        }

        $userId = $this->database->transaction(function (PDO $pdo) use ($email, $password, $displayName, $role): int {
            $statement = $pdo->prepare('INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, "active")');
            $statement->execute([
                $email,
                password_hash($password, PASSWORD_DEFAULT),
                $displayName,
                $role,
            ]);
            $userId = (int) $pdo->lastInsertId();
            if ($role === 'member') {
                $pdo->prepare('INSERT INTO member_profiles (user_id) VALUES (?)')->execute([$userId]);
            }
            return $userId;
        });

        return $this->issueToken($userId);
    }

    public function login(array $input): array
    {
        Http::requireFields($input, ['email', 'password']);
        $user = $this->database->fetchOne(
            'SELECT id, email, display_name, role, status, password_hash FROM users WHERE email = ?',
            [strtolower(trim(Http::stringField($input, 'email')))]
        );
        if (!$user || !password_verify(Http::stringField($input, 'password'), $user['password_hash'])) {
            throw new HttpException(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS');
        }
        if ($user['status'] !== 'active') {
            throw new HttpException(403, 'บัญชีนี้ยังไม่พร้อมใช้งาน', 'ACCOUNT_DISABLED');
        }
        return $this->issueToken((int) $user['id']);
    }

    public function requireUser(?array $roles = null): array
    {
        $token = Http::bearerToken();
        if ($token === null) {
            throw new HttpException(401, 'กรุณาเข้าสู่ระบบ', 'AUTH_REQUIRED');
        }

        $user = $this->currentUser();
        if ($user === null) {
            throw new HttpException(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'INVALID_TOKEN');
        }
        if ($roles !== null && !in_array($user['role'], $roles, true)) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ', 'FORBIDDEN');
        }
        return $user;
    }

    public function currentUser(): ?array
    {
        $token = Http::bearerToken();
        if ($token === null) {
            return null;
        }

        $user = $this->database->fetchOne(
            'SELECT u.id, u.email, u.display_name, u.role, u.status
             FROM auth_tokens t JOIN users u ON u.id = t.user_id
             WHERE t.token_hash = ? AND t.expires_at > UTC_TIMESTAMP() AND t.revoked_at IS NULL',
            [hash('sha256', $token)]
        );
        if (!$user || $user['status'] !== 'active') {
            return null;
        }
        return $this->publicUser($user);
    }

    public function logout(): void
    {
        $token = Http::bearerToken();
        if ($token === null) {
            throw new HttpException(401, 'กรุณาเข้าสู่ระบบ', 'AUTH_REQUIRED');
        }

        $revoked = $this->database->execute(
            'UPDATE auth_tokens
             SET revoked_at = UTC_TIMESTAMP()
             WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() AND revoked_at IS NULL',
            [hash('sha256', $token)]
        );
        if ($revoked !== 1) {
            throw new HttpException(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'INVALID_TOKEN');
        }
    }

    public function changePassword(array $input): array
    {
        Http::requireFields($input, ['currentPassword', 'newPassword']);
        $token = Http::bearerToken();
        $user = $this->requireUser(['member', 'trainer', 'admin']);
        $row = $this->database->fetchOne('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if (!$row || !password_verify(Http::stringField($input, 'currentPassword'), $row['password_hash'])) {
            throw new HttpException(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'INVALID_CREDENTIALS', [
                'currentPassword' => 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
            ]);
        }
        $newPassword = Http::stringField($input, 'newPassword');
        if (mb_strlen($newPassword) < 8) {
            throw new HttpException(422, 'รหัสผ่านใหม่ไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'newPassword' => 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
            ]);
        }

        $currentTokenHash = hash('sha256', (string) $token);
        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $this->database->transaction(function (PDO $pdo) use ($user, $newHash, $currentTokenHash): void {
            $pdo->prepare('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$newHash, $user['id']]);
            $pdo->prepare(
                'UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP()
                 WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL'
            )->execute([$user['id'], $currentTokenHash]);
        });

        return ['changed' => true];
    }

    /**
     * Issues a reset code for an address that has an account. The endpoint that
     * calls this answers the same way whatever happens here, so the reply cannot
     * be used to discover which addresses are registered.
     */
    public function requestPasswordReset(array $input): ?array
    {
        $email = PasswordResetRules::email($input['email'] ?? '');
        $user = $this->database->fetchOne(
            'SELECT id, email, display_name, status FROM users WHERE email = ?',
            [$email]
        );
        if (!$user || $user['status'] !== 'active') {
            return null;
        }

        $userId = (int) $user['id'];
        $code = PasswordResetRules::generateCode();
        $this->database->transaction(function (PDO $pdo) use ($userId, $code): void {
            // Older codes stop working the moment a new one is asked for.
            $pdo->prepare('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL')
                ->execute([$userId]);
            $pdo->prepare(
                'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
                 VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))'
            )->execute([$userId, PasswordResetRules::hashCode($userId, $code), PasswordResetRules::CODE_TTL_MINUTES]);
            $pdo->prepare(
                'DELETE FROM password_reset_tokens
                 WHERE user_id = ? AND created_at <= UTC_TIMESTAMP() - INTERVAL 1 DAY'
            )->execute([$userId]);
        });

        return ['email' => $user['email'], 'displayName' => $user['display_name'], 'code' => $code];
    }

    public function resetPassword(array $input): array
    {
        $email = PasswordResetRules::email($input['email'] ?? '');
        $code = PasswordResetRules::code($input['code'] ?? '');
        $newPassword = PasswordResetRules::newPassword($input['newPassword'] ?? '');

        $user = $this->database->fetchOne('SELECT id FROM users WHERE email = ? AND status = "active"', [$email]);
        if (!$user) {
            throw new HttpException(422, 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ', 'INVALID_RESET_CODE', [
                'code' => 'ขอรหัสใหม่แล้วลองอีกครั้ง',
            ]);
        }
        $userId = (int) $user['id'];

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $consumed = $this->database->transaction(function (PDO $pdo) use ($userId, $code, $newHash): bool {
            $statement = $pdo->prepare(
                'SELECT id FROM password_reset_tokens
                 WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
                 ORDER BY id DESC LIMIT 1 FOR UPDATE'
            );
            $statement->execute([$userId, PasswordResetRules::hashCode($userId, $code)]);
            $token = $statement->fetch();
            if (!$token) {
                return false;
            }

            $pdo->prepare('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([(int) $token['id']]);
            $pdo->prepare('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$newHash, $userId]);
            // A reset is the answer to a suspected compromise, so every existing
            // session ends here rather than staying valid for up to 30 days.
            $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')
                ->execute([$userId]);
            return true;
        });

        if (!$consumed) {
            throw new HttpException(422, 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ', 'INVALID_RESET_CODE', [
                'code' => 'ขอรหัสใหม่แล้วลองอีกครั้ง',
            ]);
        }

        return ['reset' => true];
    }

    private function issueToken(int $userId): array
    {
        $token = bin2hex(random_bytes(32));
        $this->database->execute(
            'INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))',
            [$userId, hash('sha256', $token)]
        );
        $user = $this->database->fetchOne('SELECT id, email, display_name, role, status FROM users WHERE id = ?', [$userId]);
        return ['token' => $token, 'user' => $this->publicUser($user ?? [])];
    }

    private function publicUser(array $user): array
    {
        return [
            'id' => (int) ($user['id'] ?? 0),
            'email' => $user['email'] ?? '',
            'displayName' => $user['display_name'] ?? '',
            'role' => $user['role'] ?? '',
            'status' => $user['status'] ?? '',
        ];
    }
}
