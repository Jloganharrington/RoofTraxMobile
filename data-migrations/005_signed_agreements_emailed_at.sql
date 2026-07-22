-- Migration 005: emailed_at for signed_agreements
--
-- Tracks when the server successfully emailed the signed agreement PDF to the
-- homeowner. Nullable — null means the agreement has never been emailed via
-- server-side SMTP. The column is informational (delivery trail); no indexes
-- are needed.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE signed_agreements
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;
