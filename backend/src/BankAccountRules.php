<?php
declare(strict_types=1);

/**
 * Bank accounts a freelance trainer receives money into (บทที่ 3.1.3 ข้อ 3):
 * add accounts, pick the default one members see, and edit account numbers.
 */
final class BankAccountRules
{
    public const MAX_ACCOUNTS = 5;

    /** Thai banks a member can transfer to from any banking app. */
    public const BANKS = [
        'กสิกรไทย',
        'กรุงเทพ',
        'กรุงไทย',
        'ไทยพาณิชย์',
        'กรุงศรีอยุธยา',
        'ทหารไทยธนชาต (ttb)',
        'ออมสิน',
        'ธ.ก.ส.',
        'อาคารสงเคราะห์',
        'ยูโอบี',
        'ซีไอเอ็มบี ไทย',
        'เกียรตินาคินภัทร',
        'แลนด์ แอนด์ เฮ้าส์',
        'ทิสโก้',
    ];

    /**
     * @return array{bankName: string, accountName: string, accountNumber: string}
     */
    public static function validate(array $input): array
    {
        $bankName = trim(Http::stringField($input, 'bankName'));
        $accountName = preg_replace('/\s+/u', ' ', trim(Http::stringField($input, 'accountName'))) ?? '';
        $accountNumber = preg_replace('/[\s-]/', '', Http::stringField($input, 'accountNumber')) ?? '';
        $fields = [];
        if (!in_array($bankName, self::BANKS, true)) {
            $fields['bankName'] = 'เลือกธนาคาร';
        }
        $nameLength = mb_strlen($accountName);
        if ($nameLength < 2 || $nameLength > 190) {
            $fields['accountName'] = 'กรอกชื่อบัญชี 2–190 ตัวอักษร';
        }
        if (preg_match('/^\d{10,15}$/', $accountNumber) !== 1) {
            $fields['accountNumber'] = 'เลขบัญชีเป็นตัวเลข 10–15 หลัก';
        }
        if ($fields !== []) {
            throw new HttpException(422, 'ข้อมูลบัญชีธนาคารไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        }
        return ['bankName' => $bankName, 'accountName' => $accountName, 'accountNumber' => $accountNumber];
    }
}
