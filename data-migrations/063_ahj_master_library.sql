-- 063_ahj_master_library.sql
-- AHJ Master Library: structured state/county on ahj_packs, master pack tables,
-- adoption ledger, and coverage projection link.

-- 1. Add structured state + county to ahj_packs (nullable; backfill below).
ALTER TABLE ahj_packs
  ADD COLUMN IF NOT EXISTS state  VARCHAR(2),
  ADD COLUMN IF NOT EXISTS county VARCHAR(255);

-- Backfill the three existing Virginia rows.
UPDATE ahj_packs
  SET state = 'VA', county = ''
  WHERE state IS NULL AND LOWER(jurisdiction) = 'virginia';

-- 2. AHJ master pack library — no company_id.
--    Unique on (state, county, pack_type, version); superseded_by_id forms the
--    version chain so older published versions are never mutated.
CREATE TABLE IF NOT EXISTS ahj_master_packs (
  id               VARCHAR       PRIMARY KEY DEFAULT gen_random_uuid(),
  state            VARCHAR(2)    NOT NULL,
  county           VARCHAR(255)  NOT NULL,
  pack_type        VARCHAR       NOT NULL,
  version          INTEGER       NOT NULL DEFAULT 1,
  items            JSONB         NOT NULL DEFAULT '[]'::jsonb,
  code_cycle       VARCHAR(100),
  superseded_by_id VARCHAR       REFERENCES ahj_master_packs(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by       VARCHAR       REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (state, county, pack_type, version)
);

-- 3. Adoption ledger — tracks which company adopted which master version,
--    and which company-scoped ahj_packs row was created for them.
CREATE TABLE IF NOT EXISTS ahj_master_adoptions (
  id              VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR     NOT NULL REFERENCES companies(id),
  master_pack_id  VARCHAR     NOT NULL REFERENCES ahj_master_packs(id),
  adopted_pack_id VARCHAR     NOT NULL REFERENCES ahj_packs(id),
  adopted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, master_pack_id)
);

-- 4. Link ahj_coverage rows to the master pack that backs them.
--    Nullable: coverage rows can exist before a master pack is promoted.
ALTER TABLE ahj_coverage
  ADD COLUMN IF NOT EXISTS master_pack_id VARCHAR REFERENCES ahj_master_packs(id);
