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
$backup = $backupDirectory . '/stripe-payments-' . date('Ymd-His') . '.sql';
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

// Every statement in the manual migration is idempotent (IF NOT EXISTS / MODIFY).
$sql = (string) file_get_contents(__DIR__ . '/../database/manual-migrations/20260928_stripe_payments.sql');
$sql = preg_replace('/^--.*$/m', '', $sql);
foreach (array_filter(array_map('trim', explode(';', (string) $sql))) as $statement) {
    $pdo->exec($statement);
}
echo 'Stripe payments ready.' . PHP_EOL;
