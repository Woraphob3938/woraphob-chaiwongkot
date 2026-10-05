<?php
declare(strict_types=1);

/** Booking chat rooms, pre-booking inquiry rooms and their attachments. Part of Handlers. */
trait ChatHandlers
{
    public function messages(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $rawAfterId = $_GET['afterId'] ?? '0';
        $afterId = is_array($rawAfterId) || preg_match('/^\d+$/', (string) $rawAfterId) !== 1
            ? false
            : filter_var((string) $rawAfterId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($afterId === false) {
            throw new HttpException(422, 'ตัวชี้ข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['afterId' => 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป']);
        }

        $rows = $this->database->transaction(function (PDO $pdo) use ($room, $afterId, $user): array {
            $select = 'SELECT m.id, m.message_text, m.attachment_path, m.attachment_mime, m.attachment_name,
                              m.attachment_size, m.image_path, m.image_mime, m.image_name, m.image_size,
                              m.read_at, m.created_at, u.id AS sender_id, u.display_name
                       FROM messages m JOIN users u ON u.id = m.sender_user_id
                       WHERE m.chat_room_id = ? AND m.id > ?';
            $page = $this->database->fetchAll($select . ' ORDER BY m.id ASC LIMIT 500 FOR UPDATE', [$room['id'], $afterId]);
            if ($page === []) {
                return [];
            }
            $maxId = (int) $page[count($page) - 1]['id'];
            $pdo->prepare(
                'UPDATE messages SET read_at = UTC_TIMESTAMP()
                 WHERE chat_room_id = ? AND id > ? AND id <= ? AND sender_user_id <> ? AND read_at IS NULL'
            )->execute([$room['id'], $afterId, $maxId, $user['id']]);
            // Read the page again so it carries the read_at just written.
            return $this->database->fetchAll($select . ' AND m.id <= ? ORDER BY m.id ASC', [$room['id'], $afterId, $maxId]);
        });
        Http::json(array_map(fn(array $row): array => $this->messagePayload(
            (int) $row['id'],
            (int) $room['id'],
            (string) $row['message_text'],
            $row['attachment_path'] === null ? null : ['name' => $row['attachment_name'], 'mime' => $row['attachment_mime'], 'size' => (int) $row['attachment_size']],
            $row['image_path'] === null ? null : ['name' => $row['image_name'], 'mime' => $row['image_mime'], 'size' => (int) $row['image_size']],
            $row['read_at'] === null ? null : $this->iso($row['read_at']),
            $this->iso($row['created_at']),
            ['id' => (int) $row['sender_id'], 'displayName' => $row['display_name']]
        ), $rows));
    }

    /**
     * One message can carry both an image and a file; the legacy `attachment`
     * key mirrors the file so older clients keep working.
     */
    private function messagePayload(
        int $messageId,
        int $roomId,
        string $message,
        ?array $file,
        ?array $image,
        ?string $readAt,
        string $createdAt,
        array $sender
    ): array {
        $base = '/v1/chat-rooms/' . $roomId . '/messages/' . $messageId . '/attachment';
        return [
            'id' => $messageId,
            'message' => $message,
            'attachment' => $file === null ? null : [
                'name' => $file['name'],
                'mime' => $file['mime'],
                'size' => $file['size'],
                'url' => $base,
            ],
            'imageUrl' => $image === null ? null : $base . '?kind=image',
            'imageName' => $image['name'] ?? null,
            'imageSize' => $image['size'] ?? null,
            'attachmentUrl' => $file === null ? null : $base . '?kind=file',
            'attachmentName' => $file['name'] ?? null,
            'attachmentSize' => $file['size'] ?? null,
            'readAt' => $readAt,
            'createdAt' => $createdAt,
            'sender' => $sender,
        ];
    }

