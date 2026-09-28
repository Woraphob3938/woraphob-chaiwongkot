<?php
declare(strict_types=1);

// One-off migration: CLI only. Over HTTP this would run mysqldump and ALTER
// TABLE for any anonymous caller, so the web SAPI answers 404.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../src/Database.php';
$config = require __DIR__ . '/../src/config.php';
$db = new Database($config['database']);
$pdo = $db->pdo();
$backupDirectory = 'C:/xampp/fitconnect-backups';
if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true)) throw new RuntimeException('Cannot create backup directory');
$backup = $backupDirectory . '/slip-checks-' . date('Ymd-His') . '.sql';
$settings = $config['database'];
$process = proc_open([
    'C:/xampp/mysql/bin/mysqldump.exe', '--single-transaction', '--routines',
    '--host=' . $settings['host'], '--port=' . $settings['port'], '--user=' . $settings['user'], $settings['name'],
], [0 => ['pipe', 'r'], 1 => ['file', $backup, 'w'], 2 => ['pipe', 'w']], $pipes, null,
    array_merge(getenv(), ['MYSQL_PWD' => $settings['pass']]), ['bypass_shell' => true]);
if (!is_resource($process)) throw new RuntimeException('Cannot start backup');
fclose($pipes[0]);
stream_get_contents($pipes[2]);
fclose($pipes[2]);
if (proc_close($process) !== 0) throw new RuntimeException('Backup failed; database unchanged. Check MySQL connectivity.');
echo 'Backup: ' . $backup . PHP_EOL;

// The exact amount, satang included, the member transfers for this booking.
$bookingColumns = array_column($db->fetchAll('SHOW COLUMNS FROM bookings'), 'Field');
if (!in_array('transfer_amount', $bookingColumns, true)) {
    $pdo->exec('ALTER TABLE bookings ADD transfer_amount DECIMAL(10, 2) NULL AFTER quoted_price');
}

// When the payment window a slip answered ended, kept after the booking's own
// deadline is cleared so the trainer can compare it with the time on the slip.
$paymentColumns = array_column($db->fetchAll('SHOW COLUMNS FROM payments'), 'Field');
if (!in_array('window_ends_at', $paymentColumns, true)) {
    $pdo->exec('ALTER TABLE payments ADD window_ends_at DATETIME NULL AFTER transaction_ref');
}
echo 'Slip checks ready.' . PHP_EOL;
