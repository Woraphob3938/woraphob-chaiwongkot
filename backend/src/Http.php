<?php
declare(strict_types=1);

final class HttpException extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly string $errorCode = 'REQUEST_FAILED',
        public readonly array $fields = []
    ) {
        parent::__construct($message);
    }
}

final class Http
{
    public static function cors(string $origin): void
    {
        $requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($requestOrigin === $origin) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
        }
        header('Access-Control-Allow-Headers: Authorization, Content-Type, Accept');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
        header('Access-Control-Max-Age: 600');
        header('X-Content-Type-Options: nosniff');
    }

    public static function json(mixed $data, int $status = 200, array $meta = []): never
    {
        self::discardBufferedOutput();
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        $payload = ['data' => $data];
        if ($meta !== []) {
            $payload['meta'] = $meta;
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error(HttpException $error): never
    {
        self::discardBufferedOutput();
        http_response_code($error->status);
        header('Content-Type: application/json; charset=utf-8');
        $payload = [
            'error' => [
                'code' => $error->errorCode,
                'message' => $error->getMessage(),
            ],
        ];
        if ($error->fields !== []) {
            $payload['error']['fields'] = $error->fields;
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function body(): array
    {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        if (str_contains($contentType, 'multipart/form-data')) {
            // PHP turns `trainingTypeIds[]` into that literal key, so a multipart
            // form would otherwise look like it never sent the list at all.
            $fields = [];
            foreach ($_POST as $key => $value) {
                if (str_ends_with((string) $key, '[]')) {
                    $name = substr((string) $key, 0, -2);
                    $fields[$name] = is_array($value) ? $value : [$value];
                    continue;
                }
                $fields[$key] = $value;
            }
            return $fields;
        }

        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new HttpException(400, 'รูปแบบ JSON ไม่ถูกต้อง', 'INVALID_JSON');
        }
        return $decoded;
    }

    /**
     * A request value that may safely enter a string context: text, or a number
     * a client sent without quotes. `true`, `null`, an array and an object are
     * all refused, because casting any of them yields a value the field never
     * meant to hold — an array becomes the literal "Array", which is non-empty
     * and therefore slips past every required-field check.
     */
    public static function isText(mixed $value): bool
    {
        return is_string($value) || is_int($value) || is_float($value);
    }

    /** Reads a value as text; anything that is not text reads as empty. */
    public static function text(mixed $value): string
    {
        return self::isText($value) ? (string) $value : '';
    }

    /**
     * Reads one request field as text without ever turning an array into
     * "Array". A value that is not text reads as '' (or the given default), so
     * the field's own validation reports it instead of PHP emitting a warning
     * into the response body.
     */
    public static function stringField(array $input, string $field, string $default = ''): string
    {
        return array_key_exists($field, $input) ? self::text($input[$field]) : $default;
    }

    /**
     * Refuses the listed fields when a request carries them as something other
     * than text. `null` stays allowed: it is how an optional field is cleared.
     */
    public static function assertTextFields(array $input, array $fields): void
    {
        $errors = [];
        foreach ($fields as $field) {
            if (array_key_exists($field, $input) && $input[$field] !== null && !self::isText($input[$field])) {
                $errors[$field] = 'ต้องเป็นข้อความ';
            }
        }
        if ($errors !== []) {
            throw new HttpException(422, 'ข้อมูลไม่ถูกต้อง', 'VALIDATION_FAILED', $errors);
        }
    }

    public static function requireFields(array $input, array $fields): void
    {
        $errors = [];
        foreach ($fields as $field) {
            $value = $input[$field] ?? null;
            if (!array_key_exists($field, $input) || !self::isText($value) || trim((string) $value) === '') {
                $errors[$field] = 'จำเป็นต้องระบุข้อมูล';
            }
        }
        if ($errors !== []) {
            throw new HttpException(422, 'กรอกข้อมูลที่จำเป็นให้ครบ', 'VALIDATION_FAILED', $errors);
        }
    }

    /**
     * Anything already echoed — a PHP warning under `display_errors`, a stray
     * `print` — would be prepended to the JSON and break the client's parse. The
     * response is the API's only output, so whatever is buffered is dropped.
     */
    private static function discardBufferedOutput(): void
    {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
    }

    public static function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($header === '' && function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $value) {
                if (strcasecmp((string) $name, 'Authorization') === 0) {
                    $header = (string) $value;
                    break;
                }
            }
        }
        if (preg_match('/^Bearer\s+(.+)$/i', $header, $matches) !== 1) {
            return null;
        }
        return trim($matches[1]);
    }
}
