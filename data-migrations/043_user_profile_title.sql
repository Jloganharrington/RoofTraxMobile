-- Migration 043: signer title on user_profiles
--
-- Completion certificates include a signer title line (e.g. "Project Manager",
-- "Account Executive").  The field is optional and may be supplied per-sign
-- via the sign-endpoint body; the stored column is used as the default fallback.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS title TEXT;
