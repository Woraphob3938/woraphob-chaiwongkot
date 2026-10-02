<?php
declare(strict_types=1);

final class ProfileRules
{
    public static function member(array $input): array
    {
        $fields = [];
        $firstName = trim((string) ($input['firstName'] ?? ''));
        $lastName = trim((string) ($input['lastName'] ?? ''));
        $phone = trim((string) ($input['phone'] ?? ''));
        $fitnessGoal = trim((string) ($input['fitnessGoal'] ?? ''));
        $experienceLevel = trim((string) ($input['experienceLevel'] ?? ''));

        if ($firstName === '') $fields['firstName'] = 'กรุณากรอกชื่อ';
        if ($lastName === '') $fields['lastName'] = 'กรุณากรอกนามสกุล';
        self::validatePhone($phone, $fields);
        if (!in_array($experienceLevel, ['', 'beginner', 'intermediate', 'advanced'], true)) {
            $fields['experienceLevel'] = 'เลือกระดับประสบการณ์ที่กำหนด';
        }

        $weight = self::nullablePositiveNumber($input['weight'] ?? null, 'weight', $fields, 999.99);
        $height = self::nullablePositiveNumber($input['height'] ?? null, 'height', $fields, 999.99);
        $birthDate = self::nullableBirthDate($input['birthDate'] ?? null, 'birthDate', $fields);
        self::throwIfInvalid($fields);

        return [
            'firstName' => $firstName,
            'lastName' => $lastName,
            'phone' => $phone,
            'fitnessGoal' => $fitnessGoal,
            'experienceLevel' => $experienceLevel,
            'weight' => $weight,
            'height' => $height,
            'birthDate' => $birthDate,
        ];
    }

    public static function trainer(array $input): array
    {
        $fields = [];
        $displayName = trim((string) ($input['displayName'] ?? ''));
        $legalName = trim((string) ($input['legalName'] ?? ''));
        $phone = trim((string) ($input['phone'] ?? ''));
        $headline = trim((string) ($input['headline'] ?? ''));
        $bio = trim((string) ($input['bio'] ?? ''));
        $serviceMode = trim((string) ($input['serviceMode'] ?? ''));
        $gymName = trim((string) ($input['gymName'] ?? ''));

        if ($displayName === '') $fields['displayName'] = 'กรุณากรอกชื่อที่แสดง';
        if ($legalName === '') $fields['legalName'] = 'กรุณากรอกชื่อจริง';
        self::validatePhone($phone, $fields);
        if (!in_array($serviceMode, ['freelance', 'gym', 'both'], true)) {
            $fields['serviceMode'] = 'เลือกรูปแบบการให้บริการที่กำหนด';
        }
        $yearsValue = $input['yearsExperience'] ?? null;
        $yearsExperience = filter_var($yearsValue, FILTER_VALIDATE_INT);
        if ($yearsExperience === false || $yearsExperience < 0 || $yearsExperience > 65535) {
            $fields['yearsExperience'] = 'กรอกจำนวนปีตั้งแต่ศูนย์ขึ้นไป';
            $yearsExperience = 0;
        }

        $priceFrom = self::nullablePositiveNumber($input['priceFrom'] ?? null, 'priceFrom', $fields, 99999999.99);
        $monthlyPrice = self::nullablePositiveNumber($input['monthlyPrice'] ?? null, 'monthlyPrice', $fields, 99999999.99);
        $monthlySessionCount = null;
        $monthlySessionValue = $input['monthlySessionCount'] ?? null;
        if ($monthlySessionValue !== null && trim((string) $monthlySessionValue) !== '') {
            $monthlySessionCount = filter_var($monthlySessionValue, FILTER_VALIDATE_INT);
            if ($monthlySessionCount === false || $monthlySessionCount < 2 || $monthlySessionCount > 30) {
                $fields['monthlySessionCount'] = 'กรอกจำนวนครั้งตั้งแต่ 2 ถึง 30';
                $monthlySessionCount = null;
            }
        }
        if ($monthlyPrice !== null && $monthlySessionCount === null) {
            $fields['monthlySessionCount'] = 'กรอกจำนวนครั้งในแพ็กเกจ';
        }
        if ($monthlyPrice === null && $monthlySessionCount !== null) {
            $fields['monthlyPrice'] = 'กรอกราคาแพ็กเกจ 30 วัน';
        }
        $trainingTypeIds = [];
        if (is_array($input['trainingTypeIds'] ?? null)) {
            foreach ($input['trainingTypeIds'] as $typeId) {
                $normalizedId = filter_var($typeId, FILTER_VALIDATE_INT);
                if ($normalizedId !== false && $normalizedId > 0) $trainingTypeIds[] = $normalizedId;
            }
        }
        $trainingTypeIds = array_values(array_unique($trainingTypeIds));
        sort($trainingTypeIds, SORT_NUMERIC);
        if ($trainingTypeIds === []) {
            $fields['trainingTypeIds'] = 'เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ';
        }
        $birthDate = self::nullableBirthDate($input['birthDate'] ?? null, 'birthDate', $fields);
        $education = trim((string) ($input['education'] ?? ''));
        if (mb_strlen($education) > 255) {
            $fields['education'] = 'กรอกข้อมูลการศึกษาไม่เกิน 255 ตัวอักษร';
        }
        // บทที่ 3.1.2: members search a trainer by name or nickname.
        $nickname = preg_replace('/\s+/u', ' ', trim((string) ($input['nickname'] ?? ''))) ?? '';
        if (mb_strlen($nickname) > 60) {
            $fields['nickname'] = 'กรอกชื่อเล่นไม่เกิน 60 ตัวอักษร';
        }

        self::throwIfInvalid($fields);
        return [
            'displayName' => $displayName,
            'legalName' => $legalName,
            'nickname' => $nickname,
            'phone' => $phone,
            'headline' => $headline,
            'bio' => $bio,
            'yearsExperience' => $yearsExperience,
            'serviceMode' => $serviceMode,
            'gymName' => in_array($serviceMode, ['gym', 'both'], true) ? $gymName : '',
            'priceFrom' => $priceFrom,
            'monthlyPrice' => $monthlyPrice,
            'monthlySessionCount' => $monthlySessionCount,
            'trainingTypeIds' => $trainingTypeIds,
            'birthDate' => $birthDate,
            'education' => $education,
        ];
    }

