-- Estimate builder with waste calculator
-- Adds the persisted estimate to inspections and the billing-unit label to
-- price book items.
-- Idempotent: IF NOT EXISTS guards make this safe to re-run.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS estimate jsonb;

ALTER TABLE price_book_items
  ADD COLUMN IF NOT EXISTS unit varchar(60);
