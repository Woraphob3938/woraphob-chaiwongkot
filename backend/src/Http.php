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

    public static function requireFields(array $input, array $fields): void
    {
        $errors = [];
        foreach ($fields as $field) {
            if (!array_key_exists($field, $input) || trim((string) $input[$field]) === '') {
                $errors[$field] = 'จำเป็นต้องระบุข้อมูล';
            }
        }
        if ($errors !== []) {
            throw new HttpException(422, 'กรอกข้อมูลที่จำเป็นให้ครบ', 'VALIDATION_FAILED', $errors);
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
