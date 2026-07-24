-- 009: Company-level forensic-report color palette (super_admin-configurable).
-- Null means the default palette. Values are strict #RRGGBB hex, validated
-- server-side at write time.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS report_branding jsonb DEFAULT NULL;
