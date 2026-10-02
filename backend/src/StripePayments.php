<?php
declare(strict_types=1);

/**
 * Rules for paying a booking through Stripe Checkout. Pure functions only, so
 * backend/tests/StripePaymentsTest.php can check them without the network.
 *
 * Money flow (Stripe Connect):
 * - freelance: a direct charge on the trainer's connected account; the
 *   platform keeps its fee as an application fee. Stripe does not let a Thai
 *   platform carry connected-account losses, which destination charges need,
 *   so the trainer's account is the merchant of record and Stripe owns risk;
 * - gym: the member pays the platform and the gym's administrators reconcile it.
 */
final class StripePayments
{
    /** Stripe's smallest THB charge. */
    public const MINIMUM_SATANG = 1000;

    /** Stripe refuses a Checkout Session that expires sooner than this. */
    public const MINIMUM_SESSION_MINUTES = 30;

    public static function toSatang(mixed $baht): int
    {
        $value = WorkflowRules::normalizeMoney($baht, 'amount');
        return (int) round(((float) $value) * 100);
    }

    public static function applicationFee(int $amountSatang, float $percent): int
    {
        if ($percent <= 0) {
            return 0;
        }
        return (int) min($amountSatang, round($amountSatang * min($percent, 100) / 100));
    }

    /**
     * The Checkout Session for one booking.
     *
     * @param array{publicId: string, amountSatang: int, description: string, memberEmail: ?string,
     *              serviceMode: string, destination: ?string, feeSatang: int,
     *              successUrl: string, cancelUrl: string, expiresAt: int} $booking
     */
    public static function checkoutSessionParams(array $booking): array
    {
        if ($booking['amountSatang'] < self::MINIMUM_SATANG) {
            throw new HttpException(409, 'ยอดชำระต่ำกว่าขั้นต่ำของระบบชำระเงิน (10 บาท)', 'PAYMENT_AMOUNT_TOO_LOW');
        }
        $paymentIntent = [
            'description' => 'FitConnect ' . $booking['publicId'],
            'metadata' => ['booking_id' => $booking['publicId'], 'service_mode' => $booking['serviceMode']],
        ];
        if ($booking['serviceMode'] === 'freelance') {
            // The session itself is created on this account (Stripe-Account).
            if ($booking['destination'] === null) {
                throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้เปิดรับเงินออนไลน์', 'TRAINER_PAYOUTS_NOT_READY');
            }
            if ($booking['feeSatang'] > 0) {
                $paymentIntent['application_fee_amount'] = $booking['feeSatang'];
            }
        }
        $params = [
            'mode' => 'payment',
            'client_reference_id' => $booking['publicId'],
            'metadata' => ['booking_id' => $booking['publicId']],
            'line_items' => [[
                'quantity' => 1,
                'price_data' => [
                    'currency' => 'thb',
                    'unit_amount' => $booking['amountSatang'],
                    'product_data' => ['name' => $booking['description']],
                ],
            ]],
            'payment_intent_data' => $paymentIntent,
            'success_url' => $booking['successUrl'],
            'cancel_url' => $booking['cancelUrl'],
            'expires_at' => $booking['expiresAt'],
            'locale' => 'th',
        ];
        if ($booking['memberEmail'] !== null && $booking['memberEmail'] !== '') {
            $params['customer_email'] = $booking['memberEmail'];
        }
        return $params;
    }

    /**
     * A full refund. A freelance charge lives on the trainer's account, so the
     * refund is made there and the platform fee goes back too.
     */
    public static function refundParams(string $paymentIntent, bool $connectedCharge, string $reason): array
    {
        $params = ['payment_intent' => $paymentIntent, 'metadata' => ['reason' => $reason]];
        if ($connectedCharge) {
            $params['refund_application_fee'] = true;
        }
        return $params;
    }

    /**
     * The trainer's connected account (Accounts v2): full Stripe Dashboard,
     * Stripe collects fees and owns losses, card and PromptPay requested.
     */
    public static function connectedAccountBody(string $email, string $displayName, int $trainerProfileId): array
    {
        return [
            'contact_email' => $email,
            'display_name' => $displayName,
            'identity' => ['country' => 'TH'],
            'dashboard' => 'full',
            'defaults' => ['responsibilities' => ['fees_collector' => 'stripe', 'losses_collector' => 'stripe']],
            'configuration' => ['merchant' => ['capabilities' => [
                'card_payments' => ['requested' => true],
                'promptpay_payments' => ['requested' => true],
            ]]],
            'metadata' => ['trainer_profile_id' => (string) $trainerProfileId],
        ];
    }

    /** Whether the connected account may take charges (v2 card_payments). */
    public static function chargesEnabled(array $account): bool
    {
        return ($account['configuration']['merchant']['capabilities']['card_payments']['status'] ?? null) === 'active';
    }

    /**
     * What the member's return from Checkout, or a webhook, means for the
     * booking: 'paid', 'open' (still paying), or 'closed' (expired/abandoned).
     */
    public static function sessionOutcome(array $session): string
    {
        if (($session['payment_status'] ?? '') === 'paid') {
            return 'paid';
        }
        return ($session['status'] ?? '') === 'open' ? 'open' : 'closed';
    }
}
