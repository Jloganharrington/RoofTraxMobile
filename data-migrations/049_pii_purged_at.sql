-- Migration 049: add pii_purged_at to users
-- Set by the nightly termination sweep at 30 days post-deactivation.
-- Non-null = PII fields have been scrubbed (firstName, lastName, email, phone,
-- SMTP fields on user_profiles, and push tokens deleted).

ALTER TABLE users ADD COLUMN IF NOT EXISTS pii_purged_at timestamptz;