    private static function validatePhone(string $phone, array &$fields): void
    {
        if ($phone !== '' && preg_match('/^[0-9+()\-\s]{8,30}$/', $phone) !== 1) {
            $fields['phone'] = 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง';
        }
    }

    /**
     * Optional `YYYY-MM-DD` birth date: a real past date for someone aged
     * 5 to 120 years. Blank and null both mean "not given".
     */
    private static function nullableBirthDate(mixed $value, string $field, array &$fields): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $raw = trim((string) $value);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $raw, new DateTimeZone('UTC'));
        if ($date === false || $date->format('Y-m-d') !== $raw) {
            $fields[$field] = 'กรอกวันเกิดเป็นวันที่แบบ YYYY-MM-DD';
            return null;
        }
        $today = new DateTimeImmutable('today', new DateTimeZone('UTC'));
        if ($date >= $today) {
            $fields[$field] = 'วันเกิดต้องเป็นวันที่ผ่านมาแล้ว';
            return null;
        }
        $age = (int) $date->diff($today)->y;
        if ($age < 5 || $age > 120) {
            $fields[$field] = 'อายุต้องอยู่ระหว่าง 5 ถึง 120 ปี';
            return null;
        }
        return $raw;
    }

    private static function nullablePositiveNumber(mixed $value, string $field, array &$fields, float $maximum): ?float
    {
        if ($value === null || trim((string) $value) === '') return null;
        if (!is_numeric($value) || (float) $value <= 0 || (float) $value > $maximum) {
            $fields[$field] = 'กรอกเป็นตัวเลขที่มากกว่าศูนย์';
            return null;
        }
        return round((float) $value, 2);
    }

    private static function throwIfInvalid(array $fields): void
    {
        if ($fields !== []) {
            throw new HttpException(422, 'ข้อมูลโปรไฟล์ไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        }
    }
}
