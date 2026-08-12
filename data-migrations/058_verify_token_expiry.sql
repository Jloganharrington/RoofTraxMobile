-- Migration 058: Add verify_token_expires_at to users
-- The PP verification email link should expire (24-hour window).
-- Previously only verify_token was stored with no expiry.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verify_token_expires_at TIMESTAMPTZ;
