-- Add mime_type and original_file_name to inspection_photos
-- Needed so uploaded PDF documents can be identified and named
-- when assembling the compiled Proof Package.
--
-- mime_type: NULL for mobile-captured photos (never set at capture time);
--   set to 'application/pdf' / 'image/jpeg' / 'image/png' for PP portal uploads.
-- original_file_name: the upload-time filename provided by the browser, stored
--   so the rendered package can display a user-friendly attachment name.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE inspection_photos
  ADD COLUMN IF NOT EXISTS mime_type       varchar,
  ADD COLUMN IF NOT EXISTS original_file_name  varchar(255);

COMMIT;
