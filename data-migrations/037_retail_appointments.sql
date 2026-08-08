-- Retail appointment scheduling — promote appointmentDate out of jsonb (migration 037).
-- Applied 2026-08-08.
--
-- Adds three columns to pins:
--   appointment_at          timestamptz  — the scheduled time
--   appointment_assigned_to varchar      — FK → users(id), nullable
--   appointment_status      varchar      — scheduled | completed | canceled | no_show
--
-- Index on (company_id, appointment_at) so the calendar feed never table-scans.
--
-- Backfill: reads retailData.appointmentDate (free-text string inserted by the
-- mobile app) and attempts to parse it as a timestamp.  Unparseable values are
-- silently skipped.  Running this migration twice produces no duplicates because
-- the DO block only touches rows whose appointment_at IS NULL.

ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS appointment_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appointment_assigned_to VARCHAR REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS appointment_status      VARCHAR;

CREATE INDEX IF NOT EXISTS idx_pins_company_appointment_at
  ON pins (company_id, appointment_at)
  WHERE appointment_at IS NOT NULL;

-- Defensive backfill: iterate rows with a non-null retailData.appointmentDate
-- and skip anything that PostgreSQL cannot cast to TIMESTAMPTZ.
-- Idempotency: WHERE appointment_at IS NULL ensures a second run is a no-op
-- for rows already backfilled.
DO $$
DECLARE
  r         RECORD;
  parsed_ts TIMESTAMPTZ;
BEGIN
  FOR r IN
    SELECT id,
           retail_data->>'appointmentDate' AS raw_date
    FROM   pins
    WHERE  retail_data->>'appointmentDate' IS NOT NULL
      AND  appointment_at IS NULL
  LOOP
    BEGIN
      parsed_ts := r.raw_date::TIMESTAMPTZ;
      UPDATE pins
         SET appointment_at     = parsed_ts,
             appointment_status = 'scheduled'
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- Malformed date string — skip, leave appointment_at NULL
      NULL;
    END;
  END LOOP;
END;
$$;
