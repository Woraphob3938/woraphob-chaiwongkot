<?php
declare(strict_types=1);

final class NotificationService
{
    private readonly GmailMailer $mailer;

    public function __construct(
        private readonly Database $database,
        private readonly array $config,
        ?GmailMailer $mailer = null
    ) {
        $mailConfig = ($config['mail'] ?? []) + ['app_url' => (string) ($config['app_url'] ?? 'http://localhost:3000')];
        $this->mailer = $mailer ?? new GmailMailer($mailConfig);
    }

    public function recordEvent(PDO $pdo, string $event, array $context): array
    {
        $ids = [];
        $statement = $pdo->prepare(
            'INSERT IGNORE INTO notifications
             (recipient_user_id, type, category, title, message, booking_id, action_path,
              email_status, email_next_attempt_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $definitions = NotificationRules::forEvent($event, $context);
        if ($event === NotificationRules::PAYMENT_SUBMITTED) {
            $reviewers = $pdo->prepare('SELECT DISTINCT u.id, u.role,
                    (SELECT MAX(id) FROM payments WHERE booking_id = b.id) AS payment_id
                FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                JOIN users u ON (u.role = "trainer" AND u.id = tp.user_id)
                    OR (b.payment_service_mode = "gym" AND u.role = "admin" AND EXISTS (
                        SELECT 1 FROM admin_permissions ap
                        WHERE ap.user_id = u.id AND ap.review_payments = 1
                    ))
                WHERE b.id = ? AND u.status = "active"');
            $reviewers->execute([(int) $context['bookingId']]);
            foreach ($reviewers->fetchAll() as $reviewer) {
                $definitions[] = [
                    'recipientUserId' => (int) $reviewer['id'],
                    'type' => 'payment_review_' . $reviewer['payment_id'],
                    'category' => 'payment',
                    'title' => $reviewer['role'] === 'trainer' ? 'มีสลิปรอตรวจ' : 'มีสลิปของเทรนเนอร์ประจำยิม',
                    'message' => $reviewer['role'] === 'trainer'
                        ? 'สมาชิกส่งหลักฐานการชำระเงินของการจอง ' . $context['bookingPublicId'] . ' กรุณาตรวจและยืนยัน'
                        : 'สมาชิกส่งหลักฐานการชำระเงินของการจอง ' . $context['bookingPublicId'] . ' เทรนเนอร์เป็นผู้ยืนยัน',
                    'actionPath' => $reviewer['role'] === 'trainer' ? '/trainer#payment-review' : '/admin',
                    'emailRequired' => $reviewer['role'] === 'trainer',
                ];
            }
        }
        foreach ($definitions as $definition) {
            $emailStatus = $definition['emailRequired'] ? 'pending' : 'skipped';
            $statement->execute([
                $definition['recipientUserId'],
                $definition['type'],
                $definition['category'],
                $definition['title'],
                $definition['message'],
                // Events such as an application decision have no booking.
                array_key_exists('bookingId', $context) ? (int) $context['bookingId'] : null,
                $definition['actionPath'],
                $emailStatus,
                $definition['emailRequired'] ? gmdate('Y-m-d H:i:s') : null,
            ]);
            if ($statement->rowCount() === 1) {
                $ids[] = (int) $pdo->lastInsertId();
            }
        }
        return $ids;
    }

    public function deliverByIds(array $ids): void
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn(int $id): bool => $id > 0)));
        if ($ids === [] || !$this->mailer->isEnabled()) {
            return;
        }