    public function sendMessage(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        if ($room['booking_id'] === null) {
            // An inquiry stays open while the trainer is listed on the platform.
            if ($room['trainer_approval_status'] !== 'approved') {
                throw new HttpException(409, 'ห้องสนทนานี้ส่งข้อความเพิ่มไม่ได้', 'CHAT_READ_ONLY');
            }
        } else {
            WorkflowRules::assertChatWritable((string) $room['booking_status']);
        }
        $this->rateLimiter->hit(RateLimiter::CHAT_ATTACHMENT, 'user:' . $user['id'] . ':room:' . (int) $roomId);
        $input = Http::body();
        // `text` is the documented field; `message` is what older clients send.
        $textField = array_key_exists('text', $input) ? 'text' : 'message';
        if (array_key_exists($textField, $input) && !is_string($input[$textField])) {
            throw new HttpException(422, 'รูปแบบข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['message' => 'ต้องเป็นข้อความ']);
        }
        $message = trim(Http::stringField($input, $textField));
        if (mb_strlen($message) > 4000) {
            throw new HttpException(422, 'ข้อความยาวเกิน 4,000 ตัวอักษร', 'VALIDATION_FAILED');
        }
        // One message can carry an image and a file at the same time; the two
        // live in separate column sets and render side by side in the bubble.
        $imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        $image = $this->saveUpload('image', $imageTypes, 5 * 1024 * 1024, 'messages', false);
        $file = $this->saveUpload('file', [...$imageTypes, 'application/pdf'], 5 * 1024 * 1024, 'messages', false);
        if ($message === '' && $image === null && $file === null) {
            throw new HttpException(422, 'กรุณาพิมพ์ข้อความหรือแนบไฟล์', 'VALIDATION_FAILED');
        }

        $notificationIds = [];
        try {
            $messageId = $this->database->transaction(function (PDO $pdo) use ($room, $user, $message, $image, $file, &$notificationIds): int {
                $pdo->prepare(
                    'INSERT INTO messages
                        (chat_room_id, sender_user_id, message_text, attachment_path, attachment_mime, attachment_name, attachment_size,
                         image_path, image_mime, image_name, image_size)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $room['id'],
                    $user['id'],
                    $message,
                    $file['path'] ?? null,
                    $file['mime'] ?? null,
                    $file['name'] ?? null,
                    $file['size'] ?? null,
                    $image['path'] ?? null,
                    $image['mime'] ?? null,
                    $image['name'] ?? null,
                    $image['size'] ?? null,
                ]);
                $messageId = (int) $pdo->lastInsertId();
                $recipientId = (int) $user['id'] === (int) $room['member_user_id']
                    ? (int) $room['trainer_user_id']
                    : (int) $room['member_user_id'];
                if ($room['booking_id'] === null) {
                    $this->notify($pdo, $notificationIds, NotificationRules::INQUIRY_MESSAGE_RECEIVED, ['recipientUserId' => $recipientId, 'senderName' => (string) $user['displayName'], 'roomId' => (int) $room['id'], 'messageId' => $messageId]);
                    return $messageId;
                }
                $this->notify($pdo, $notificationIds, NotificationRules::MESSAGE_RECEIVED, ['bookingId' => (int) $room['booking_id'], 'bookingPublicId' => (string) $room['booking_public_id'], 'memberUserId' => (int) $room['member_user_id'], 'trainerUserId' => (int) $room['trainer_user_id'], 'recipientUserId' => $recipientId, 'senderName' => (string) $user['displayName'], 'messageId' => $messageId]);
                return $messageId;
            });
        } catch (Throwable $error) {
            if ($image !== null) {
                $this->removeUpload($image['path']);
            }
            if ($file !== null) {
                $this->removeUpload($file['path']);
            }
            throw $error;
        }
        $this->notifications->deliverByIds($notificationIds);

        Http::json($this->messagePayload(
            $messageId,
            (int) $room['id'],
            $message,
            $file,
            $image,
            null,
            gmdate('c'),
            ['id' => (int) $user['id'], 'displayName' => $user['displayName']]
        ), 201);
    }

    public function chatAttachment(string $roomId, string $messageId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $kind = (string) ($_GET['kind'] ?? 'file');
        if ($kind === 'image') {
            $pathColumn = 'image_path';
            $nameColumn = 'image_name';
        } elseif ($kind === 'file') {
            $pathColumn = 'attachment_path';
            $nameColumn = 'attachment_name';
        } else {
            throw new HttpException(422, 'ประเภทไฟล์ไม่ถูกต้อง', 'VALIDATION_FAILED', ['kind' => 'เลือก image หรือ file']);
        }
        $attachment = $this->database->fetchOne(
            "SELECT {$pathColumn} AS file_path, {$nameColumn} AS file_name
             FROM messages WHERE id = ? AND chat_room_id = ? AND {$pathColumn} IS NOT NULL",
            [(int) $messageId, $room['id']]
        );
        if (!$attachment) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }

