-- Company Templates: metadata for document templates stored in object storage.
-- Admins and super admins can store, replace, and delete templates per company.
-- Raw files live in object storage; this table tracks metadata and object path.
CREATE TABLE IF NOT EXISTS company_templates (
  id             varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     varchar      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text         NOT NULL,
  object_path    text         NOT NULL,
  mime_type      text         NOT NULL,
  use_case       text         NOT NULL,
  original_filename text      NOT NULL,
  uploaded_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- Exactly one template per real use-case slot per company.
-- 'other' is exempt — unlimited 'other' templates allowed.
CREATE UNIQUE INDEX IF NOT EXISTS company_templates_company_use_case_unique
  ON company_templates (company_id, use_case)
  WHERE use_case <> 'other';
