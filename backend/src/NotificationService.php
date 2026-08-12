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
        foreach (NotificationRules::forEvent($event, $context) as $definition) {
            $emailStatus = $definition['emailRequired'] ? 'pending' : 'skipped';
            $statement->execute([
                $definition['recipientUserId'],
                $definition['type'],
                $definition['category'],
                $definition['title'],
                $definition['message'],
                (int) $context['bookingId'],
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
}
