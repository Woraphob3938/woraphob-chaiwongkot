<?php
declare(strict_types=1);

final class UserAdminRules
{
    /**
     * Soft-deletion guards: an administrator never deletes the account they are
     * acting through, and user management always keeps at least one active
     * administrator who can manage accounts.
     */
    public static function assertDeletionAllowed(
        int $actorUserId,
        int $targetUserId,
        bool $targetManagesUsers,
        int $remainingActiveManagers
    ): void {
        if ($actorUserId === $targetUserId) {
            throw new HttpException(409, 'ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่', 'SELF_DELETION');
        }
        if ($targetManagesUsers && $remainingActiveManagers < 1) {
            throw new HttpException(409, 'ต้องมีผู้ดูแลระบบที่จัดการบัญชีได้อย่างน้อย 1 คน', 'LAST_USER_MANAGER');
        }
    }
}
