<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Database.php';
$config = require __DIR__ . '/../src/config.php';
$db = new Database($config['database']);
$pdo = $db->pdo();
$backupDirectory = 'C:/xampp/fitconnect-backups';
if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true)) throw new RuntimeException('Cannot create backup directory');
$backup = $backupDirectory . '/payment-proof-' . date('Ymd-His') . '.sql';
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

$trainerColumns = array_column($db->fetchAll('SHOW COLUMNS FROM trainer_profiles'), 'Field');
if (!in_array('payment_account_name', $trainerColumns, true)) {
    $pdo->exec('ALTER TABLE trainer_profiles ADD payment_account_name VARCHAR(190) NULL AFTER monthly_session_count');
}
if (!in_array('promptpay_id', $trainerColumns, true)) {
    $pdo->exec('ALTER TABLE trainer_profiles ADD promptpay_id VARCHAR(13) NULL AFTER payment_account_name');
}
if (!in_array('payment_qr_path', $trainerColumns, true)) {
    $pdo->exec('ALTER TABLE trainer_profiles ADD payment_qr_path VARCHAR(500) NULL AFTER promptpay_id');
}
$pdo->exec('UPDATE trainer_profiles SET payment_account_name = "บัญชีสาธิต ห้ามโอนเงินจริง", promptpay_id = "0000000000" WHERE is_demo = 1 AND promptpay_id IS NULL');
echo 'Payment QR ready.' . PHP_EOL;
