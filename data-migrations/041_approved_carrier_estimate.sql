-- Migration 041: approved carrier estimate on pins
-- Stores the object-storage path and sha256 of the carrier-approved estimate
-- document required before a pin may advance to claim_approved.

ALTER TABLE pins ADD COLUMN IF NOT EXISTS approved_estimate_object_path TEXT;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS approved_estimate_sha256       TEXT;
