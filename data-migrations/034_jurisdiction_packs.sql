-- Building Regulation Jurisdiction Packs: replaces company_state_packs.
-- Applied 2026-07-30 (dev). Homeowner-rights content and old citations were
-- intentionally discarded; UPPA text carried over as one statewide pack.
CREATE TABLE IF NOT EXISTS company_jurisdiction_packs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id),
  jurisdiction varchar(120) NOT NULL,
  state varchar(2) NOT NULL,
  opening_statements jsonb NOT NULL DEFAULT '[]'::jsonb,
  uppa_law varchar,
  uppa_statement varchar,
  general_code_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  roofing_code_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  siding_code_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_jurisdiction_packs_company_jurisdiction_idx
  ON company_jurisdiction_packs (company_id, jurisdiction);
INSERT INTO company_jurisdiction_packs (company_id, jurisdiction, state, uppa_law, uppa_statement)
SELECT company_id, 'State of ' || state, state, uppa_statute, uppa_disclaimer
FROM company_state_packs
ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS company_state_packs;
