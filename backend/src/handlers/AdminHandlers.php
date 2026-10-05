<?php
declare(strict_types=1);

/** Admin operations, reports, accounts, permissions and the trainer review queue. Part of Handlers. */
trait AdminHandlers
{
    public function adminOperations(): never
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        $pageSize = 10;
        $userPage = $this->adminPage('userPage');
        $administratorPage = $this->adminPage('administratorPage');
        $bookingPage = $this->adminPage('bookingPage');
        $incomePage = $this->adminPage('incomePage');
        $paymentPage = $this->adminPage('paymentPage');
        $userQuery = mb_substr(trim((string) ($_GET['userQuery'] ?? '')), 0, 100);
        $bookingStatus = trim((string) ($_GET['bookingStatus'] ?? 'all'));
        $bookingStatuses = ['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired'];
        if ($bookingStatus !== 'all' && !in_array($bookingStatus, $bookingStatuses, true)) {
            throw new HttpException(422, 'สถานะการจองไม่ถูกต้อง', 'VALIDATION_FAILED');
        }
        $summary = $permissions['manageUsers'] ? ($this->database->fetchOne(
            'SELECT
                SUM(role = "member" AND status = "active") AS active_members,
                SUM(role = "trainer" AND status = "active") AS active_trainers
             FROM users'
        ) ?? []) : [];
        $bookingSummary = $permissions['manageBookings']
            ? ($this->database->fetchOne('SELECT COUNT(*) AS total_bookings FROM bookings') ?? [])
            : [];
        $revenueSummary = $permissions['reviewPayments'] ? ($this->database->fetchOne(
            'SELECT COALESCE(SUM(COALESCE(pay.amount, 0)), 0) AS approved_revenue
             FROM payments pay JOIN bookings b ON b.id = pay.booking_id
             WHERE pay.status = "approved" AND ' . PaymentRouting::scope($admin)[0],
            PaymentRouting::scope($admin)[1]
        ) ?? []) : [];

