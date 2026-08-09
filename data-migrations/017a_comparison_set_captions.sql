-- Task 250: Add three-caption structure to comparison pair exhibits
-- Creates the comparison_set_captions table that holds the pair-level
-- set caption alongside the two per-photo captions for Class C exhibits.
--
-- Applied manually: psql $DATABASE_URL -f data-migrations/017a_comparison_set_captions.sql

CREATE TABLE IF NOT EXISTS comparison_set_captions (
  id                VARCHAR      PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id     VARCHAR      NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  company_id        VARCHAR      NOT NULL REFERENCES companies(id),
  comparison_pair_id VARCHAR      NOT NULL REFERENCES inspection_comparison_pairs(id) ON DELETE CASCADE,
  caption_text      TEXT,
  state             VARCHAR      NOT NULL DEFAULT 'pending',
  generated_at      TIMESTAMPTZ,
  locked_at         TIMESTAMPTZ,
  locked_by         VARCHAR      REFERENCES users(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
