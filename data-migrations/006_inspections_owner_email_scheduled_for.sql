-- Add owner_email and scheduled_for to the inspections table.
-- owner_email: contact address for the homeowner, captured at scheduling time
--   so appointment notifications and Phase 2 comms can be sent without
--   requiring a separate contacts record.
-- scheduled_for: the rep-chosen date for the Phase 2 (forensic) inspection,
--   persisted here so it survives between sessions and can be shown in list views.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS owner_email   text,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
