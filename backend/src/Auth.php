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
        $email = strtolower(trim((string) $input['email']));
        $role = (string) $input['role'];

        $fields = [];
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $fields['email'] = 'อีเมลไม่ถูกต้อง';
        }
        if (mb_strlen((string) $input['password']) < 8) {
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

        $userId = $this->database->transaction(function (PDO $pdo) use ($email, $input, $role): int {
            $statement = $pdo->prepare('INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, "active")');
            $statement->execute([
                $email,
                password_hash((string) $input['password'], PASSWORD_DEFAULT),
                trim((string) $input['displayName']),
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
            [strtolower(trim((string) $input['email']))]
        );
        if (!$user || !password_verify((string) $input['password'], $user['password_hash'])) {
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

        $user = $this->database->fetchOne(
            'SELECT u.id, u.email, u.display_name, u.role, u.status
             FROM auth_tokens t JOIN users u ON u.id = t.user_id
             WHERE t.token_hash = ? AND t.expires_at > UTC_TIMESTAMP() AND t.revoked_at IS NULL',
            [hash('sha256', $token)]
        );
        if (!$user || $user['status'] !== 'active') {
            throw new HttpException(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'INVALID_TOKEN');
        }
        if ($roles !== null && !in_array($user['role'], $roles, true)) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ', 'FORBIDDEN');
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
        if (!$row || !password_verify((string) $input['currentPassword'], $row['password_hash'])) {
            throw new HttpException(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'INVALID_CREDENTIALS', [
                'currentPassword' => 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
            ]);
        }
        if (mb_strlen((string) $input['newPassword']) < 8) {
            throw new HttpException(422, 'รหัสผ่านใหม่ไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'newPassword' => 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
            ]);
        }

        $currentTokenHash = hash('sha256', (string) $token);
        $newHash = password_hash((string) $input['newPassword'], PASSWORD_DEFAULT);
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