        $target = self::uploadPath((string) $attachment['file_path']);
        $mime = $target === null ? false : (new finfo(FILEINFO_MIME_TYPE))->file($target);
        if ($mime === false) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }
        $rawName = trim((string) basename((string) $attachment['file_name']));
        $safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $rawName) ?? '';
        $displayName = mb_substr($safeName, 0, 255);
        if ($displayName === '') {
            $displayName = 'attachment';
        }
        $asciiName = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $displayName) ?? '';
        if ($asciiName === '') {
            $asciiName = 'attachment';
        }

        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($target));
        // Images render inside the chat bubble; files download as attachments.
        $disposition = $kind === 'image' ? 'inline' : 'attachment';
        header('Content-Disposition: ' . $disposition . '; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($displayName));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        readfile($target);
        exit;
    }

    /**
     * A room belongs to a booking, or — for a question asked from a trainer's
     * profile before booking (บทที่ 3 ภาพที่ 3-16) — directly to one member and
     * one trainer. `booking_id` is null for such an inquiry room.
     */
    private function requireChatParticipant(int $roomId, array $user): array
    {
        $room = $this->database->fetchOne(
            'SELECT cr.id, b.id AS booking_id, b.public_id AS booking_public_id,
                    b.status AS booking_status,
                    COALESCE(b.member_user_id, cr.member_user_id) AS member_user_id,
                    tp.user_id AS trainer_user_id, tp.approval_status AS trainer_approval_status
             FROM chat_rooms cr
             LEFT JOIN bookings b ON b.id = cr.booking_id
             JOIN trainer_profiles tp ON tp.id = COALESCE(b.trainer_profile_id, cr.trainer_profile_id)
             WHERE cr.id = ?',
            [$roomId]
        );
        if (!$room) {
            throw new HttpException(404, 'ไม่พบห้องสนทนา', 'CHAT_NOT_FOUND');
        }
        $isMember = $user['role'] === 'member' && (int) $user['id'] === (int) $room['member_user_id'];
        $isTrainer = $user['role'] === 'trainer' && (int) $user['id'] === (int) $room['trainer_user_id'];
        if (!$isMember && !$isTrainer) {
            throw new HttpException(403, 'ไม่มีสิทธิ์เปิดห้องสนทนานี้', 'FORBIDDEN');
        }
        return $room;
    }

    /** Opens (or reopens) the member's inquiry room with a trainer. */
    public function openInquiryRoom(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['trainerId']);
        $trainerKey = Http::stringField($input, 'trainerId');
        $roomId = $this->database->transaction(function (PDO $pdo) use ($user, $trainerKey): int {
            $trainer = $pdo->prepare(
                'SELECT tp.id FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id
                 WHERE (tp.id = ? OR tp.slug = ?) AND tp.approval_status = "approved" AND u.status = "active"
                 FOR UPDATE'
            );
            $trainer->execute([ctype_digit($trainerKey) ? (int) $trainerKey : 0, $trainerKey]);
            $trainerProfileId = $trainer->fetchColumn();
            if ($trainerProfileId === false) {
                throw new HttpException(404, 'ไม่พบเทรนเนอร์', 'TRAINER_NOT_FOUND');
            }
            $existing = $pdo->prepare(
                'SELECT id FROM chat_rooms WHERE booking_id IS NULL AND member_user_id = ? AND trainer_profile_id = ? LIMIT 1'
            );
            $existing->execute([(int) $user['id'], (int) $trainerProfileId]);
            $found = $existing->fetchColumn();
            if ($found !== false) {
                return (int) $found;
            }
            $pdo->prepare('INSERT INTO chat_rooms (booking_id, member_user_id, trainer_profile_id) VALUES (NULL, ?, ?)')
                ->execute([(int) $user['id'], (int) $trainerProfileId]);
            return (int) $pdo->lastInsertId();
        });
        Http::json(['roomId' => $roomId, 'id' => 'CHAT-' . $roomId], 201);
    }

    /**
     * Inquiry rooms for the chat list, shaped like the booking rows the chat
     * screen already renders so both kinds of conversation share one list.
     */
    public function inquiryRooms(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $column = $user['role'] === 'member' ? 'cr.member_user_id' : 'tp.user_id';
        $rows = $this->database->fetchAll(
            'SELECT cr.id, cr.created_at, tp.id AS trainer_id, tp.user_id AS trainer_user_id, tp.slug, tp.image_path AS trainer_image_path,
                    trainer_user.display_name AS trainer_name,
                    cr.member_user_id, member_user.display_name AS member_name, mp.image_path AS member_image_path,
                    (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_room_id = cr.id) AS last_message_at
             FROM chat_rooms cr
             JOIN trainer_profiles tp ON tp.id = cr.trainer_profile_id
             JOIN users trainer_user ON trainer_user.id = tp.user_id
             JOIN users member_user ON member_user.id = cr.member_user_id
             LEFT JOIN member_profiles mp ON mp.user_id = cr.member_user_id
             WHERE cr.booking_id IS NULL AND ' . $column . ' = ?
             ORDER BY COALESCE(last_message_at, cr.created_at) DESC LIMIT 100',
            [(int) $user['id']]
        );
        Http::json(array_map(function (array $row): array {
            $activity = $this->iso($row['last_message_at'] ?? $row['created_at']);
            return [
                'id' => 'CHAT-' . (int) $row['id'],
                'inquiry' => true,
                'chatRoomId' => (int) $row['id'],
                'trainer' => [
                    'id' => (int) $row['trainer_id'],
                    'slug' => $row['slug'],
                    'displayName' => $row['trainer_name'],
                    'imageUrl' => self::accountImageUrl('trainer', (int) $row['trainer_user_id'], $row['trainer_image_path'] ?? null),
                ],
                'member' => [
                    'id' => (int) $row['member_user_id'],
                    'displayName' => $row['member_name'],
                    'imageUrl' => self::accountImageUrl('member', (int) $row['member_user_id'], $row['member_image_path'] ?? null),
                ],
                'startsAt' => $activity,
                'endsAt' => $activity,
                'createdAt' => $this->iso($row['created_at']),
                'status' => 'inquiry',
                'paymentStatus' => 'not_submitted',
                'actions' => [
                    'canPay' => false, 'canReadChat' => true, 'canSendChat' => true,
                    'canComplete' => false, 'canReview' => false, 'canCancel' => false,
                ],
            ];
        }, $rows));
    }
}