        $users = [];
        $administrators = [];
        $userTotal = 0;
        $administratorTotal = 0;
        if ($permissions['manageUsers']) {
            // Deleted accounts disappear from every list; a search matches the
            // display name, the email, or a stored phone number either profile.
            $userWhere = 'u.role <> "admin" AND u.status <> "deleted"';
            $userParams = [];
            if ($userQuery !== '') {
                $userWhere .= ' AND (u.display_name LIKE ? OR u.email LIKE ? OR mp.phone LIKE ? OR tp.phone LIKE ?)';
                $like = '%' . $userQuery . '%';
                $userParams = [$like, $like, $like, $like];
            }
            $userCount = $this->database->fetchOne(
                'SELECT COUNT(*) AS total FROM users u
                 LEFT JOIN member_profiles mp ON mp.user_id = u.id
                 LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
                 WHERE ' . $userWhere,
                $userParams
            );
            $userTotal = (int) ($userCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        tp.approval_status
                 FROM users u
                 LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
                 LEFT JOIN member_profiles mp ON mp.user_id = u.id
                 WHERE ' . $userWhere . '
                 ORDER BY FIELD(u.role, "trainer", "member"), u.created_at DESC, u.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($userPage * $pageSize),
                $userParams
            );
            $users = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'email' => $row['email'],
                'displayName' => $row['display_name'],
                'role' => $row['role'],
                'status' => $row['status'],
                'createdAt' => $this->iso($row['created_at']),
                'approvalStatus' => $row['approval_status'],
                'permissions' => null,
            ], $rows);

            $administratorCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM users WHERE role = "admin" AND status <> "deleted"');
            $administratorTotal = (int) ($administratorCount['total'] ?? 0);
            $adminRows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        ap.manage_users, ap.review_trainers, ap.manage_bookings, ap.review_payments
                 FROM users u
                 LEFT JOIN admin_permissions ap ON ap.user_id = u.id
                 WHERE u.role = "admin" AND u.status <> "deleted"
                 ORDER BY u.created_at DESC, u.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($administratorPage * $pageSize)
            );
            $administrators = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'email' => $row['email'],
                'displayName' => $row['display_name'],
                'role' => $row['role'],
                'status' => $row['status'],
                'createdAt' => $this->iso($row['created_at']),
                'approvalStatus' => null,
                'permissions' => [
                    'manageUsers' => (bool) $row['manage_users'],
                    'reviewTrainers' => (bool) $row['review_trainers'],
                    'manageBookings' => (bool) $row['manage_bookings'],
                    'reviewPayments' => (bool) $row['review_payments'],
                ],
            ], $adminRows);
        }

        $bookings = [];
        $bookingTotal = 0;
        if ($permissions['manageBookings']) {
            $bookingWhere = $bookingStatus === 'all' ? '' : 'WHERE b.status = ?';
            $bookingParams = $bookingStatus === 'all' ? [] : [$bookingStatus];
            $bookingCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM bookings b ' . $bookingWhere, $bookingParams);
            $bookingTotal = (int) ($bookingCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT b.id, b.public_id, b.starts_at, b.ends_at, b.status, b.payment_status,
                        b.quoted_price, b.created_at, member_user.display_name AS member_name,
                        trainer_user.display_name AS trainer_name
                 FROM bookings b
                 JOIN users member_user ON member_user.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 ' . $bookingWhere . '
                 ORDER BY b.created_at DESC, b.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($bookingPage * $pageSize),
                $bookingParams
            );
            $historyByBooking = [];
            if ($rows !== []) {
                $ids = array_map(fn(array $row): int => (int) $row['id'], $rows);
                $placeholders = self::marks($ids);
                $history = $this->database->fetchAll(
                    'SELECT h.booking_id, h.from_status, h.to_status, h.note, h.created_at,
                            u.display_name AS changed_by
                     FROM booking_status_history h
                     LEFT JOIN users u ON u.id = h.changed_by_user_id
                     WHERE h.booking_id IN (' . $placeholders . ')
                     ORDER BY h.created_at DESC, h.id DESC',
                    $ids
                );
                foreach ($history as $item) {
                    $historyByBooking[(int) $item['booking_id']][] = [
                        'fromStatus' => $item['from_status'],
                        'toStatus' => $item['to_status'],
                        'changedBy' => $item['changed_by'],
                        'note' => $item['note'],
                        'createdAt' => $this->iso($item['created_at']),
                    ];
                }
            }
            $bookings = array_map(fn(array $row): array => [
                'id' => $row['public_id'],
                'memberName' => $row['member_name'],
                'trainerName' => $row['trainer_name'],
                'startsAt' => $this->iso($row['starts_at']),
                'endsAt' => $this->iso($row['ends_at']),
                'status' => $row['status'],
                'paymentStatus' => $row['payment_status'],
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'createdAt' => $this->iso($row['created_at']),
                'history' => $historyByBooking[(int) $row['id']] ?? [],
            ], $rows);
        }

        $payments = [];
        $trainerIncome = [];
        $paymentTotal = 0;
        $incomeTotal = 0;
        if ($permissions['reviewPayments']) {
            [$paymentScope, $paymentParams] = PaymentRouting::scope($admin);
            $paymentCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM payments pay
                JOIN bookings b ON b.id = pay.booking_id WHERE ' . $paymentScope, $paymentParams);
            $paymentTotal = (int) ($paymentCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT pay.id, pay.amount, pay.status, pay.submitted_at, pay.reviewed_at,
                        b.public_id, b.quoted_price, member_user.display_name AS member_name,
                        trainer_user.display_name AS trainer_name, reviewer.display_name AS reviewed_by
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN users member_user ON member_user.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 LEFT JOIN users reviewer ON reviewer.id = pay.reviewed_by_user_id
                 WHERE ' . $paymentScope . '
                 ORDER BY pay.submitted_at DESC, pay.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($paymentPage * $pageSize),
                $paymentParams
            );
            $payments = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'bookingId' => $row['public_id'],
                'memberName' => $row['member_name'],
                'trainerName' => $row['trainer_name'],
                'amount' => $row['amount'] === null ? null : (float) $row['amount'],
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'status' => $row['status'],
                'submittedAt' => $this->iso($row['submitted_at']),
                'reviewedAt' => $row['reviewed_at'] === null ? null : $this->iso($row['reviewed_at']),
                'reviewedBy' => $row['reviewed_by'],
            ], $rows);
            $incomeCount = $this->database->fetchOne(
                'SELECT COUNT(DISTINCT b.trainer_profile_id) AS total
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                 WHERE pay.status = "approved" AND ' . $paymentScope,
                $paymentParams
            );
            $incomeTotal = (int) ($incomeCount['total'] ?? 0);
            $incomeRows = $this->database->fetchAll(
                'SELECT tp.id AS trainer_id, u.display_name AS trainer_name, SUM(b.session_count) AS paid_sessions,
                        COALESCE(SUM(COALESCE(pay.amount, b.quoted_price, 0)), 0) AS revenue
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users u ON u.id = tp.user_id
                 WHERE pay.status = "approved" AND ' . $paymentScope . '
                 GROUP BY tp.id, u.display_name ORDER BY revenue DESC, tp.id
                 LIMIT ' . $pageSize . ' OFFSET ' . ($incomePage * $pageSize),
                $paymentParams
            );
            $trainerIncome = array_map(fn(array $row): array => [
                'trainerId' => (int) $row['trainer_id'],
                'trainerName' => $row['trainer_name'],
                'paidSessions' => (int) $row['paid_sessions'],
                'revenue' => (float) $row['revenue'],
            ], $incomeRows);
        }

        // Monthly salary accrual for gym trainers: approved gym payments on
        // bookings that are confirmed or completed, bucketed by session month
        // over the latest twelve months.
        $gymSalaries = [];
        if ($permissions['reviewPayments']) {
            $salaryRows = $this->database->fetchAll(
                'SELECT tp.id AS trainer_id, u.display_name AS trainer_name,
                        DATE_FORMAT(b.starts_at, "%Y-%m") AS month,
                        COALESCE(SUM(b.session_count), 0) AS sessions,
                        COALESCE(SUM(pay.amount), 0) AS amount
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users u ON u.id = tp.user_id
                 WHERE pay.status = "approved"
                   AND b.payment_service_mode = "gym"
                   AND b.status IN ("confirmed", "completed")
                   AND b.starts_at >= DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 11 MONTH), "%Y-%m-01")
                 GROUP BY tp.id, u.display_name, month
                 ORDER BY month DESC, tp.id'
            );
            $gymSalaries = array_map(fn(array $row): array => [
                'trainerId' => (int) $row['trainer_id'],
                'trainerName' => $row['trainer_name'],
                'month' => (string) $row['month'],
                'sessions' => (int) $row['sessions'],
                'amount' => (float) $row['amount'],
            ], $salaryRows);
        }

        Http::json([
            'currentUserId' => (int) $admin['id'],
            'permissions' => $permissions,
            'summary' => [
                'activeMembers' => $permissions['manageUsers'] ? (int) ($summary['active_members'] ?? 0) : null,
                'activeTrainers' => $permissions['manageUsers'] ? (int) ($summary['active_trainers'] ?? 0) : null,
                'totalBookings' => $permissions['manageBookings'] ? (int) ($bookingSummary['total_bookings'] ?? 0) : null,
                'approvedRevenue' => $permissions['reviewPayments'] ? (float) ($revenueSummary['approved_revenue'] ?? 0) : null,
            ],
            'users' => $users,
            'administrators' => $administrators,
            'bookings' => $bookings,
            'payments' => $payments,
            'trainerIncome' => $trainerIncome,
            'gymSalaries' => $gymSalaries,
            'pagination' => [
                'pageSize' => $pageSize,
                'users' => ['page' => $userPage, 'total' => $permissions['manageUsers'] ? $userTotal : 0],
                'administrators' => ['page' => $administratorPage, 'total' => $permissions['manageUsers'] ? $administratorTotal : 0],
                'bookings' => ['page' => $bookingPage, 'total' => $permissions['manageBookings'] ? $bookingTotal : 0],
                'payments' => ['page' => $paymentPage, 'total' => $permissions['reviewPayments'] ? $paymentTotal : 0],
                'trainerIncome' => ['page' => $incomePage, 'total' => $permissions['reviewPayments'] ? $incomeTotal : 0],
            ],
        ]);
    }

    public function adminReports(): never
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        if (!$permissions['manageBookings'] && !$permissions['reviewPayments']) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์เปิดรายงาน', 'ADMIN_PERMISSION_REQUIRED');
        }
        $year = self::reportYear($_GET['year'] ?? null);
        $rangeStart = sprintf('%04d-01-01 00:00:00', $year);
        $rangeEnd = sprintf('%04d-01-01 00:00:00', $year + 1);

        // Only the sections the caller's permissions cover are filled in.
        $bookingsByMonth = [];
        foreach (self::monthKeys($year) as $month) {
            $byStatus = [];
            foreach (['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired'] as $statusName) {
                $byStatus[$statusName] = 0;
            }
            $bookingsByMonth[$month] = ['month' => $month, 'total' => 0, 'byStatus' => $byStatus];
        }
        if ($permissions['manageBookings']) {
            $rows = $this->database->fetchAll(
                'SELECT DATE_FORMAT(b.created_at, "%Y-%m") AS month, b.status, COUNT(*) AS total
                 FROM bookings b
                 WHERE b.created_at >= ? AND b.created_at < ?
                 GROUP BY month, b.status',
                [$rangeStart, $rangeEnd]
            );
            foreach ($rows as $row) {
                $month = (string) $row['month'];
                if (!isset($bookingsByMonth[$month])) {
                    continue;
                }
                $bookingsByMonth[$month]['total'] += (int) $row['total'];
                $bookingsByMonth[$month]['byStatus'][(string) $row['status']] = (int) $row['total'];
            }
        }

        $incomeByMonth = [];
        $paymentsByMonth = [];
        foreach (self::monthKeys($year) as $month) {
            $incomeByMonth[$month] = ['month' => $month, 'amount' => 0.0];
            $paymentsByMonth[$month] = ['month' => $month, 'submitted' => 0, 'approved' => 0, 'rejected' => 0];
        }
        if ($permissions['reviewPayments']) {
            $rows = $this->database->fetchAll(
                'SELECT DATE_FORMAT(pay.submitted_at, "%Y-%m") AS month,
                        COUNT(*) AS submitted,
                        COALESCE(SUM(pay.status = "approved"), 0) AS approved,
                        COALESCE(SUM(pay.status = "rejected"), 0) AS rejected,
                        COALESCE(SUM(CASE WHEN pay.status = "approved" THEN pay.amount ELSE 0 END), 0) AS income
                 FROM payments pay
                 WHERE pay.submitted_at >= ? AND pay.submitted_at < ?
                 GROUP BY month',
                [$rangeStart, $rangeEnd]
            );
            foreach ($rows as $row) {
                $month = (string) $row['month'];
                if (!isset($incomeByMonth[$month])) {
                    continue;
                }
                $incomeByMonth[$month]['amount'] = (float) $row['income'];
                $paymentsByMonth[$month]['submitted'] = (int) $row['submitted'];
                $paymentsByMonth[$month]['approved'] = (int) $row['approved'];
                $paymentsByMonth[$month]['rejected'] = (int) $row['rejected'];
            }
        }

        $roleCounts = $this->database->fetchOne(
            'SELECT COALESCE(SUM(role = "member"), 0) AS members,
                    COALESCE(SUM(role = "trainer"), 0) AS trainers,
                    COALESCE(SUM(role = "admin"), 0) AS admins
             FROM users WHERE status <> "deleted"'
        ) ?? [];
        // หนึ่งแถวต่อบทบาท ตามสัญญา §5.1 (แท็บรายงานวนอ่านแบบ rows)
        $usersByRole = [
            ['role' => 'member', 'count' => (int) ($roleCounts['members'] ?? 0)],
            ['role' => 'trainer', 'count' => (int) ($roleCounts['trainers'] ?? 0)],
            ['role' => 'admin', 'count' => (int) ($roleCounts['admins'] ?? 0)],
        ];

        $totals = [
            'bookings' => array_sum(array_map(static fn(array $row): int => $row['total'], $bookingsByMonth)),
            'income' => array_sum(array_map(static fn(array $row): float => $row['amount'], $incomeByMonth)),
            'paymentsSubmitted' => array_sum(array_map(static fn(array $row): int => $row['submitted'], $paymentsByMonth)),
            'paymentsApproved' => array_sum(array_map(static fn(array $row): int => $row['approved'], $paymentsByMonth)),
            'paymentsRejected' => array_sum(array_map(static fn(array $row): int => $row['rejected'], $paymentsByMonth)),
            'users' => array_sum(array_map(static fn(array $row): int => $row['count'], $usersByRole)),
        ];

        Http::json([
            'year' => $year,
            'bookingsByMonth' => array_values($bookingsByMonth),
            'incomeByMonth' => array_values($incomeByMonth),
            'paymentsByMonth' => array_values($paymentsByMonth),
            'usersByRole' => $usersByRole,
            'totals' => $totals,
        ]);
    }

    private static function reportYear(mixed $value): int
    {
        if ($value === null || $value === '') {
            return (int) gmdate('Y');
        }
        if (is_array($value) || preg_match('/^\d{4}$/', (string) $value) !== 1) {
            throw new HttpException(422, 'ปีของรายงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['year' => 'ใช้ปี ค.ศ. 4 หลัก']);
        }
        $year = (int) $value;
        if ($year < 2000 || $year > 2100) {
            throw new HttpException(422, 'ปีของรายงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['year' => 'ใช้ปีระหว่าง 2000 ถึง 2100']);
        }
        return $year;
    }

    /** @return array<int, string> twelve `YYYY-MM` keys in month order. */
    private static function monthKeys(int $year): array
    {
        $months = [];
        for ($month = 1; $month <= 12; $month++) {
            $months[] = sprintf('%04d-%02d', $year, $month);
        }
        return $months;
    }

    public function createAdminUser(): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $input = Http::body();
        Http::requireFields($input, ['displayName', 'email', 'password']);
        $displayName = trim(Http::stringField($input, 'displayName'));
        $email = strtolower(trim(Http::stringField($input, 'email')));
        $password = Http::stringField($input, 'password');
        // A missing key is a notice in the log; normalizeAdminPermissions()
        // already treats a non-array as "no permission granted".
        $permissions = $this->normalizeAdminPermissions($input['permissions'] ?? null);
        $this->assertAssignablePermissions($this->adminPermissions((int) $admin['id']), $permissions);
        $fields = [];
        if ($displayName === '') $fields['displayName'] = 'กรุณาระบุชื่อที่แสดง';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $fields['email'] = 'อีเมลไม่ถูกต้อง';
        if (mb_strlen($password) < 8) $fields['password'] = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
        if (!in_array(true, $permissions, true)) $fields['permissions'] = 'เลือกสิทธิ์อย่างน้อย 1 รายการ';
        if ($fields !== []) throw new HttpException(422, 'ข้อมูลผู้ดูแลระบบไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        if ($this->database->fetchOne('SELECT id FROM users WHERE email = ?', [$email])) {
            throw new HttpException(409, 'อีเมลนี้ถูกใช้งานแล้ว', 'EMAIL_EXISTS', ['email' => 'อีเมลนี้ถูกใช้งานแล้ว']);
        }
        $id = $this->database->transaction(function (PDO $pdo) use ($admin, $displayName, $email, $password, $permissions): int {
            $permissionStatement = $pdo->prepare(
                'SELECT manage_users, review_trainers, manage_bookings, review_payments
                 FROM admin_permissions WHERE user_id = ? FOR UPDATE'
            );
            $permissionStatement->execute([(int) $admin['id']]);
            $callerPermissions = $this->adminPermissionsFromRow($permissionStatement->fetch() ?: []);
            if (!$callerPermissions['manageUsers']) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $this->assertAssignablePermissions($callerPermissions, $permissions);
            $pdo->prepare('INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, "admin", "active")')
                ->execute([$email, password_hash($password, PASSWORD_DEFAULT), $displayName]);
            $id = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO admin_permissions (user_id, manage_users, review_trainers, manage_bookings, review_payments) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, (int) $permissions['manageUsers'], (int) $permissions['reviewTrainers'], (int) $permissions['manageBookings'], (int) $permissions['reviewPayments']]);
            return $id;
        });
        Http::json(['id' => $id, 'displayName' => $displayName, 'email' => $email, 'role' => 'admin', 'status' => 'active', 'permissions' => $permissions], 201);
    }

    public function updateAdminUser(string $userId): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $input = Http::body();
        $target = $this->database->fetchOne('SELECT id, email, display_name, role, status FROM users WHERE id = ?', [(int) $userId]);
        if (!$target) throw new HttpException(404, 'ไม่พบบัญชีผู้ใช้', 'USER_NOT_FOUND');
        $displayName = array_key_exists('displayName', $input) ? trim(Http::stringField($input, 'displayName')) : (string) $target['display_name'];
        $email = array_key_exists('email', $input) ? strtolower(trim(Http::stringField($input, 'email'))) : (string) $target['email'];
        $status = array_key_exists('status', $input) ? Http::stringField($input, 'status') : (string) $target['status'];
        $fields = [];
        if ($displayName === '') $fields['displayName'] = 'กรุณาระบุชื่อที่แสดง';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $fields['email'] = 'อีเมลไม่ถูกต้อง';
        if (!in_array($status, ['active', 'suspended'], true)) $fields['status'] = 'สถานะบัญชีไม่ถูกต้อง';
        if ($target['status'] === 'deleted' && $status !== 'deleted') $fields['status'] = 'บัญชีที่ลบแล้วไม่สามารถเปิดใช้งานใหม่';
        if ((int) $target['id'] === (int) $admin['id'] && $status !== 'active') $fields['status'] = 'ไม่สามารถระงับบัญชีที่กำลังใช้งาน';
        if ($fields !== []) throw new HttpException(422, 'ข้อมูลบัญชีไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        $duplicate = $this->database->fetchOne('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, (int) $target['id']]);
        if ($duplicate) throw new HttpException(409, 'อีเมลนี้ถูกใช้งานแล้ว', 'EMAIL_EXISTS', ['email' => 'อีเมลนี้ถูกใช้งานแล้ว']);
        $targetPermissions = $target['role'] === 'admin' ? $this->adminPermissions((int) $target['id']) : null;
        $permissions = null;
        if (array_key_exists('permissions', $input)) {
            if ($target['role'] !== 'admin') throw new HttpException(422, 'กำหนดสิทธิ์ได้เฉพาะผู้ดูแลระบบ', 'VALIDATION_FAILED');
            if ((int) $target['id'] === (int) $admin['id']) throw new HttpException(409, 'ไม่สามารถแก้สิทธิ์ของบัญชีที่กำลังใช้งาน', 'SELF_PERMISSION_CHANGE');
            $permissions = $this->normalizeAdminPermissions($input['permissions']);
            if (!in_array(true, $permissions, true)) throw new HttpException(422, 'เลือกสิทธิ์อย่างน้อย 1 รายการ', 'VALIDATION_FAILED');
            $this->assertAssignablePermissions($this->adminPermissions((int) $admin['id']), $permissions, $targetPermissions);
        }
        $this->database->transaction(function (PDO $pdo) use ($admin, $target, $displayName, $email, $status, $permissions): void {
            $permissionIds = [(int) $admin['id']];
            if ($target['role'] === 'admin' && (int) $target['id'] !== (int) $admin['id']) $permissionIds[] = (int) $target['id'];
            sort($permissionIds);
            $permissionPlaceholders = self::marks($permissionIds);
            $permissionStatement = $pdo->prepare(
                'SELECT user_id, manage_users, review_trainers, manage_bookings, review_payments
                 FROM admin_permissions WHERE user_id IN (' . $permissionPlaceholders . ')
                 ORDER BY user_id FOR UPDATE'
            );
            $permissionStatement->execute($permissionIds);
            $lockedPermissions = [];
            foreach ($permissionStatement->fetchAll() as $row) {
                $lockedPermissions[(int) $row['user_id']] = $this->adminPermissionsFromRow($row);
            }
            $callerPermissions = $lockedPermissions[(int) $admin['id']] ?? $this->adminPermissionsFromRow([]);
            if (!$callerPermissions['manageUsers']) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $lockedTargetPermissions = $lockedPermissions[(int) $target['id']] ?? $this->adminPermissionsFromRow([]);
            if ($permissions !== null) {
                $this->assertAssignablePermissions($callerPermissions, $permissions, $lockedTargetPermissions);
            }
            $removesUserManagement = $target['role'] === 'admin'
                && $lockedTargetPermissions['manageUsers']
                && ($status === 'suspended' || ($permissions !== null && !$permissions['manageUsers']));
            if ($removesUserManagement) {
                $managerStatement = $pdo->query(
                    'SELECT ap.user_id
                     FROM admin_permissions ap
                     JOIN users u ON u.id = ap.user_id
                     WHERE ap.manage_users = 1 AND u.status = "active"
                     FOR UPDATE'
                );
                $managerIds = array_map('intval', $managerStatement->fetchAll(PDO::FETCH_COLUMN));
                $remainingManagerIds = array_filter($managerIds, fn(int $id): bool => $id !== (int) $target['id']);
                if ($remainingManagerIds === []) {
                    throw new HttpException(409, 'ต้องมีผู้ดูแลระบบที่จัดการบัญชีได้อย่างน้อย 1 คน', 'LAST_USER_MANAGER');
                }
            }
            $pdo->prepare('UPDATE users SET display_name = ?, email = ?, status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$displayName, $email, $status, (int) $target['id']]);
            if ($permissions !== null) {
                $pdo->prepare('INSERT INTO admin_permissions (user_id, manage_users, review_trainers, manage_bookings, review_payments)
                               VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE manage_users = VALUES(manage_users), review_trainers = VALUES(review_trainers), manage_bookings = VALUES(manage_bookings), review_payments = VALUES(review_payments)')
                    ->execute([(int) $target['id'], (int) $permissions['manageUsers'], (int) $permissions['reviewTrainers'], (int) $permissions['manageBookings'], (int) $permissions['reviewPayments']]);
            }
            if ($status === 'suspended') {
                $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')->execute([(int) $target['id']]);
            }
        });
        Http::json(['id' => (int) $target['id'], 'displayName' => $displayName, 'email' => $email, 'role' => $target['role'], 'status' => $status, 'permissions' => $permissions]);
    }

    public function deleteUser(string $userId): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $target = $this->database->fetchOne(
            'SELECT id, role, status FROM users WHERE id = ?',
            [(int) $userId]
        );
        if (!$target || $target['status'] === 'deleted') {
            throw new HttpException(404, 'ไม่พบบัญชีผู้ใช้', 'USER_NOT_FOUND');
        }
        $this->database->transaction(function (PDO $pdo) use ($admin, $target): void {
            $permissionIds = [(int) $admin['id'], (int) $target['id']];
            sort($permissionIds);
            $permissionPlaceholders = self::marks($permissionIds);
            $permissionStatement = $pdo->prepare(
                'SELECT user_id, manage_users
                 FROM admin_permissions WHERE user_id IN (' . $permissionPlaceholders . ')
                 ORDER BY user_id FOR UPDATE'
            );
            $permissionStatement->execute($permissionIds);
            $lockedPermissions = [];
            foreach ($permissionStatement->fetchAll() as $row) {
                $lockedPermissions[(int) $row['user_id']] = (bool) $row['manage_users'];
            }
            if (!($lockedPermissions[(int) $admin['id']] ?? false)) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $targetManagesUsers = $target['role'] === 'admin' && ($lockedPermissions[(int) $target['id']] ?? false);
            $managerStatement = $pdo->query(
                'SELECT ap.user_id
                 FROM admin_permissions ap
                 JOIN users u ON u.id = ap.user_id
                 WHERE ap.manage_users = 1 AND u.status = "active"
                 FOR UPDATE'
            );
            $managerIds = array_map('intval', $managerStatement->fetchAll(PDO::FETCH_COLUMN));
            $remainingActiveManagers = count(array_filter(
                $managerIds,
                static fn(int $id): bool => $id !== (int) $target['id']
            ));
            UserAdminRules::assertDeletionAllowed(
                (int) $admin['id'],
                (int) $target['id'],
                $targetManagesUsers,
                $remainingActiveManagers
            );

            // The address is released so the person can register with it again.
            $pdo->prepare('UPDATE users SET status = "deleted", email = CONCAT("deleted-", id, "@deleted.invalid"), updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([(int) $target['id']]);
            $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')
                ->execute([(int) $target['id']]);
        });

        Http::json(['id' => (int) $target['id'], 'status' => 'deleted', 'deleted' => true]);
    }

    public function decideTrainer(string $trainerId, string $decision): never
    {
        $admin = $this->requireAdminPermission('review_trainers');
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $input = Http::body();
        $notificationIds = [];
        $result = $this->database->transaction(function (PDO $pdo) use ($trainerId, $decision, $input, $admin, &$notificationIds): array {
            $trainer = $this->database->fetchOne(
                'SELECT id, user_id, approval_status FROM trainer_profiles WHERE id = ? FOR UPDATE',
                [(int) $trainerId]
            );
            if (!$trainer) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
            }

            $note = trim(Http::stringField($input, 'note'));
            WorkflowRules::assertTrainerApplicationDecision(
                (string) $trainer['approval_status'],
                $decision,
                $note
            );
            $status = $decision === 'approve' ? 'approved' : 'rejected';
            $certificateStatus = $status === 'approved' ? 'verified' : 'rejected';

            $pdo->prepare(
                'UPDATE trainer_profiles
                 SET approval_status = ?, approval_note = ?, reviewed_by_user_id = ?,
                     reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ?'
            )->execute([$status, $note, $admin['id'], (int) $trainer['id']]);
            $pdo->prepare(
                'UPDATE trainer_certificates
                 SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP()
                 WHERE trainer_profile_id = ? AND status = "pending"'
            )->execute([$certificateStatus, $note, $admin['id'], (int) $trainer['id']]);

            $this->notify($pdo, $notificationIds, $status === 'approved' ? NotificationRules::TRAINER_APPLICATION_APPROVED : NotificationRules::TRAINER_APPLICATION_REJECTED, ['trainerUserId' => (int) $trainer['user_id'], 'reviewNote' => $note]);

            return ['trainerId' => (int) $trainer['id'], 'status' => $status];
        });
        $this->notifications->deliverByIds($notificationIds);

        Http::json($result);
    }

    public function adminReviewQueue(): never
    {
        // Payments settle through Stripe, so the queue holds trainer
        // applications only.
        $this->requireAdminPermission('review_trainers');
        $trainers = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.created_at, tp.is_demo, u.display_name, COUNT(tc.id) AS certificate_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN trainer_certificates tc ON tc.trainer_profile_id = tp.id
             WHERE tp.approval_status = "pending"
             GROUP BY tp.id ORDER BY tp.created_at ASC LIMIT 100'
        );
        $certificatesByTrainer = [];
        if ($trainers !== []) {
            $trainerIds = array_map(fn(array $row): int => (int) $row['id'], $trainers);
            $placeholders = self::marks($trainerIds);
            $certificates = $this->database->fetchAll(
                'SELECT id, trainer_profile_id, name, issuer, created_at
                 FROM trainer_certificates
                 WHERE trainer_profile_id IN (' . $placeholders . ')
                 ORDER BY created_at ASC, id ASC',
                $trainerIds
            );
            foreach ($certificates as $certificate) {
                $profileId = (int) $certificate['trainer_profile_id'];
                $certificatesByTrainer[$profileId][] = [
                    'id' => (int) $certificate['id'],
                    'name' => $certificate['name'],
                    'issuer' => $certificate['issuer'],
                    'submittedAt' => $this->iso($certificate['created_at']),
                    'fileUrl' => '/v1/admin/files/certificate/' . $certificate['id'],
                ];
            }
        }

        Http::json([
            'trainers' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'slug' => $row['slug'],
                'displayName' => $row['display_name'],
                'certificateCount' => (int) $row['certificate_count'],
                'certificates' => $certificatesByTrainer[(int) $row['id']] ?? [],
                'submittedAt' => $this->iso($row['created_at']),
                'demo' => (bool) $row['is_demo'],
            ], $trainers),
        ]);
    }

    public function adminFile(string $kind, string $recordId): never
    {
        if ($kind === 'payment') {
            $user = $this->auth->requireUser(['admin', 'trainer']);
            [$scope, $params] = PaymentRouting::scope($user);
            $record = $this->database->fetchOne('SELECT pay.slip_path AS file_path, pay.mime_type
                FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                WHERE pay.id = ? AND ' . $scope, [(int) $recordId, ...$params]);
        } elseif ($kind === 'certificate') {
            $this->requireAdminPermission('review_trainers');
            $record = $this->database->fetchOne('SELECT file_path, mime_type FROM trainer_certificates WHERE id = ?', [(int) $recordId]);
        } else {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        if (!$record) {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        $target = self::uploadPath((string) $record['file_path']);
        if ($target === null) {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        header('Content-Type: ' . $record['mime_type']);
        header('Content-Length: ' . filesize($target));
        header('Content-Disposition: inline; filename="fitconnect-' . $kind . '-' . (int) $recordId . '"');
        header('Cache-Control: private, no-store');
        readfile($target);
        exit;
    }

    private function requireAdminPermission(string $column): array
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        $key = match ($column) {
            'manage_users' => 'manageUsers',
            'review_trainers' => 'reviewTrainers',
            'manage_bookings' => 'manageBookings',
            'review_payments' => 'reviewPayments',
            default => throw new LogicException('Unknown administrator permission'),
        };
        if (!$permissions[$key]) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
        }
        return $admin;
    }

    private function adminPermissions(int $userId): array
    {
        $row = $this->database->fetchOne(
            'SELECT manage_users, review_trainers, manage_bookings, review_payments FROM admin_permissions WHERE user_id = ?',
            [$userId]
        ) ?? [];
        return $this->adminPermissionsFromRow($row);
    }

    private function adminPermissionsFromRow(array $row): array
    {
        return [
            'manageUsers' => (bool) ($row['manage_users'] ?? false),
            'reviewTrainers' => (bool) ($row['review_trainers'] ?? false),
            'manageBookings' => (bool) ($row['manage_bookings'] ?? false),
            'reviewPayments' => (bool) ($row['review_payments'] ?? false),
        ];
    }

    private function normalizeAdminPermissions(mixed $value): array
    {
        $input = is_array($value) ? $value : [];
        return [
            'manageUsers' => filter_var($input['manageUsers'] ?? false, FILTER_VALIDATE_BOOL),
            'reviewTrainers' => filter_var($input['reviewTrainers'] ?? false, FILTER_VALIDATE_BOOL),
            'manageBookings' => filter_var($input['manageBookings'] ?? false, FILTER_VALIDATE_BOOL),
            'reviewPayments' => filter_var($input['reviewPayments'] ?? false, FILTER_VALIDATE_BOOL),
        ];
    }

    private function assertAssignablePermissions(array $caller, array $requested, ?array $existing = null): void
    {
        foreach (array_keys($requested) as $key) {
            $currentValue = $existing[$key] ?? false;
            if (!$caller[$key] && $requested[$key] !== $currentValue) {
                throw new HttpException(403, 'กำหนดได้เฉพาะสิทธิ์ที่บัญชีของคุณมีอยู่', 'PERMISSION_DELEGATION_FORBIDDEN');
            }
        }
    }

    private function adminPage(string $key): int
    {
        $value = filter_var($_GET[$key] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        return $value === false ? 0 : min((int) $value, 100000);
    }
}
