-- Waitlist signups: separate from `codescout` auth accounts.
-- Run against the same MySQL instance your public waitlist API uses.

CREATE TABLE IF NOT EXISTS codescout_waitlist (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email_normalized VARCHAR(320) NOT NULL COMMENT 'lowercased, trimmed',
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  source           VARCHAR(64) NULL COMMENT 'e.g. utm_campaign or ref slug',
  landing_path     VARCHAR(512) NULL,
  consent_text     VARCHAR(512) NOT NULL COMMENT 'exact checkbox label user agreed to',
  consent_version  VARCHAR(32)  NOT NULL COMMENT 'bump when copy changes',
  consent_at       DATETIME(3)  NOT NULL,
  confirm_token_hash   CHAR(64) NULL COMMENT 'hash of token; NULL if not used',
  confirmed_at         DATETIME(3) NULL,
  invited_at       DATETIME(3) NULL,
  unsubscribed_at  DATETIME(3) NULL,
  admin_note       VARCHAR(512) NULL,
  UNIQUE KEY uq_waitlist_email (email_normalized),
  KEY idx_waitlist_created (created_at),
  KEY idx_waitlist_invited (invited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