        $pdo = $this->database->pdo();
        $lock = (int) $pdo->query("SELECT GET_LOCK('fitconnect-notification-mailer', 0)")->fetchColumn();
        if ($lock !== 1) {
            return;
        }
        try {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $statement = $pdo->prepare(
                "SELECT n.id, n.title, n.message, n.action_path, n.email_attempt_count,
                        u.email, u.display_name
                 FROM notifications n
                 JOIN users u ON u.id = n.recipient_user_id
                 WHERE n.id IN ({$placeholders})
                   AND n.email_status IN ('pending', 'failed')
                   AND n.email_attempt_count < 5
                   AND n.email_next_attempt_at <= UTC_TIMESTAMP()
                 ORDER BY n.id"
            );
            $statement->execute($ids);
            foreach ($statement->fetchAll() as $row) {
                $attempt = (int) $row['email_attempt_count'] + 1;
                try {
                    $this->mailer->send(
                        (string) $row['email'],
                        (string) $row['display_name'],
                        (string) $row['title'],
                        (string) $row['message'],
                        (string) $row['action_path']
                    );
                    $pdo->prepare(
                        'UPDATE notifications
                         SET email_status = "sent", email_attempt_count = ?, email_sent_at = UTC_TIMESTAMP(),
                             email_next_attempt_at = NULL, email_last_error = NULL
                         WHERE id = ?'
                    )->execute([$attempt, $row['id']]);
                } catch (Throwable $error) {
                    $state = self::failureState($attempt, $error->getMessage());
                    $pdo->prepare(
                        'UPDATE notifications
                         SET email_status = "failed", email_attempt_count = ?, email_next_attempt_at = ?,
                             email_last_error = ? WHERE id = ?'
                    )->execute([
                        $state['attemptCount'],
                        $state['nextAttemptAt']?->format('Y-m-d H:i:s'),
                        $state['lastError'],
                        $row['id'],
                    ]);
                    error_log('FitConnect notification email failed for notification ' . (int) $row['id'] . '.');
                }
            }
        } finally {
            $pdo->query("SELECT RELEASE_LOCK('fitconnect-notification-mailer')");
        }
    }

    public function processDue(int $limit = 20): array
    {
        $reminderIds = $this->createAppointmentReminders();
        $limit = max(1, min($limit, 100));
        $rows = $this->database->fetchAll(
            "SELECT id FROM notifications
             WHERE email_status IN ('pending', 'failed')
               AND email_attempt_count < 5
               AND email_next_attempt_at <= UTC_TIMESTAMP()
             ORDER BY email_next_attempt_at, id
             LIMIT {$limit}"
        );
        $ids = array_map(static fn(array $row): int => (int) $row['id'], $rows);
        $this->deliverByIds($ids);

        $sent = 0;
        $failed = 0;
        if ($ids !== []) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $statuses = $this->database->fetchAll(
                "SELECT email_status, COUNT(*) AS total FROM notifications
                 WHERE id IN ({$placeholders}) GROUP BY email_status",
                $ids
            );
            foreach ($statuses as $status) {
                if ($status['email_status'] === 'sent') $sent = (int) $status['total'];
                if ($status['email_status'] === 'failed') $failed = (int) $status['total'];
            }
        }
        return ['reminders' => count($reminderIds), 'sent' => $sent, 'failed' => $failed];
    }

    public function listForUser(int $userId, int $page, string $category, bool $unread): array
    {
        $where = ['n.recipient_user_id = ?'];
        $params = [$userId];
        if ($category !== 'all') {
            $where[] = 'n.category = ?';
            $params[] = $category;
        }
        if ($unread) {
            $where[] = 'n.read_at IS NULL';
        }
        $whereSql = implode(' AND ', $where);
        $countStatement = $this->database->pdo()->prepare("SELECT COUNT(*) FROM notifications n WHERE {$whereSql}");
        $countStatement->execute($params);
        $total = (int) $countStatement->fetchColumn();
        $offset = $page * 10;
        $statement = $this->database->pdo()->prepare(
            "SELECT n.id, n.type, n.category, n.title, n.message, n.action_path, n.read_at,
                    n.created_at, b.public_id AS booking_public_id
             FROM notifications n
             LEFT JOIN bookings b ON b.id = n.booking_id
             WHERE {$whereSql}
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT 10 OFFSET {$offset}"
        );
        $statement->execute($params);
        $items = array_map(fn(array $row): array => $this->itemPayload($row), $statement->fetchAll());

        $unreadCounts = ['all' => 0, 'booking' => 0, 'payment' => 0, 'appointment' => 0];
        $counts = $this->database->fetchAll(
            'SELECT category, COUNT(*) AS total FROM notifications
             WHERE recipient_user_id = ? AND read_at IS NULL GROUP BY category',
            [$userId]
        );
        foreach ($counts as $count) {
            $value = (int) $count['total'];
            $unreadCounts[(string) $count['category']] = $value;
            $unreadCounts['all'] += $value;
        }

        return [
            'items' => $items,
            'unread' => $unreadCounts,
            'pagination' => [
                'page' => $page,
                'pageSize' => 10,
                'total' => $total,
                'totalPages' => $total === 0 ? 0 : (int) ceil($total / 10),
            ],
        ];
    }

    public function detailForUser(int $userId, int $notificationId): ?array
    {
        $row = $this->database->fetchOne(
            'SELECT n.id, n.type, n.category, n.title, n.message, n.action_path, n.read_at, n.created_at,
                    b.id AS booking_internal_id, b.public_id AS booking_public_id, b.starts_at, b.ends_at,
                    b.status, b.payment_status, b.quoted_price,
                    member.display_name AS member_name, trainer.display_name AS trainer_name
             FROM notifications n
             LEFT JOIN bookings b ON b.id = n.booking_id
             LEFT JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             LEFT JOIN users member ON member.id = b.member_user_id
             LEFT JOIN users trainer ON trainer.id = tp.user_id
             WHERE n.id = ? AND n.recipient_user_id = ?',
            [$notificationId, $userId]
        );
        if (!$row) return null;

        $history = $this->database->fetchAll(
            'SELECT from_status, to_status, note, created_at
             FROM booking_status_history WHERE booking_id = ? ORDER BY created_at, id',
            [(int) $row['booking_internal_id']]
        );
        // การแจ้งเตือนที่ไม่มีการจอง (ผลการอนุมัติใบสมัคร) ส่ง booking: null
        // เพราะฝั่ง UI ตัดสินปุ่มถัดไปจาก !detail.booking
        if ($row['booking_internal_id'] === null) {
            return $this->itemPayload($row) + ['booking' => null];
        }
        return $this->itemPayload($row) + [
            'booking' => [
                'id' => (string) $row['booking_public_id'],
                'memberName' => (string) $row['member_name'],
                'trainerName' => (string) $row['trainer_name'],
                'startsAt' => self::iso((string) $row['starts_at']),
                'endsAt' => self::iso((string) $row['ends_at']),
                'status' => (string) $row['status'],
                'paymentStatus' => (string) $row['payment_status'],
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'history' => array_map(static fn(array $entry): array => [
                    'fromStatus' => $entry['from_status'],
                    'toStatus' => (string) $entry['to_status'],
                    'note' => $entry['note'],
                    'createdAt' => self::iso((string) $entry['created_at']),
                ], $history),
            ],
        ];
    }

    public function markRead(int $userId, int $notificationId): bool
    {
        $statement = $this->database->pdo()->prepare(
            'UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
             WHERE id = ? AND recipient_user_id = ?'
        );
        $statement->execute([$notificationId, $userId]);
        if ($statement->rowCount() > 0) return true;
        return $this->database->fetchOne(
            'SELECT id FROM notifications WHERE id = ? AND recipient_user_id = ?',
            [$notificationId, $userId]
        ) !== null;
    }

    public function markAllRead(int $userId): int
    {
        return $this->database->execute(
            'UPDATE notifications SET read_at = UTC_TIMESTAMP()
             WHERE recipient_user_id = ? AND read_at IS NULL',
            [$userId]
        );
    }

    public static function parsePage(mixed $value): int
    {
        if (is_array($value) || preg_match('/^\d+$/', (string) $value) !== 1) {
            throw new HttpException(422, 'หน้ารายการไม่ถูกต้อง', 'VALIDATION_FAILED', ['page' => 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป']);
        }
        return min((int) $value, 100000);
    }

    public static function parseCategory(mixed $value): string
    {
        if (is_array($value) || !in_array((string) $value, ['all', 'booking', 'payment', 'appointment'], true)) {
            throw new HttpException(422, 'หมวดการแจ้งเตือนไม่ถูกต้อง', 'VALIDATION_FAILED', ['category' => 'เลือกหมวดที่ระบบรองรับ']);
        }
        return (string) $value;
    }

    public static function parseUnread(mixed $value): bool
    {
        if ($value === true || $value === 'true' || $value === '1' || $value === 1) return true;
        if ($value === false || $value === 'false' || $value === '0' || $value === 0) return false;
        throw new HttpException(422, 'ตัวกรองสถานะอ่านไม่ถูกต้อง', 'VALIDATION_FAILED', ['unread' => 'ใช้ true หรือ false']);
    }

    public static function retryDelayMinutes(int $attempt): int
    {
        return match ($attempt) {
            1 => 1,
            2 => 5,
            3 => 15,
            4 => 60,
            default => 0,
        };
    }

    public static function failureState(int $attempt, string $error): array
    {
        $attempt = max(1, min($attempt, 5));
        $delay = self::retryDelayMinutes($attempt);
        return [
            'status' => 'failed',
            'attemptCount' => $attempt,
            'nextAttemptAt' => $delay === 0
                ? null
                : (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify("+{$delay} minutes"),
            'lastError' => self::sanitizeError($error),
        ];
    }

    private function createAppointmentReminders(): array
    {
        return $this->database->transaction(function (PDO $pdo): array {
            $rows = $pdo->query(
                'SELECT b.id AS booking_id, b.public_id, b.member_user_id, tp.user_id AS trainer_user_id,
                        member.display_name AS member_name, trainer.display_name AS trainer_name,
                        b.starts_at, b.ends_at, b.quoted_price
                 FROM bookings b
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users member ON member.id = b.member_user_id
                 JOIN users trainer ON trainer.id = tp.user_id
                 WHERE b.status = "confirmed"
                   AND b.starts_at > UTC_TIMESTAMP()
                   AND b.starts_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
                 ORDER BY b.id FOR UPDATE'
            )->fetchAll();
            $ids = [];
            foreach ($rows as $row) {
                $ids = array_merge($ids, $this->recordEvent($pdo, NotificationRules::APPOINTMENT_REMINDER, [
                    'bookingId' => (int) $row['booking_id'],
                    'bookingPublicId' => (string) $row['public_id'],
                    'memberUserId' => (int) $row['member_user_id'],
                    'trainerUserId' => (int) $row['trainer_user_id'],
                    'memberName' => (string) $row['member_name'],
                    'trainerName' => (string) $row['trainer_name'],
                    'startsAt' => (string) $row['starts_at'],
                    'endsAt' => (string) $row['ends_at'],
                    'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                    'previousStatus' => 'confirmed',
                    'nextStatus' => 'confirmed',
                    'reviewNote' => '',
                ]));
            }
            return $ids;
        });
    }

    private static function sanitizeError(string $error): string
    {
        $sanitized = preg_replace('/(password|pass|token|secret)\s*[=:]\s*\S+/iu', '$1=[redacted]', $error) ?? '';
        $sanitized = preg_replace('/[\r\n\t]+/', ' ', $sanitized) ?? '';
        return mb_substr(trim($sanitized) ?: 'ส่งอีเมลไม่สำเร็จ', 0, 500);
    }

    private function itemPayload(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'type' => (string) $row['type'],
            'category' => (string) $row['category'],
            'title' => (string) $row['title'],
            'message' => (string) $row['message'],
            // Booking-less events (application decisions) carry no booking id.
            'bookingId' => $row['booking_public_id'] ?? null,
            'actionPath' => (string) $row['action_path'],
            'readAt' => $row['read_at'] === null ? null : self::iso((string) $row['read_at']),
            'createdAt' => self::iso((string) $row['created_at']),
        ];
    }

    private static function iso(string $value): string
    {
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s.000\Z');
    }
}
