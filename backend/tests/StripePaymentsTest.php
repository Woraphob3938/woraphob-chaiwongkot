<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/WorkflowRules.php';
require_once __DIR__ . '/../src/StripeClient.php';
require_once __DIR__ . '/../src/StripePayments.php';

$tests = [];

function test(string $name, Closure $callback): void
{
    global $tests;
    $tests[$name] = $callback;
}

function assertSameValue(mixed $expected, mixed $actual): void
{
    if ($expected !== $actual) {
        throw new RuntimeException('Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function expectHttpError(string $code, Closure $callback): void
{
    try {
        $callback();
    } catch (HttpException $error) {
        assertSameValue($code, $error->errorCode);
        return;
    }
    throw new RuntimeException('Expected HttpException ' . $code);
}

function bookingInput(array $overrides = []): array
{
    return array_merge([
        'publicId' => 'BK-TEST0001',
        'amountSatang' => 80000,
        'description' => 'ค่าฝึกกับ เทรนเนอร์ทดสอบ',
        'memberEmail' => 'member@example.test',
        'serviceMode' => 'freelance',
        'destination' => 'acct_trainer',
        'feeSatang' => 8000,
        'successUrl' => 'http://localhost:3000/member?booking=BK-TEST0001&checkout=success',
        'cancelUrl' => 'http://localhost:3000/member?booking=BK-TEST0001&checkout=cancelled',
        'expiresAt' => 1790000000,
    ], $overrides);
}

test('converts baht to satang', function (): void {
    assertSameValue(80000, StripePayments::toSatang('800'));
    assertSameValue(149950, StripePayments::toSatang('1499.50'));
});

test('takes the platform fee as a share of the amount', function (): void {
    assertSameValue(8000, StripePayments::applicationFee(80000, 10));
    assertSameValue(0, StripePayments::applicationFee(80000, 0));
    assertSameValue(80000, StripePayments::applicationFee(80000, 150));
});

test('a freelance booking is a direct charge that keeps the platform fee', function (): void {
    $params = StripePayments::checkoutSessionParams(bookingInput());
    assertSameValue('payment', $params['mode']);
    assertSameValue('thb', $params['line_items'][0]['price_data']['currency']);
    assertSameValue(80000, $params['line_items'][0]['price_data']['unit_amount']);
    // The session is created on the trainer's account, so no transfer is set.
    assertSameValue(false, isset($params['payment_intent_data']['transfer_data']));
    assertSameValue(8000, $params['payment_intent_data']['application_fee_amount']);
    assertSameValue(false, isset($params['payment_intent_data']['on_behalf_of']));
    assertSameValue('BK-TEST0001', $params['metadata']['booking_id']);
});

test('a gym booking stays on the platform account', function (): void {
    $params = StripePayments::checkoutSessionParams(bookingInput(['serviceMode' => 'gym', 'destination' => null, 'feeSatang' => 0]));
    assertSameValue(false, isset($params['payment_intent_data']['transfer_data']));
    assertSameValue(false, isset($params['payment_intent_data']['application_fee_amount']));
});

test('a freelance booking without a connected account is refused', function (): void {
    expectHttpError('TRAINER_PAYOUTS_NOT_READY', fn() => StripePayments::checkoutSessionParams(bookingInput(['destination' => null])));
});

test('an amount under the Stripe minimum is refused', function (): void {
    expectHttpError('PAYMENT_AMOUNT_TOO_LOW', fn() => StripePayments::checkoutSessionParams(bookingInput(['amountSatang' => 999])));
});

test('reads the outcome of a checkout session', function (): void {
    assertSameValue('paid', StripePayments::sessionOutcome(['status' => 'complete', 'payment_status' => 'paid']));
    assertSameValue('open', StripePayments::sessionOutcome(['status' => 'open', 'payment_status' => 'unpaid']));
    assertSameValue('closed', StripePayments::sessionOutcome(['status' => 'expired', 'payment_status' => 'unpaid']));
    // PromptPay can complete the page before the money arrives.
    assertSameValue('closed', StripePayments::sessionOutcome(['status' => 'complete', 'payment_status' => 'unpaid']));
});

test('a refund of a connected charge also returns the platform fee', function (): void {
    $freelance = StripePayments::refundParams('pi_1', true, 'booking_cancelled');
    assertSameValue(true, $freelance['refund_application_fee']);
    assertSameValue(false, isset($freelance['reverse_transfer']));
    $gym = StripePayments::refundParams('pi_2', false, 'booking_cancelled');
    assertSameValue(false, isset($gym['refund_application_fee']));
    assertSameValue('pi_2', $gym['payment_intent']);
});

test('a trainer account is Stripe-liable with card and PromptPay', function (): void {
    $body = StripePayments::connectedAccountBody('t@example.test', 'เทรนเนอร์', 7);
    assertSameValue('TH', $body['identity']['country']);
    assertSameValue('full', $body['dashboard']);
    assertSameValue('stripe', $body['defaults']['responsibilities']['losses_collector']);
    assertSameValue(true, $body['configuration']['merchant']['capabilities']['promptpay_payments']['requested']);
});

test('charges are ready only when card payments are active', function (): void {
    $account = fn(string $status) => ['configuration' => ['merchant' => ['capabilities' => ['card_payments' => ['status' => $status]]]]];
    assertSameValue(true, StripePayments::chargesEnabled($account('active')));
    assertSameValue(false, StripePayments::chargesEnabled($account('restricted')));
    assertSameValue(false, StripePayments::chargesEnabled([]));
});

test('encodes nested parameters the way Stripe expects', function (): void {
    assertSameValue(
        'a%5Bb%5D=1&c%5B0%5D%5Bd%5D=x&e=true',
        StripeClient::encode(['a' => ['b' => 1], 'c' => [['d' => 'x']], 'e' => true, 'f' => null])
    );
});

test('accepts a correctly signed webhook and refuses a forged one', function (): void {
    $client = new StripeClient('sk_test_x', 'whsec_test');
    $payload = '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"id":"cs_1"}}}';
    $time = 1790000000;
    $signature = hash_hmac('sha256', $time . '.' . $payload, 'whsec_test');
    $event = $client->verifyWebhook($payload, "t={$time},v1={$signature}", $time);
    assertSameValue('evt_1', $event['id']);
    expectHttpError('INVALID_SIGNATURE', fn() => $client->verifyWebhook($payload, "t={$time},v1=deadbeef", $time));
    expectHttpError('INVALID_SIGNATURE', fn() => $client->verifyWebhook($payload, "t={$time},v1={$signature}", $time + 3600));
});

$failures = 0;
foreach ($tests as $name => $callback) {
    try {
        $callback();
        echo "PASS {$name}" . PHP_EOL;
    } catch (Throwable $error) {
        $failures++;
        echo "FAIL {$name}: {$error->getMessage()}" . PHP_EOL;
    }
}
echo count($tests) . ' tests, ' . $failures . ' failures' . PHP_EOL;
exit($failures === 0 ? 0 : 1);
