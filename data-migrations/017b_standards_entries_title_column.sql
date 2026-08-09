-- Migration 017: Add title column to standards_entries; split entry_key on ' — '
-- The entry_key column previously conflated the short key and full label.
-- After this migration:
--   entry_key  = short key only  (e.g. 'STD-WTR-01')
--   title      = full label text (e.g. 'IICRC S500 Standard for Professional Water Damage Restoration')
-- Existing rows whose entry_key contains ' — ' are split automatically.
-- Rows without ' — ' keep their entry_key unchanged and get NULL title.

BEGIN;

-- 1. Add title column.
ALTER TABLE standards_entries
  ADD COLUMN IF NOT EXISTS title text;

-- 2. Populate title from the suffix after ' — ', then trim entry_key to the prefix.
UPDATE standards_entries
SET
  title     = CASE WHEN entry_key LIKE '% — %'
                   THEN TRIM(SPLIT_PART(entry_key, ' — ', 2))
                   ELSE NULL
              END,
  entry_key = CASE WHEN entry_key LIKE '% — %'
                   THEN TRIM(SPLIT_PART(entry_key, ' — ', 1))
                   ELSE entry_key
              END
WHERE entry_key LIKE '% — %';

-- 3. Flag the IICRC water-damage entries as human-entered-provisions-only.
UPDATE standards_entries
SET human_entered_provisions_only = true
WHERE entry_key IN ('STD-WTR-01', 'STD-WTR-02');

COMMIT;
