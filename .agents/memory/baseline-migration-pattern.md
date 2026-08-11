---
name: Schema baseline and migration pattern
description: How 000_baseline.sql was generated, verified, and what the numbered-migration rule means for this project.
---

# Schema baseline and numbered-migration rule

## The rule
Every new table, view, enum, or structural column addition must have a numbered SQL migration file
in `data-migrations/NNN_<name>.sql` with idempotent DDL (`CREATE TABLE IF NOT EXISTS`, etc.).
`drizzle-kit push` is no longer run on merge — it requires an interactive TTY for conflict resolution.
Without a numbered migration, the schema object exists in `lib/db/src/schema/` but never reaches
the live database.

**Reference failure:** `052_stage_transitions.sql` — `stage_transitions` table and 4 `pins` columns
were in the Drizzle schema but never pushed. Every pipeline-advance route failed until 052 was
written and applied manually.

## 000_baseline.sql (2026-08-11)
- **Location:** `data-migrations/000_baseline.sql` (1324 lines) — user-facing reference with header comment
- **Source:** `cd lib/db && npx drizzle-kit generate --name baseline` → generates `lib/db/drizzle/0000_baseline.sql` (1312 lines); Drizzle now tracks this as migration 0000
- **Verification:** Applied to a temp Postgres database, then `pg_dump --schema-only` of both databases sorted and diffed → zero DDL differences. Only `\restrict`/`\unrestrict` Replit mTLS tokens differed (session-specific, not schema).
- **Table count:** 73 tables in both live and temp databases.

## What drizzle-kit generate produced
- First-time run: no prior migration files existed in `lib/db/drizzle/`; the meta snapshot already described the full schema.
- The generated SQL captures the complete DDL for all 73 tables, indexes, and constraints.
- Future `drizzle-kit generate` calls will produce incremental diffs from this baseline.

## Applying the baseline to a new database
```bash
psql "$DATABASE_URL" -f data-migrations/000_baseline.sql
# Then apply any data/structural migrations needed for the environment
psql "$DATABASE_URL" -f data-migrations/052_stage_transitions.sql  # idempotent, safe to re-run
```

**Why:**
- `drizzle-kit push` cannot run non-interactively; baseline.sql is the non-interactive equivalent for fresh databases.
- The numbered-migration rule prevents silent schema drift between merges.
