<?php
declare(strict_types=1);

/** Stripe Checkout, the webhook, trainer payout accounts, refunds and legacy payment routing. Part of Handlers. */
trait PaymentHandlers
{
    /**
     * Starts (or resumes) Stripe Checkout for a booking waiting for payment and
     * answers the hosted payment page URL. Replaces the bank-slip upload.
     */
    public function payment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $this->rateLimiter->hit(RateLimiter::PAYMENT_SLIP, 'user:' . $user['id']);
        $stripe = $this->stripe();
        $publicId = Http::stringField($input, 'bookingId');
        $notificationIds = [];

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $user, $stripe, &$notificationIds): array {
                $booking = $this->database->fetchOne(
                'SELECT b.id, b.public_id, b.status, b.availability_slot_id, b.payment_deadline_at, b.quoted_price,
                        b.booking_type, b.payment_service_mode, u.email AS member_email,
                        tp.id AS trainer_profile_id, tp.stripe_account_id, tp.stripe_transfers_enabled,
                        trainer_user.display_name AS trainer_name,
                        UTC_TIMESTAMP() AS database_now
                 FROM bookings b
                 JOIN users u ON u.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 WHERE b.public_id = ? AND b.member_user_id = ? FOR UPDATE',
                [$publicId, $user['id']]
            );
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }
            if ($booking['status'] !== 'awaiting_payment' || $booking['payment_deadline_at'] === null) {
                throw new HttpException(409, 'คำขอนี้ยังไม่อยู่ในขั้นชำระเงิน', 'PAYMENT_NOT_READY');
            }
            $deadline = self::utc((string) $booking['payment_deadline_at']);
            $databaseNow = self::utc((string) $booking['database_now']);
            if (WorkflowRules::isPaymentDeadlineExpired($deadline, $databaseNow)) {
                $slotId = $booking['availability_slot_id'] === null ? null : (int) $booking['availability_slot_id'];
                $this->expireAwaitingPaymentsInTransaction($pdo, $slotId, $notificationIds);
                return ['expired' => true];
            }
            if ($booking['quoted_price'] === null) {
                throw new HttpException(409, 'การจองนี้ยังไม่มียอดชำระ', 'PAYMENT_AMOUNT_UNAVAILABLE');
            }

            // A member who comes back to the page resumes the session already open.
            $existing = $this->database->fetchOne(
                'SELECT id, stripe_checkout_session_id, stripe_destination_account FROM payments
                 WHERE booking_id = ? AND status = "pending" AND stripe_checkout_session_id IS NOT NULL
                 ORDER BY id DESC LIMIT 1',
                [$booking['id']]
            );
            if ($existing) {
                $session = $stripe->get(
                    '/v1/checkout/sessions/' . rawurlencode((string) $existing['stripe_checkout_session_id']),
                    [],
                    $existing['stripe_destination_account']
                );
                $outcome = StripePayments::sessionOutcome($session);
                if ($outcome === 'open' && !empty($session['url'])) {
                    return ['expired' => false, 'url' => (string) $session['url']];
                }
                if ($outcome === 'paid') {
                    return ['expired' => false, 'url' => null, 'alreadyPaid' => true];
                }
                $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "ปิดหน้าชำระเงินก่อนชำระสำเร็จ" WHERE id = ?')
                    ->execute([$existing['id']]);
            }

            $destination = null;
            if ($booking['payment_service_mode'] === 'freelance') {
                $destination = $this->readyStripeAccount($pdo, $booking);
            }
            $amount = StripePayments::toSatang($booking['quoted_price']);
            $fee = $destination === null ? 0 : StripePayments::applicationFee(
                $amount,
                (float) ($this->config['stripe']['platform_fee_percent'] ?? 0)
            );
            $appUrl = (string) $this->config['app_url'];
            $bookingParam = rawurlencode((string) $booking['public_id']);
            $params = StripePayments::checkoutSessionParams([
                'publicId' => (string) $booking['public_id'],
                'amountSatang' => $amount,
                'description' => ($booking['booking_type'] === 'monthly' ? 'แพ็กเกจรายเดือนกับ ' : 'ค่าฝึกกับ ')
                    . $booking['trainer_name'] . ' (' . $booking['public_id'] . ')',
                'memberEmail' => $booking['member_email'] ?? null,
                'serviceMode' => (string) $booking['payment_service_mode'],
                'destination' => $destination,
                'feeSatang' => $fee,
                'successUrl' => $appUrl . '/member?booking=' . $bookingParam . '&checkout=success',
                'cancelUrl' => $appUrl . '/member?booking=' . $bookingParam . '&checkout=cancelled',
                // The booking's own ten minutes still rule: the expiry sweep closes
                // the session, and a payment that lands late is refunded.
                'expiresAt' => time() + StripePayments::MINIMUM_SESSION_MINUTES * 60 + 60,
            ]);
            // A freelance session is a direct charge on the trainer's account.
            $session = $stripe->post('/v1/checkout/sessions', $params, 'checkout-' . $booking['public_id'] . '-' . bin2hex(random_bytes(6)), $destination);
            $pdo->prepare(
                'INSERT INTO payments (booking_id, submitted_by_user_id, amount, window_ends_at, stripe_checkout_session_id,
                                       stripe_destination_account, application_fee, status, submitted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, "pending", UTC_TIMESTAMP())'
            )->execute([
                $booking['id'], $user['id'], number_format($amount / 100, 2, '.', ''), $booking['payment_deadline_at'],
                $session['id'], $destination, $fee === 0 ? null : number_format($fee / 100, 2, '.', ''),
            ]);
            return ['expired' => false, 'url' => (string) $session['url']];
        });
        $this->notifications->deliverByIds($notificationIds);
        if ($result['expired']) {
            throw new HttpException(409, 'หมดเวลาชำระเงิน กรุณาเลือกเวลาใหม่', 'PAYMENT_DEADLINE_EXPIRED');
        }
        if (!empty($result['alreadyPaid'])) {
            $this->syncBookingCheckout($publicId, (int) $user['id']);
            throw new HttpException(409, 'การจองนี้ชำระเงินแล้ว', 'PAYMENT_ALREADY_COMPLETED');
        }
        Http::json(['bookingId' => $publicId, 'checkoutUrl' => $result['url']], 201);
    }

    /**
     * The member lands back from Checkout. Asks Stripe for the session instead
     * of waiting for the webhook, so a local setup without a public webhook URL
     * still confirms the booking.
     */
    public function confirmPayment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $publicId = Http::stringField($input, 'bookingId');
        $outcome = $this->syncBookingCheckout($publicId, (int) $user['id']);
        Http::json(['bookingId' => $publicId, 'outcome' => $outcome]);
    }

    /** Stripe webhook: Checkout Session outcomes and connected account updates. */
    public function stripeWebhook(): never
    {
        $payload = (string) file_get_contents('php://input');
        $event = $this->stripe()->verifyWebhook($payload, (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? ''));
        $eventId = (string) ($event['id'] ?? '');
        $type = (string) $event['type'];
        $object = is_array($event['data']['object'] ?? null) ? $event['data']['object'] : [];

        if ($this->database->fetchOne('SELECT id FROM stripe_events WHERE id = ?', [$eventId])) {
            Http::json(['received' => true, 'duplicate' => true]);
        }
        if (str_starts_with($type, 'checkout.session.') && isset($object['id'])) {
            // The event body can be stale; the session is read back from Stripe.
            // Freelance sessions live on the trainer's account (event.account).
            $account = isset($event['account']) ? (string) $event['account'] : null;
            $this->applyCheckoutSession(
                $this->stripe()->get('/v1/checkout/sessions/' . rawurlencode((string) $object['id']), [], $account),
                $account
            );
        }
        $this->database->execute('INSERT IGNORE INTO stripe_events (id, type) VALUES (?, ?)', [$eventId, $type]);
        Http::json(['received' => true]);
    }

    /** The trainer's Stripe payout status for the money tab. */
    public function trainerStripeStatus(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profile = $this->database->fetchOne(
            'SELECT id, stripe_account_id, stripe_transfers_enabled FROM trainer_profiles WHERE user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        $enabled = (bool) $profile['stripe_transfers_enabled'];
        if ($profile['stripe_account_id'] !== null && $this->stripe()->enabled()) {
            $enabled = StripePayments::chargesEnabled($this->connectedAccount((string) $profile['stripe_account_id']));
            $this->database->execute('UPDATE trainer_profiles SET stripe_transfers_enabled = ? WHERE id = ?', [$enabled ? 1 : 0, $profile['id']]);
        }
        Http::json([
            'configured' => $this->stripe()->enabled(),
            'testMode' => $this->stripe()->testMode(),
            'connected' => $profile['stripe_account_id'] !== null,
            'payoutsReady' => $enabled,
        ]);
    }

    /**
     * Creates the trainer's connected account on first use and answers a
     * Stripe-hosted onboarding link. Thai platforms cannot carry connected
     * account losses, so the account takes its own charges (direct charges)
     * with Stripe owning risk and the full Stripe Dashboard.
     */
    public function trainerStripeOnboarding(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $stripe = $this->stripe();
        $profile = $this->database->fetchOne(
            'SELECT tp.id, tp.stripe_account_id, u.email, u.display_name
             FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        $accountId = $profile['stripe_account_id'];
        if ($accountId === null) {
            $account = $stripe->postV2('/v2/core/accounts', StripePayments::connectedAccountBody(
                (string) $profile['email'],
                (string) $profile['display_name'],
                (int) $profile['id']
            ), 'trainer-account-v2-' . $profile['id']);
            $accountId = (string) $account['id'];
            $this->database->execute(
                'UPDATE trainer_profiles SET stripe_account_id = ? WHERE id = ? AND stripe_account_id IS NULL',
                [$accountId, $profile['id']]
            );
        }
        $appUrl = (string) $this->config['app_url'];
        $link = $stripe->postV2('/v2/core/account_links', [
            'account' => $accountId,
            'use_case' => [
                'type' => 'account_onboarding',
                'account_onboarding' => [
                    'configurations' => ['merchant'],
                    'refresh_url' => $appUrl . '/trainer?stripe=refresh',
                    'return_url' => $appUrl . '/trainer?stripe=return',
                ],
            ],
        ]);
        Http::json(['url' => (string) $link['url']], 201);
    }

    /** The trainer signs in to their own full Stripe Dashboard. */
    public function trainerStripeDashboard(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profile = $this->database->fetchOne('SELECT stripe_account_id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
        if (!$profile || $profile['stripe_account_id'] === null) {
            throw new HttpException(409, 'ยังไม่ได้เชื่อมบัญชีรับเงิน', 'TRAINER_PAYOUTS_NOT_READY');
        }
        Http::json(['url' => 'https://dashboard.stripe.com/' . rawurlencode((string) $profile['stripe_account_id'])], 201);
    }

    private function connectedAccount(string $accountId): array
    {
        return $this->stripe()->getV2('/v2/core/accounts/' . rawurlencode($accountId), ['include' => 'configuration.merchant']);
    }

    private function stripe(): StripeClient
    {
        return $this->stripeClient ??= new StripeClient(
            (string) ($this->config['stripe']['secret_key'] ?? ''),
            (string) ($this->config['stripe']['webhook_secret'] ?? '')
        );
    }

    /** The freelance trainer's connected account, refreshed from Stripe when not yet marked ready. */
    private function readyStripeAccount(PDO $pdo, array $booking): string
    {
        $accountId = $booking['stripe_account_id'];
        if ($accountId === null) {
            throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้เปิดรับเงินออนไลน์ กรุณาติดต่อเทรนเนอร์ผ่านแชท', 'TRAINER_PAYOUTS_NOT_READY');
        }
        if (!(bool) $booking['stripe_transfers_enabled']) {
            if (!StripePayments::chargesEnabled($this->connectedAccount((string) $accountId))) {
                throw new HttpException(409, 'บัญชีรับเงินของเทรนเนอร์ยังยืนยันตัวตนไม่เสร็จ กรุณาติดต่อเทรนเนอร์ผ่านแชท', 'TRAINER_PAYOUTS_NOT_READY');
            }
            $pdo->prepare('UPDATE trainer_profiles SET stripe_transfers_enabled = 1 WHERE id = ?')->execute([$booking['trainer_profile_id']]);
        }
        return (string) $accountId;
    }

    /** Reads the booking's latest Checkout Session from Stripe and applies it. */
    private function syncBookingCheckout(string $publicId, int $memberUserId): string
    {
        $row = $this->database->fetchOne(
            'SELECT pay.stripe_checkout_session_id, pay.stripe_destination_account FROM payments pay JOIN bookings b ON b.id = pay.booking_id
             WHERE b.public_id = ? AND b.member_user_id = ? AND pay.stripe_checkout_session_id IS NOT NULL
             ORDER BY pay.id DESC LIMIT 1',
            [$publicId, $memberUserId]
        );
        if (!$row) {
            throw new HttpException(404, 'ไม่พบรายการชำระเงินของการจองนี้', 'PAYMENT_NOT_FOUND');
        }
        $account = $row['stripe_destination_account'];
        $session = $this->stripe()->get('/v1/checkout/sessions/' . rawurlencode((string) $row['stripe_checkout_session_id']), [], $account);
        return $this->applyCheckoutSession($session, $account);
    }

    /**
     * The single place a Checkout Session changes a booking. Safe to run more
     * than once for the same session (webhook redelivery, return page reload).
     * A payment for a booking that no longer waits for one (expired or
     * cancelled meanwhile) is refunded in full.
     */
    private function applyCheckoutSession(array $session, ?string $account = null): string
    {
        $outcome = StripePayments::sessionOutcome($session);
        $notificationIds = [];
        $this->database->transaction(function (PDO $pdo) use ($session, $outcome, $account, &$notificationIds): void {
            $payment = $this->database->fetchOne(
                'SELECT pay.id, pay.status, pay.booking_id, pay.stripe_destination_account,
                        b.status AS booking_status, b.availability_slot_id
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                 WHERE pay.stripe_checkout_session_id = ? FOR UPDATE',
                [(string) ($session['id'] ?? '')]
            );
            if (!$payment || in_array($payment['status'], ['approved', 'refunded'], true) || $outcome === 'open') {
                return;
            }
            if ($outcome === 'closed') {
                $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "ไม่ได้ชำระเงินในหน้าชำระเงิน", reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = "pending"')
                    ->execute([$payment['id']]);
                return;
            }
            $paymentIntent = is_array($session['payment_intent'] ?? null)
                ? (string) ($session['payment_intent']['id'] ?? '')
                : (string) ($session['payment_intent'] ?? '');

            if ($payment['booking_status'] !== 'awaiting_payment') {
                // Paid after the window closed or after a cancellation.
                $chargeAccount = $payment['stripe_destination_account'] ?? $account;
                $refund = StripePayments::refundParams($paymentIntent, $chargeAccount !== null, 'booking_not_awaiting_payment');
                $this->stripe()->post('/v1/refunds', $refund, 'refund-' . md5(StripeClient::encode($refund)), $chargeAccount);
                $pdo->prepare('UPDATE payments SET status = "refunded", stripe_payment_intent_id = ?, refunded_at = UTC_TIMESTAMP(), review_note = "ชำระหลังหมดเวลาหรือหลังยกเลิก ระบบคืนเงินอัตโนมัติ", reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$paymentIntent, $payment['id']]);
                $this->history($pdo, $payment['booking_id'], $payment['booking_status'], $payment['booking_status'], null, 'ชำระเงินหลังการจองปิดแล้ว ระบบคืนเงินอัตโนมัติ');
                return;
            }

            $pdo->prepare('UPDATE payments SET status = "approved", stripe_payment_intent_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$paymentIntent, $payment['id']]);
            $pdo->prepare('UPDATE bookings SET status = "confirmed", payment_status = "approved", payment_deadline_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$payment['booking_id']]);
            $this->history($pdo, $payment['booking_id'], 'awaiting_payment', 'confirmed', null, 'ชำระเงินออนไลน์สำเร็จ');
            $this->setBookingSlotsState($pdo, (int) $payment['booking_id'], $payment['availability_slot_id'], 'booked');
            $this->notify($pdo, $notificationIds, NotificationRules::PAYMENT_APPROVED, $this->bookingNotificationContext($pdo, (int) $payment['booking_id'], 'awaiting_payment', 'confirmed'));
        });
        $this->notifications->deliverByIds($notificationIds);
        return $outcome;
    }

    /**
     * Closes Checkout Sessions whose booking stopped waiting for payment. Best effort.
     *
     * @param list<array{0: string, 1: ?string}> $sessions session id and the account it lives on
     */
    private function expireCheckoutSessions(array $sessions): void
    {
        if ($sessions === [] || !$this->stripe()->enabled()) {
            return;
        }
        foreach ($sessions as [$sessionId, $account]) {
            try {
                $this->stripe()->post('/v1/checkout/sessions/' . rawurlencode($sessionId) . '/expire', [], null, $account);
            } catch (HttpException) {
                // Already paid or already closed; applyCheckoutSession settles either.
            }
        }
    }

    /** Open Checkout Sessions of one booking, closed in the database as the booking closes. */
    private function closePendingCheckoutsInTransaction(PDO $pdo, int $bookingId): array
    {
        $statement = $pdo->prepare(
            'SELECT stripe_checkout_session_id, stripe_destination_account FROM payments
             WHERE booking_id = ? AND status = "pending" AND stripe_checkout_session_id IS NOT NULL FOR UPDATE'
        );
        $statement->execute([$bookingId]);
        $ids = array_map(
            static fn(array $row): array => [(string) $row['stripe_checkout_session_id'], $row['stripe_destination_account']],
            $statement->fetchAll()
        );
        $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "การจองปิดก่อนชำระเงิน", reviewed_at = UTC_TIMESTAMP() WHERE booking_id = ? AND status = "pending"')
            ->execute([$bookingId]);
        return $ids;
    }

    /** Refunds the booking's Stripe payment in full, reversing the trainer's transfer. */
    private function refundBookingPaymentInTransaction(PDO $pdo, int $bookingId, string $reason): bool
    {
        $statement = $pdo->prepare(
            'SELECT id, stripe_payment_intent_id, stripe_destination_account FROM payments
             WHERE booking_id = ? AND status = "approved" AND stripe_payment_intent_id IS NOT NULL FOR UPDATE'
        );
        $statement->execute([$bookingId]);
        $refunded = false;
        foreach ($statement->fetchAll() as $payment) {
            $refund = StripePayments::refundParams(
                (string) $payment['stripe_payment_intent_id'],
                $payment['stripe_destination_account'] !== null,
                'booking_cancelled'
            );
            // The key carries the parameters, so a corrected retry is not
            // answered with an earlier refused request.
            $this->stripe()->post(
                '/v1/refunds',
                $refund,
                'refund-' . md5(StripeClient::encode($refund)),
                $payment['stripe_destination_account']
            );
            $pdo->prepare('UPDATE payments SET status = "refunded", refunded_at = UTC_TIMESTAMP(), review_note = ? WHERE id = ?')
                ->execute([mb_substr('คืนเงินเพราะยกเลิกการจอง: ' . $reason, 0, 1000), $payment['id']]);
            $refunded = true;
        }
        return $refunded;
    }

    public function paymentRouting(): never
    {
        $this->requireAdminPermission('manage_users');
        $this->requireAdminPermission('review_payments');
        Http::json([
            'unresolved' => $this->database->fetchAll('SELECT b.public_id AS id, u.display_name AS trainerName
                FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id JOIN users u ON u.id = tp.user_id
                WHERE b.payment_service_mode IS NULL
                ORDER BY b.created_at DESC'),
        ]);
    }

    public function savePaymentRouting(): never
    {
        $this->requireAdminPermission('manage_users');
        $this->requireAdminPermission('review_payments');
        $input = Http::body();
        $this->database->transaction(function (PDO $pdo) use ($input): void {
            if (isset($input['bookingId'])) {
                $booking = $this->database->fetchOne('SELECT b.id, b.payment_service_mode
                    FROM bookings b WHERE b.public_id = ? FOR UPDATE',
                    [Http::stringField($input, 'bookingId')]
                );
                if (!$booking || $booking['payment_service_mode'] !== null) {
                    throw new HttpException(409, 'การจองนี้กำหนดผู้รับผิดชอบไว้แล้ว', 'PAYMENT_ROUTING_FIXED');
                }
                $mode = PaymentRouting::serviceMode($booking['payment_service_mode'] ?? 'both', $input['paymentServiceMode'] ?? null);
                $pdo->prepare('UPDATE bookings SET payment_service_mode = ? WHERE id = ?')
                    ->execute([$mode, $booking['id']]);
                return;
            }
            throw new HttpException(422, 'ระบุการจองเดิมที่ต้องกำหนดผู้ตรวจสลิป', 'VALIDATION_FAILED');
        });
        Http::json(['saved' => true]);
    }
}
