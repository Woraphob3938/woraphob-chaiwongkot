<?php
declare(strict_types=1);

/** Sign-in, password reset, the account profile, profile images and notifications. Part of Handlers. */
trait AccountHandlers
{
    public function register(): never
    {
        $input = Http::body();
        $this->rateLimiter->hit(RateLimiter::REGISTER, RateLimiter::clientKey());
        Http::json($this->auth->register($input), 201);
    }

    public function login(): never
    {
        $input = Http::body();
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        // Counted per account and per address: the first stops a password guess
        // against one mailbox, the second stops a sweep across many.
        $this->rateLimiter->hit(RateLimiter::LOGIN, $account);
        $this->rateLimiter->hit(RateLimiter::LOGIN, RateLimiter::clientKey());
        $result = $this->auth->login($input);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
        // The address window is shared by everyone behind one network, so a
        // successful sign-in must give its attempt back too: otherwise ten
        // ordinary logins from one office lock every member of it out for fifteen
        // minutes. Failures still spend the window, which is what stops a sweep.
        $this->rateLimiter->clear(RateLimiter::LOGIN, RateLimiter::clientKey());
        Http::json($result);
    }

    public function forgotPassword(): never
    {
        $input = Http::body();
        Http::assertTextFields($input, ['email']);
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_REQUEST, $account);
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_REQUEST, RateLimiter::clientKey());

        $reset = $this->auth->requestPasswordReset($input);
        if ($reset !== null) {
            $this->mailPasswordResetCode($reset['email'], $reset['displayName'], $reset['code']);
        }

        // The same answer whether or not the address has an account.
        Http::json(['message' => PasswordResetRules::genericRequestMessage()]);
    }

    public function resetPassword(): never
    {
        $input = Http::body();
        Http::assertTextFields($input, ['email', 'code', 'newPassword']);
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_CONFIRM, $account);
        $result = $this->auth->resetPassword($input);
        $this->rateLimiter->clear(RateLimiter::PASSWORD_RESET_CONFIRM, $account);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
        Http::json($result);
    }

    public function logout(): never
    {
        $this->auth->logout();
        Http::json(['loggedOut' => true]);
    }

    public function me(): never
    {
        Http::json($this->auth->requireUser());
    }

    public function profile(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        Http::json($this->accountProfilePayload($user));
    }

    public function updateProfile(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $request = Http::body();
        // ProfileRules reads these as text; a list sent for one of them would be
        // cast to the literal "Array" and saved. `trainingTypeIds` is the one
        // profile field that is meant to be an array, so it is not listed.
        Http::assertTextFields($request, [
            'firstName', 'lastName', 'phone', 'fitnessGoal', 'experienceLevel', 'weight', 'height', 'birthDate',
            'displayName', 'legalName', 'nickname', 'headline', 'bio', 'serviceMode', 'gymName', 'education',
            'yearsExperience', 'priceFrom', 'monthlyPrice',
            'monthlySessionCount',
        ]);

        if ($user['role'] === 'member') {
            $stored = $this->database->fetchOne(
                'SELECT u.display_name, mp.first_name, mp.last_name, mp.phone, mp.goals, mp.experience_level,
                        mp.weight, mp.height, mp.birth_date
                 FROM users u JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$stored) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สมาชิก', 'PROFILE_NOT_FOUND');
            }
            $storedFirstName = trim((string) ($stored['first_name'] ?? ''));
            // Members registered before member_profiles carried a name keep theirs
            // only in users.display_name, so the form shows that fallback; merging
            // it back keeps a save that omits the names working like the form.
            $input = self::mergeProfileInput($request, [
                'firstName' => $storedFirstName === '' ? (string) $stored['display_name'] : $storedFirstName,
                'lastName' => $stored['last_name'] ?? '',
                'phone' => $stored['phone'] ?? '',
                'fitnessGoal' => $stored['goals'] ?? '',
                'experienceLevel' => $stored['experience_level'] ?? '',
                'weight' => $stored['weight'],
                'height' => $stored['height'],
                'birthDate' => $stored['birth_date'],
            ]);
            $profile = ProfileRules::member($input);
            $displayName = trim($profile['firstName'] . ' ' . $profile['lastName']);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile, $displayName): void {
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$displayName, $user['id']]);
                $pdo->prepare(
                    'UPDATE member_profiles
                     SET first_name = ?, last_name = ?, phone = ?, goals = ?, experience_level = ?,
                         weight = ?, height = ?, birth_date = ?, updated_at = UTC_TIMESTAMP()
                     WHERE user_id = ?'
                )->execute([
                    $profile['firstName'], $profile['lastName'], self::blankToNull($profile['phone']),
                    self::blankToNull($profile['fitnessGoal']), self::blankToNull($profile['experienceLevel']),
                    $profile['weight'], $profile['height'], $profile['birthDate'], $user['id'],
                ]);
            });
        } else {
            $stored = $this->database->fetchOne(
                'SELECT tp.id, tp.legal_name, tp.nickname, tp.phone, tp.birth_date, tp.education, tp.headline, tp.bio,
                        tp.years_experience, tp.service_mode, tp.gym_name, tp.price_from, tp.monthly_price,
                        tp.monthly_session_count, u.display_name
                 FROM users u JOIN trainer_profiles tp ON tp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$stored) {
                throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนแก้โปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
            }
            $storedTypes = $this->database->fetchAll(
                'SELECT training_type_id FROM trainer_training_types WHERE trainer_profile_id = ? ORDER BY training_type_id',
                [(int) $stored['id']]
            );
            $input = self::mergeProfileInput($request, [
                'displayName' => (string) $stored['display_name'],
                'legalName' => $stored['legal_name'] ?? '',
                'nickname' => $stored['nickname'] ?? '',
                'phone' => $stored['phone'] ?? '',
                'birthDate' => $stored['birth_date'],
                'education' => $stored['education'] ?? '',
                'headline' => $stored['headline'] ?? '',
                'bio' => $stored['bio'] ?? '',
                'yearsExperience' => $stored['years_experience'],
                'serviceMode' => $stored['service_mode'],
                'gymName' => $stored['gym_name'] ?? '',
                'priceFrom' => $stored['price_from'],
                'monthlyPrice' => $stored['monthly_price'],
                'monthlySessionCount' => $stored['monthly_session_count'],
                'trainingTypeIds' => array_map(
                    fn(array $row): int => (int) $row['training_type_id'],
                    $storedTypes
                ),
            ]);
            $profile = ProfileRules::trainer($input);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile): void {
                $trainerProfile = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE', [$user['id']]);
                if (!$trainerProfile) {
                    throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนแก้โปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
                }

                $typeIds = $profile['trainingTypeIds'];
                $this->assertActiveTrainingTypes($typeIds);

                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$profile['displayName'], $user['id']]);
                $pdo->prepare(
                    'UPDATE trainer_profiles
                     SET legal_name = ?, nickname = ?, phone = ?, birth_date = ?, education = ?, headline = ?, bio = ?, years_experience = ?,
                         service_mode = ?, gym_name = ?, price_from = ?, monthly_price = ?, monthly_session_count = ?,
                         updated_at = UTC_TIMESTAMP()
                     WHERE id = ?'
                )->execute([
                    $profile['legalName'], self::blankToNull($profile['nickname']), self::blankToNull($profile['phone']), $profile['birthDate'],
                    self::blankToNull($profile['education']), self::blankToNull($profile['headline']),
                    self::blankToNull($profile['bio']), $profile['yearsExperience'], $profile['serviceMode'],
                    $profile['serviceMode'] === 'freelance' ? null : $profile['gymName'], $profile['priceFrom'],
                    $profile['monthlyPrice'], $profile['monthlySessionCount'],
                    (int) $trainerProfile['id'],
                ]);
                $this->replaceTrainingTypes($pdo, (int) $trainerProfile['id'], $typeIds);
            });
        }

        Http::json($this->accountProfilePayload(['id' => $user['id'], 'role' => $user['role']]));
    }

    /**
     * PATCH is a partial update: the keys the request carries win, every other
     * field keeps the stored value. Replacing the whole row meant a client that
     * omitted an optional field — a phone number, a headline — silently wiped it,
     * which is not what an omitted field means in a PATCH.
     */
    private static function mergeProfileInput(array $request, array $stored): array
    {
        foreach ($request as $field => $value) {
            if (array_key_exists($field, $stored)) {
                $stored[$field] = $value;
            }
        }
        return $stored;
    }

    public function deleteOwnAccount(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $this->rateLimiter->hit(RateLimiter::ACCOUNT_DELETE, 'user:' . $user['id']);
        $input = Http::body();
        Http::requireFields($input, ['currentPassword', 'confirmation']);
        if (Http::stringField($input, 'confirmation') !== 'ลบบัญชี') {
            throw new HttpException(422, 'กรุณาพิมพ์ “ลบบัญชี” เพื่อยืนยัน', 'VALIDATION_FAILED', [
                'confirmation' => 'พิมพ์ ลบบัญชี ให้ตรงตามที่กำหนด',
            ]);
        }

        $this->database->transaction(function (PDO $pdo) use ($user, $input): void {
            $account = $this->database->fetchOne('SELECT password_hash FROM users WHERE id = ? AND status = "active" FOR UPDATE', [$user['id']]);
            if (!$account || !password_verify(Http::stringField($input, 'currentPassword'), $account['password_hash'])) {
                throw new HttpException(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'INVALID_CREDENTIALS', [
                    'currentPassword' => 'ตรวจสอบรหัสผ่านแล้วลองอีกครั้ง',
                ]);
            }

            // Keep booking and payment history for system records, but revoke every session.
            // The address is released so the person can register with it again.
            $pdo->prepare('UPDATE users SET status = "deleted", email = CONCAT("deleted-", id, "@deleted.invalid"), updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$user['id']]);
            $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')
                ->execute([$user['id']]);
        });

        Http::json(['deleted' => true]);
    }

    public function uploadProfileImage(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $this->rateLimiter->hit(RateLimiter::PROFILE_IMAGE, 'user:' . $user['id']);
        $upload = $this->saveImageUpload('profile-images');
        try {
            $oldPath = $this->swapProfileImage($user, $upload['path']);
        } catch (Throwable $error) {
            $this->removeUpload($upload['path']);
            throw $error;
        }
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json(['imageUrl' => '/v1/profile-images/' . $user['role'] . '/' . $user['id']]);
    }

    /** An uploaded picture; size and type problems are reported against the `image` field. */
    private function saveImageUpload(string $directory): array
    {
        try {
            return $this->saveUpload('image', ['image/jpeg', 'image/png', 'image/webp'], 5 * 1024 * 1024, $directory);
        } catch (HttpException $error) {
            if (in_array($error->status, [413, 415], true)) {
                throw new HttpException(422, $error->getMessage(), 'VALIDATION_FAILED', ['image' => $error->getMessage()]);
            }
            throw $error;
        }
    }

    /** Stores the caller's profile picture path (null removes it) and returns the one it replaced. */
    private function swapProfileImage(array $user, ?string $path): ?string
    {
        $table = $user['role'] === 'member' ? 'member_profiles' : 'trainer_profiles';
        return $this->database->transaction(function (PDO $pdo) use ($user, $path, $table): ?string {
            $row = $this->database->fetchOne("SELECT image_path FROM {$table} WHERE user_id = ? FOR UPDATE", [$user['id']]);
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์', 'PROFILE_NOT_FOUND');
            }
            $pdo->prepare("UPDATE {$table} SET image_path = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?")
                ->execute([$path, $user['id']]);
            return $row['image_path'];
        });
    }

    public function notifications(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $page = NotificationService::parsePage($_GET['page'] ?? '0');
        $category = NotificationService::parseCategory($_GET['category'] ?? 'all');
        $unread = NotificationService::parseUnread($_GET['unread'] ?? 'false');
        $query = NotificationService::parseQuery($_GET['q'] ?? '');
        Http::json($this->notifications->listForUser((int) $user['id'], $page, $category, $unread, $query));
    }

    public function notification(string $notificationId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $detail = $this->notifications->detailForUser((int) $user['id'], (int) $notificationId);
        if ($detail === null) {
            throw new HttpException(404, 'ไม่พบการแจ้งเตือน', 'NOTIFICATION_NOT_FOUND');
        }
        Http::json($detail);
    }

    public function readNotification(string $notificationId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        if (!$this->notifications->markRead((int) $user['id'], (int) $notificationId)) {
            throw new HttpException(404, 'ไม่พบการแจ้งเตือน', 'NOTIFICATION_NOT_FOUND');
        }
        Http::json(['id' => (int) $notificationId, 'read' => true]);
    }

    public function readAllNotifications(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        Http::json(['updated' => $this->notifications->markAllRead((int) $user['id'])]);
    }

    public function deleteProfileImage(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $oldPath = $this->swapProfileImage($user, null);
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json(['imageUrl' => null]);
    }

    public function changeProfilePassword(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $input = Http::body();
        // A wrong current password is a credential guess, so it is still counted
        // — but against the account, never against the LOGIN address bucket that
        // every other member behind the same network shares. Ten typos here used
        // to lock the whole network out of signing in. On success only this
        // account key is cleared, exactly as a sign-in clears its own.
        $account = RateLimiter::accountKey((string) $user['email']);
        $this->rateLimiter->hit(RateLimiter::LOGIN, $account);
        $result = $this->auth->changePassword($input);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
        Http::json($result);
    }

    /**
     * The reset code goes out through the same Gmail transport as notifications.
     * A mail failure must not change the answer to the caller, who has no way to
     * act on it and should not learn whether the address exists.
     */
    private function mailPasswordResetCode(string $email, string $displayName, string $code): void
    {
        $mailer = new GmailMailer($this->config['mail'] ?? []);
        if (!$mailer->isEnabled()) {
            return;
        }
        try {
            $mailer->send(
                $email,
                $displayName,
                'รหัสตั้งรหัสผ่านใหม่ FitConnect',
                'สวัสดี ' . $displayName . PHP_EOL . PHP_EOL
                    . 'รหัสสำหรับตั้งรหัสผ่านใหม่คือ ' . $code . PHP_EOL
                    . 'รหัสนี้ใช้ได้ ' . PasswordResetRules::CODE_TTL_MINUTES . ' นาที และใช้ได้ครั้งเดียว' . PHP_EOL . PHP_EOL
                    . 'ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้งานได้ตามปกติ',
                '/reset-password'
            );
        } catch (Throwable $error) {
            error_log('[fitconnect] password reset mail failed: ' . $error->getMessage());
        }
    }

    public function profileImage(string $role, string $userId): never
    {
        if (!in_array($role, ['member', 'trainer'], true) || (int) $userId <= 0) {
            throw new HttpException(404, 'ไม่พบรูปโปรไฟล์', 'PROFILE_IMAGE_NOT_FOUND');
        }
        $table = $role === 'member' ? 'member_profiles' : 'trainer_profiles';
        $record = $this->database->fetchOne(
            "SELECT image_path FROM {$table} WHERE user_id = ?",
            [(int) $userId]
        );
        if (!$record || !str_starts_with((string) ($record['image_path'] ?? ''), 'uploads/profile-images/')) {
            throw new HttpException(404, 'ไม่พบรูปโปรไฟล์', 'PROFILE_IMAGE_NOT_FOUND');
        }

        $this->serveUploadedImage((string) $record['image_path'], 'profile-images', 'fitconnect-profile-' . $role . '-' . (int) $userId, true);
    }

    private function accountProfilePayload(array $user): array
    {
        if ($user['role'] === 'member') {
            $row = $this->database->fetchOne(
                'SELECT u.display_name, u.email, mp.first_name, mp.last_name, mp.phone, mp.goals,
                        mp.experience_level, mp.weight, mp.height, mp.birth_date, mp.image_path
                 FROM users u JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สมาชิก', 'PROFILE_NOT_FOUND');
            }
            $firstName = trim((string) ($row['first_name'] ?? ''));
            // Members registered before member_profiles carried a name have theirs
            // only in users.display_name, so the first name falls back to it. The
            // flag marks that fallback: an editing form must not present it as
            // stored input, or the next save fails the surname rule instead.
            $nameFromDisplayName = $firstName === '';
            return [
                'role' => 'member',
                'user' => ['displayName' => $row['display_name'], 'email' => $row['email']],
                'imageUrl' => self::accountImageUrl('member', (int) $user['id'], $row['image_path']),
                'member' => [
                    'nameFromDisplayName' => $nameFromDisplayName,
                    'firstName' => $nameFromDisplayName ? $row['display_name'] : $firstName,
                    'lastName' => $row['last_name'] ?? '',
                    'phone' => $row['phone'] ?? '',
                    'fitnessGoal' => $row['goals'] ?? '',
                    'experienceLevel' => $row['experience_level'] ?? '',
                    'weight' => $row['weight'] === null ? null : (float) $row['weight'],
                    'height' => $row['height'] === null ? null : (float) $row['height'],
                    'birthDate' => $row['birth_date'] ?? null,
                ],
            ];
        }

        $row = $this->database->fetchOne(
            'SELECT u.display_name, u.email, tp.id, tp.legal_name, tp.nickname, tp.phone, tp.birth_date, tp.education, tp.headline, tp.bio,
                    tp.years_experience, tp.service_mode, tp.gym_name, tp.price_from, tp.monthly_price,
                    tp.monthly_session_count, tp.image_path,
                    tp.approval_status, tp.approval_note
             FROM users u JOIN trainer_profiles tp ON tp.user_id = u.id WHERE u.id = ?',
            [$user['id']]
        );
        if (!$row) {
            throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนเปิดโปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
        }
        $profileId = (int) $row['id'];
        $types = $this->database->fetchAll(
            'SELECT training_type_id FROM trainer_training_types WHERE trainer_profile_id = ? ORDER BY training_type_id',
            [$profileId]
        );
        $certificates = $this->database->fetchAll(
            'SELECT id, name, issuer, issued_year, status FROM trainer_certificates
             WHERE trainer_profile_id = ? ORDER BY id DESC',
            [$profileId]
        );

        return [
            'role' => 'trainer',
            'user' => ['displayName' => $row['display_name'], 'email' => $row['email']],
            'imageUrl' => self::accountImageUrl('trainer', (int) $user['id'], $row['image_path']),
            'trainer' => [
                'legalName' => $row['legal_name'] ?? '',
                'nickname' => $row['nickname'] ?? '',
                'phone' => $row['phone'] ?? '',
                'birthDate' => $row['birth_date'] ?? null,
                'education' => $row['education'] ?? null,
                'headline' => $row['headline'] ?? '',
                'bio' => $row['bio'] ?? '',
                'yearsExperience' => (int) $row['years_experience'],
                'serviceMode' => $row['service_mode'],
                'gymName' => $row['gym_name'],
                'priceFrom' => $row['price_from'] === null ? null : (float) $row['price_from'],
                'monthlyPrice' => $row['monthly_price'] === null ? null : (float) $row['monthly_price'],
                'monthlySessionCount' => $row['monthly_session_count'] === null ? null : (int) $row['monthly_session_count'],
                'trainingTypeIds' => array_map(fn(array $type): int => (int) $type['training_type_id'], $types),
                'approvalStatus' => $row['approval_status'],
                'approvalNote' => $row['approval_note'],
                'certificates' => array_map(self::certificatePayload(...), $certificates),
            ],
        ];
    }

    private static function accountImageUrl(string $role, int $userId, mixed $path): ?string
    {
        if ($path === null || trim((string) $path) === '') return null;
        $path = (string) $path;
        if (str_starts_with($path, 'uploads/profile-images/')) {
            return "/v1/profile-images/{$role}/{$userId}";
        }
        return $path;
    }
}
