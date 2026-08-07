-- =============================================================================
-- Migration 031 — change_orders.emailed_at
-- =============================================================================
-- Adds the emailed_at timestamptz column to change_orders so that the approve
-- route can stamp when a signed PDF was successfully emailed to the homeowner.
-- The column was present in the Drizzle schema (lib/db) from the Step 4 work
-- but was never applied via a DDL migration.  A fresh database provisioned from
-- migrations (rather than drizzle-push) would be missing this column, causing
-- any select or update that references emailed_at to fail at runtime.
-- =============================================================================

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
