<?php
declare(strict_types=1);

/**
 * First-line checks on a transfer slip. None of them proves money arrived: the
 * booked trainer still confirms the credit in their banking app. They catch
 * the cheap frauds before that step: a genuine slip reused for a second
 * booking, an old slip whose round amount happens to match, and a payload that
 * was edited by hand.
 */
final class SlipRules
{
    /** Open bookings whose transfer amounts must stay distinguishable. */
    public const OPEN_STATUSES = ['pending_trainer', 'awaiting_payment', 'payment_review'];

    /**
     * The quoted price plus up to 99 satang, chosen so its satang is not used
     * by another open booking paid to the same account and a credit in the
     * banking app points at exactly one booking. When every satang is taken a
     * collision is accepted: the trainer's manual check still applies.
     *
     * @param list<int> $takenSatang satang already used by open bookings
     */
    public static function transferAmount(string $quotedPrice, array $takenSatang): string
    {
        // Never below the quoted price: add 1–99 satang until the resulting
        // satang is one no open booking to this account is using.
        $base = (int) round(((float) $quotedPrice) * 100);
        $taken = array_flip(array_map('intval', $takenSatang));
        for ($offset = 1; $offset <= 99; $offset++) {
            $satang = ($base + $offset) % 100;
            if ($satang !== 0 && !isset($taken[$satang])) {
                return number_format(($base + $offset) / 100, 2, '.', '');
            }
        }
        return number_format(($base + 1) / 100, 2, '.', '');
    }

    /**
     * Parses the mini QR printed on Thai bank transfer slips.
     *
     * The payload is EMVCo-style TLV: tag 00 holds a nested TLV with the API
     * id (00), the sending bank code (01) and the transaction reference (02);
     * tag 51 is the country and tag 91 a CRC-16/CCITT over everything before
     * its value. A payload that fails the CRC was altered and is rejected.
     *
     * @return array{bank: string, reference: string, key: string}|null
     */
    public static function parseSlipQr(string $payload): ?array
    {
        $payload = trim($payload);
        if ($payload === '' || strlen($payload) > 512 || preg_match('/^[0-9A-Za-z]+$/', $payload) !== 1) {
            return null;
        }
        $top = self::parseTlv($payload);
        if ($top === null || !isset($top['00'], $top['91'])) {
            return null;
        }
        $crcPosition = strrpos($payload, '9104');
        if ($crcPosition === false || strtoupper($top['91']) !== self::crc16(substr($payload, 0, $crcPosition + 4))) {
            return null;
        }
        $inner = self::parseTlv($top['00']);
        if ($inner === null || empty($inner['01']) || empty($inner['02'])) {
            return null;
        }
        $bank = $inner['01'];
        $reference = $inner['02'];
        if (preg_match('/^\d{3}$/', $bank) !== 1 || preg_match('/^[0-9A-Za-z]{6,40}$/', $reference) !== 1) {
            return null;
        }
        // References are only unique within a bank, so the stored key carries both.
        return ['bank' => $bank, 'reference' => $reference, 'key' => substr($bank . ':' . $reference, 0, 64)];
    }

    /** @return array<string, string>|null */
    private static function parseTlv(string $value): ?array
    {
        $fields = [];
        $offset = 0;
        $length = strlen($value);
        while ($offset < $length) {
            if ($offset + 4 > $length) {
                return null;
            }
            $tag = substr($value, $offset, 2);
            $size = substr($value, $offset + 2, 2);
            if (preg_match('/^\d{2}$/', $tag) !== 1 || preg_match('/^\d{2}$/', $size) !== 1) {
                return null;
            }
            $size = (int) $size;
            if ($offset + 4 + $size > $length) {
                return null;
            }
            $fields[$tag] = substr($value, $offset + 4, $size);
            $offset += 4 + $size;
        }
        return $fields;
    }

    /** CRC-16/CCITT-FALSE, the checksum Thai QR payloads carry in tag 91. */
    public static function crc16(string $data): string
    {
        $crc = 0xFFFF;
        $length = strlen($data);
        for ($i = 0; $i < $length; $i++) {
            $crc ^= ord($data[$i]) << 8;
            for ($bit = 0; $bit < 8; $bit++) {
                $crc = ($crc & 0x8000) ? (($crc << 1) ^ 0x1021) : ($crc << 1);
                $crc &= 0xFFFF;
            }
        }
        return strtoupper(str_pad(dechex($crc), 4, '0', STR_PAD_LEFT));
    }
}
