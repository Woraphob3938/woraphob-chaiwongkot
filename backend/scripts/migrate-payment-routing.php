<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/Database.php';
$config = require __DIR__ . '/../src/config.php';
$db = new Database($config['database']);
$pdo = $db->pdo();
$backupDirectory = 'C:/xampp/fitconnect-backups';
if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true)) throw new RuntimeException('Cannot create backup directory');
$backup = $backupDirectory . '/payment-routing-' . date('Ymd-His') . '.sql';
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
$columns = array_column($db->fetchAll('SHOW COLUMNS FROM bookings'), 'Field');
// Preserve legacy invalid periods; this migration changes only payment routing.
// Disable checks only on this connection, restoring them even if migration fails.
$checks = (int) $pdo->query('SELECT @@SESSION.check_constraint_checks')->fetchColumn();
$pdo->exec('SET SESSION check_constraint_checks = OFF');
try {
if (!in_array('payment_service_mode', $columns, true)) {
    $pdo->exec('ALTER TABLE bookings ADD payment_service_mode ENUM("freelance", "gym") NULL');
}
// Do not guess the service mode of legacy "both" bookings.
$pdo->exec('UPDATE bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
    SET b.payment_service_mode = tp.service_mode
    WHERE b.payment_service_mode IS NULL AND tp.service_mode IN ("freelance", "gym")');
} finally {
    $pdo->exec('SET SESSION check_constraint_checks = ' . $checks);
}
echo 'Payment routing ready for one gym.' . PHP_EOL;
echo 'Unresolved legacy bookings: ' . $pdo->query('SELECT COUNT(*) FROM bookings WHERE payment_service_mode IS NULL')->fetchColumn() . PHP_EOL;
