-- Task 250: Backfill comparison_set_captions rows for existing pairs
-- Every inspection_comparison_pairs row must have exactly one
-- comparison_set_captions row so caption generation and the lock gate
-- can find it.  This is idempotent: it only inserts rows where none exist.
--
-- Applied manually: psql $DATABASE_URL -f data-migrations/018_backfill_comparison_set_captions.sql

INSERT INTO comparison_set_captions (
  id,
  inspection_id,
  company_id,
  comparison_pair_id,
  caption_text,
  state,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.inspection_id,
  p.company_id,
  p.id,
  NULL,
  'pending',
  NOW(),
  NOW()
FROM inspection_comparison_pairs p
WHERE NOT EXISTS (
  SELECT 1
  FROM comparison_set_captions sc
  WHERE sc.comparison_pair_id = p.id
);
