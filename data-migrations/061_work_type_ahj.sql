-- Migration 061: work_type_ahj
-- Adds work type and trade type columns to companies and pp_pending_registrations.
-- Creates ahj_requests table for pending AHJ coverage requests.

-- Companies: work type and trade types (set during or after PP registration)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_type  TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_types JSONB;

-- PP Pending registrations: capture work type, trade types, and AHJ selection
-- before the company row is provisioned.
ALTER TABLE pp_pending_registrations ADD COLUMN IF NOT EXISTS work_type               TEXT;
ALTER TABLE pp_pending_registrations ADD COLUMN IF NOT EXISTS trade_types             JSONB;
ALTER TABLE pp_pending_registrations ADD COLUMN IF NOT EXISTS ahj_coverage_id         TEXT REFERENCES ahj_coverage(id) ON DELETE SET NULL;
ALTER TABLE pp_pending_registrations ADD COLUMN IF NOT EXISTS ahj_request_jurisdiction TEXT;

-- AHJ requests — stores free-text jurisdiction requests from PP subscribers
-- whose AHJ is not yet in the covered list.
CREATE TABLE IF NOT EXISTS ahj_requests (
  id                       TEXT        PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  company_id               TEXT        REFERENCES companies(id) ON DELETE SET NULL,
  pending_registration_id  TEXT        REFERENCES pp_pending_registrations(id) ON DELETE SET NULL,
  jurisdiction_text        TEXT        NOT NULL,
  state                    TEXT,
  county                   TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
