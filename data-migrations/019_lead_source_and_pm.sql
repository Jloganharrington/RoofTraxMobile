-- Migration 019: lead source + project manager fields
-- Adds external_lead_source and project_manager_name to pins,
-- and lead_sources jsonb config to companies.

ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS external_lead_source varchar,
  ADD COLUMN IF NOT EXISTS project_manager_name varchar;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS lead_sources jsonb DEFAULT NULL;
