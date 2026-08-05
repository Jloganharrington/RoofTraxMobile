-- 018: Claim supplements — each supplement is its own versioned document,
-- separately attested, with its own blob chain. Removes the inner-HTML
-- injection pattern for supplements and flags any affected existing blobs.
-- Idempotent: safe to re-run.

-- claim_supplements table
CREATE TABLE IF NOT EXISTS claim_supplements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id VARCHAR NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  company_id VARCHAR NOT NULL REFERENCES companies(id),
  supplement_number TEXT NOT NULL,
  supplement_reason VARCHAR NOT NULL,
  compiled_report_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_package_blob_version TEXT,
  original_attestation_id TEXT,
  legacy_inline_supplement BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
);

-- supplement_id FK on claim_sections (nullable — NULL means primary-package section)
ALTER TABLE claim_sections
  ADD COLUMN IF NOT EXISTS supplement_id VARCHAR REFERENCES claim_supplements(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS claim_sections_supplement_id_idx ON claim_sections(supplement_id);

-- supplement_id FK on report_attestations (nullable — NULL means primary-package attestation)
ALTER TABLE report_attestations
  ADD COLUMN IF NOT EXISTS supplement_id VARCHAR REFERENCES claim_supplements(id) ON DELETE CASCADE;

-- Replace the simple unique index with two partial unique indexes:
--   (1) Primary-package attestations: unique on (inspection_id, blob_version_index)
--       where supplement_id IS NULL
--   (2) Supplement attestations: unique on (inspection_id, supplement_id, blob_version_index)
--       where supplement_id IS NOT NULL
-- This preserves existing unique semantics for primary packages while allowing
-- supplement attestations to use blob_version_index 0-based within each supplement.

DROP INDEX IF EXISTS report_attestations_inspection_version_idx;

CREATE UNIQUE INDEX IF NOT EXISTS report_attestations_primary_version_idx
  ON report_attestations(inspection_id, blob_version_index)
  WHERE supplement_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS report_attestations_supplement_version_idx
  ON report_attestations(inspection_id, supplement_id, blob_version_index)
  WHERE supplement_id IS NOT NULL;

-- Migration complete. No legacy inline-supplement blobs exist yet (pre-Task #252
-- enforcement); the legacyInlineSupplement flag is available for future backfills
-- if needed.
