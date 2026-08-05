---
name: Pipeline schema migrations
description: Columns and tables added by the pipeline rebuild that must be manually applied when the DB is out of sync
---

# Pipeline Schema Migrations

## What
The pipeline rebuild (Tasks #205–208) added new columns to `pins` and created `stage_transitions`, but these were never applied to the database via Drizzle push or DDL.

## Missing columns (now applied)
These four columns were added to `pinsTable` in the schema but were absent from the DB, causing 500 errors on all three pipeline endpoints:
- `stage_entered_at` (timestamptz)
- `loop_next_action_at` (timestamptz)
- `loss_reason` (varchar)
- `source_pipeline` (varchar)

## Missing table (now applied)
`stage_transitions` — stores every pipeline stage advance. Referenced by `advancePinStage()` in `pipelineEvents.ts`.

**Why:** Drizzle `push` can't run non-interactively against unique constraints (TTY prompt blocks it). These columns were applied manually via `executeSql`.

**How to apply:** If the DB ever needs to be reset, run:
```sql
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS loop_next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS loss_reason varchar,
  ADD COLUMN IF NOT EXISTS source_pipeline varchar;

CREATE TABLE IF NOT EXISTS stage_transitions (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      varchar NOT NULL,
  from_stage   varchar,
  to_stage     varchar NOT NULL,
  trigger      varchar NOT NULL,
  task_payload jsonb,
  user_id      varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead_id
  ON stage_transitions (lead_id, created_at DESC);
```
