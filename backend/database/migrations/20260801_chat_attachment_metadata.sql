USE fitconnect;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100) NULL AFTER attachment_path,
  ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255) NULL AFTER attachment_mime,
  ADD COLUMN IF NOT EXISTS attachment_size INT UNSIGNED NULL AFTER attachment_name;
