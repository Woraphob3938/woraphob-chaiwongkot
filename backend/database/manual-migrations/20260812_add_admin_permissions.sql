CREATE TABLE IF NOT EXISTS admin_permissions (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  manage_users TINYINT(1) NOT NULL DEFAULT 0,
  review_trainers TINYINT(1) NOT NULL DEFAULT 0,
  manage_bookings TINYINT(1) NOT NULL DEFAULT 0,
  review_payments TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO admin_permissions
  (user_id, manage_users, review_trainers, manage_bookings, review_payments)
SELECT id, 1, 1, 1, 1
FROM users
WHERE role = 'admin'
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);
