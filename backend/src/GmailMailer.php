<?php
declare(strict_types=1);

final class GmailMailer
{
    private readonly ?Closure $transport;

    public function __construct(
        private readonly array $config,
        ?Closure $transport = null
    ) {
        $this->transport = $transport;
        if ($this->isEnabled()) {
            foreach (['host', 'port', 'username', 'app_password', 'from_email', 'from_name', 'app_url'] as $key) {
                if (!isset($this->config[$key]) || trim((string) $this->config[$key]) === '') {
                    throw new InvalidArgumentException("Missing mail configuration: {$key}");
                }
            }
        }
    }

    public function isEnabled(): bool
    {
        return (bool) ($this->config['enabled'] ?? false);
    }

    public function send(
        string $recipientEmail,
        string $recipientName,
        string $title,
        string $message,
        string $actionPath
    ): void {
        if (!$this->isEnabled()) {
            return;
        }
        if (
            !str_starts_with($actionPath, '/')
            || str_starts_with($actionPath, '//')
            || str_contains($actionPath, '\\')
            || preg_match('/[\x00-\x1F\x7F]/', $actionPath) === 1
        ) {
            throw new InvalidArgumentException('Mail action path must be internal.');
        }
        if (filter_var($recipientEmail, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('Recipient email is invalid.');
        }

        $request = [
            'url' => sprintf('smtp://%s:%d', $this->config['host'], (int) $this->config['port']),
            'username' => (string) $this->config['username'],
            'password' => (string) $this->config['app_password'],
            'from' => (string) $this->config['from_email'],
            'to' => $recipientEmail,
            'payload' => $this->messagePayload($recipientEmail, $recipientName, $title, $message, $actionPath),
        ];

        if ($this->transport !== null) {
            ($this->transport)($request);
            return;
        }
        $this->sendWithCurl($request);
    }

    private function messagePayload(
        string $recipientEmail,
        string $recipientName,
        string $title,
        string $message,
        string $actionPath
    ): string {
        $boundary = 'fitconnect-' . bin2hex(random_bytes(12));
        $safeEmail = str_replace(["\r", "\n"], '', $recipientEmail);
        $safeTitle = trim(strip_tags($title));
        $safeName = trim(strip_tags($recipientName));
        $plainMessage = trim(strip_tags($message));
        $actionUrl = rtrim((string) $this->config['app_url'], '/') . $actionPath;
        $subject = '[FitConnect] =?UTF-8?B?' . base64_encode($safeTitle) . '?=';
        $fromName = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], '', (string) $this->config['from_name'])) . '?=';

        $plain = "สวัสดี {$safeName}\r\n\r\n{$safeTitle}\r\n{$plainMessage}\r\n\r\nเปิด FitConnect: {$actionUrl}\r\n\r\nอีเมลนี้เป็นการแจ้งเตือนจากระบบ FitConnect";
        $htmlName = htmlspecialchars($safeName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $htmlTitle = htmlspecialchars($safeTitle, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $htmlMessage = nl2br(htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $htmlUrl = htmlspecialchars($actionUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $html = '<!doctype html><html lang="th"><body style="font-family:Arial,sans-serif;color:#082f1d">'
            . "<p>สวัสดี {$htmlName}</p><h1 style=\"font-size:22px\">{$htmlTitle}</h1><p>{$htmlMessage}</p>"
            . "<p><a href=\"{$htmlUrl}\" style=\"display:inline-block;padding:12px 18px;background:#b7f52a;color:#082f1d;text-decoration:none\">เปิด FitConnect</a></p>"
            . '<p style="font-size:12px;color:#52635a">อีเมลนี้เป็นการแจ้งเตือนจากระบบ FitConnect</p></body></html>';

        return implode("\r\n", [
            'Date: ' . gmdate(DATE_RFC2822),
            "To: <{$safeEmail}>",
            "From: {$fromName} <{$this->config['from_email']}>",
            "Subject: {$subject}",
            'MIME-Version: 1.0',
            "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
            '',
            "--{$boundary}",
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            $plain,
            "--{$boundary}",
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            $html,
            "--{$boundary}--",
            '',
        ]);
    }

    private function sendWithCurl(array $request): void
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP cURL is unavailable.');
        }
        $stream = fopen('php://temp', 'r+');
        if ($stream === false) {
            throw new RuntimeException('Could not prepare email message.');
        }
        fwrite($stream, $request['payload']);
        rewind($stream);
        $curl = curl_init($request['url']);
        if ($curl === false) {
            fclose($stream);
            throw new RuntimeException('Could not initialize email transport.');
        }
        curl_setopt_array($curl, [
            CURLOPT_USERNAME => $request['username'],
            CURLOPT_PASSWORD => $request['password'],
            CURLOPT_MAIL_FROM => '<' . $request['from'] . '>',
            CURLOPT_MAIL_RCPT => ['<' . $request['to'] . '>'],
            CURLOPT_USE_SSL => CURLUSESSL_ALL,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_UPLOAD => true,
            CURLOPT_INFILE => $stream,
            CURLOPT_INFILESIZE => strlen($request['payload']),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
        ]);
        $result = curl_exec($curl);
        $errorNumber = curl_errno($curl);
        curl_close($curl);
        fclose($stream);
        if ($result === false) {
            error_log("FitConnect mail transport failed with cURL code {$errorNumber}.");
            throw new RuntimeException('ส่งอีเมลไม่สำเร็จ');
        }
    }
}
