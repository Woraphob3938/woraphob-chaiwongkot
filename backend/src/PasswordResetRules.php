<?php
declare(strict_types=1);

final class PasswordResetRules
{
    /** Six digits keep the code typeable on a phone; the window keeps it short-lived. */
    public const CODE_DIGITS = 6;
    public const CODE_TTL_MINUTES = 15;
    public const MAX_ACTIVE_CODES = 3;

    public static function email(mixed $value): string
    {
        $email = strtolower(trim((string) $value));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new HttpException(422, 'อีเมลไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'email' => 'กรอกอีเมลที่ใช้สมัคร',
            ]);
        }
        return $email;
    }

    public static function code(mixed $value): string
    {
        $code = preg_replace('/\D/', '', (string) $value) ?? '';
        if (strlen($code) !== self::CODE_DIGITS) {
            throw new HttpException(422, 'รหัสยืนยันไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'code' => 'กรอกรหัส ' . self::CODE_DIGITS . ' หลักจากอีเมล',
            ]);
        }
        return $code;
    }

    public static function newPassword(mixed $value): string
    {
        $password = (string) $value;
        if (mb_strlen($password) < 8) {
            throw new HttpException(422, 'รหัสผ่านใหม่ไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'newPassword' => 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
            ]);
        }
        if (mb_strlen($password) > 200) {
            throw new HttpException(422, 'รหัสผ่านใหม่ไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'newPassword' => 'รหัสผ่านยาวเกินไป',
            ]);
        }
        return $password;
    }

    /** A code is stored hashed with the account id, so a dump cannot be replayed. */
    public static function hashCode(int $userId, string $code): string
    {
        return hash('sha256', $userId . ':' . $code);
    }

    public static function generateCode(): string
    {
        return str_pad((string) random_int(0, 10 ** self::CODE_DIGITS - 1), self::CODE_DIGITS, '0', STR_PAD_LEFT);
    }

    /**
     * The same answer for every address, so the endpoint cannot be used to find
     * out which emails have accounts.
     */
    public static function genericRequestMessage(): string
    {
        return 'หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งรหัสตั้งรหัสผ่านใหม่ให้แล้ว กรุณาตรวจกล่องจดหมายและอีเมลขยะ';
    }
}
