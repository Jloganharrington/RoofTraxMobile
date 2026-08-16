# One-time data migrations

## Adding a new table or structural DDL change

> **Rule: every new table, view, enum, or structural column addition requires a
> numbered migration file in this directory.**

`drizzle-kit push` is no longer run automatically on merge (see below). That
means schema objects added in `lib/db/src/schema/` will **not** reach the live
database unless a corresponding numbered SQL migration is also created and
applied manually.

**How to add a new table:**

1. Define the table in `lib/db/src/schema/` as usual.
2. Create `data-migrations/NNN_<feature>.sql` with idempotent DDL:
   ```sql
   CREATE TABLE IF NOT EXISTS "my_new_table" ( ... );
   CREATE INDEX IF NOT EXISTS my_idx ON my_new_table ( ... );
   ```
3. Add the script to the `## Scripts` list in this README.
4. Apply it to dev: `psql "$DATABASE_URL" -f data-migrations/NNN_<feature>.sql`
5. Apply it to production via the Replit Database tool
   (`environment: "production"`) before or alongside your merge.

The reference example is `052_stage_transitions.sql`: the `stage_transitions`
table and four `pins` columns existed in the Drizzle schema but were never
pushed. Every pipeline-advance route and test failed until the numbered migration
was written and applied manually.

---

## Provisioning a fresh database

`000_baseline.sql` is a complete `pg_dump --schema-only` snapshot of the live
database taken on 2026-08-11. It includes all 73 tables with correct column
types and defaults, all indexes (non-partial and partial, with predicates), all
foreign keys, the `pin_profitability` view, and the `_parse_legacy_money_cents`
function.

**Migrations 001–040 are embedded in the baseline.** Do not run them against a
database provisioned from this file — they predate the snapshot and their DDL
is already reflected in it.

**Apply these migrations on top of the baseline, in order:**

```bash
psql "$DATABASE_URL" -f data-migrations/000_baseline.sql

psql "$DATABASE_URL" -f data-migrations/041_approved_carrier_estimate.sql
psql "$DATABASE_URL" -f data-migrations/042_completion_certificates.sql
psql "$DATABASE_URL" -f data-migrations/043_user_profile_title.sql
psql "$DATABASE_URL" -f data-migrations/044_pin_financial_changes.sql
psql "$DATABASE_URL" -f data-migrations/045_manager_user_id.sql
psql "$DATABASE_URL" -f data-migrations/046_user_permission_overrides.sql
psql "$DATABASE_URL" -f data-migrations/047_deactivated_at.sql
psql "$DATABASE_URL" -f data-migrations/048_pins_user_restrict.sql
psql "$DATABASE_URL" -f data-migrations/049_pii_purged_at.sql
psql "$DATABASE_URL" -f data-migrations/050_deactivation_sweep_log.sql
psql "$DATABASE_URL" -f data-migrations/051_permission_override_changes.sql
psql "$DATABASE_URL" -f data-migrations/052_stage_transitions.sql
```

All migrations 041–052 use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
`CREATE OR REPLACE` throughout, so they are safe to run against a database
provisioned from the baseline (all become no-ops for objects already captured
in the snapshot). Each new numbered migration added after 052 should also be
applied in sequence.

**Round-trip verification (2026-08-11):**
A scratch database was provisioned from `000_baseline.sql` plus migrations
041–052 in the order above, then its `pg_dump --schema-only` was diffed against
the live database. The only diff lines were:

- `\restrict` / `\unrestrict` — Replit mTLS session tokens injected by the
  database proxy; they change every connection and carry no schema information.
- `user_profiles_theme_check` — PostgreSQL serializes the same
  `ANY(ARRAY[...::character varying])` expression in two equivalent textual
  forms on a pg_dump round-trip (`ARRAY['x'::varchar]` vs
  `ARRAY[('x'::varchar)::text]`). `pg_get_constraintdef()` on both databases
  confirms the stored logic is identical. This is a known Postgres
  serialization artifact, not a real schema difference.

Zero structural differences.

---

## Applying schema changes (drizzle-kit push)

Schema changes live in `lib/db/src/schema/` and are applied manually via
`drizzle-kit push`. **This step is not run automatically on merge** — it was
removed from `scripts/post-merge.sh` because drizzle-kit's interactive TTY
prompt for new unique constraints cannot be answered in a non-interactive merge
environment, and a silent failure would leave the database out of sync with no
indication.

**When to run it:** after merging any task-agent branch that modifies
`lib/db/src/schema/`, or after editing schema yourself.

**Command (dev database):**
```bash
cd lib/db && npx drizzle-kit push
```

**Command (production database):** use the Replit Database tool with
`environment: "production"`, or set `DATABASE_URL` to the production connection
string before running the command above.

**Unique-constraint caveat:** if the push adds a new unique constraint,
drizzle-kit v0.x pauses and asks whether to truncate the table. Answer `n`
(no truncation) unless you are certain the table is empty or has no conflicts.
If running non-interactively, apply the DDL directly with `psql` matching the
constraint definition from `lib/db/src/schema/` instead.

**Task agents:** if a task agent's work includes a schema change, the
post-merge reconciliation script rebuilds `lib/authz` and `lib/db`
declarations but does NOT push schema. You must run `drizzle-kit push` manually
after approving and merging the agent's branch.

---

This project uses one-off **data** backfills that must accompany certain schema
changes. These live here as hand-written, **idempotent, re-runnable** SQL. Each script is safe to
run more than once and safe to run against a database that already has the
fix applied (it becomes a no-op).

Run each against the target database (dev or production) and confirm the
before/after counts, e.g. via the database tooling or `psql`:

```
psql "$DATABASE_URL" -f data-migrations/001_backfill_object_ownership.sql
```

## Scripts

- **001_backfill_object_ownership.sql** — CRITICAL. The object ACL 404s any
  stored file that has no `object_ownership` row. Ownership rows are only
  written when an upload URL is issued, so every file uploaded *before* the
  ownership table existed 404s. This backfills a row for every stored object
  path found in `pins.photo_url` and `inspection_photos.url`.
  - Assumes servable URLs of the form `.../storage/objects/<entityId>`, which
    maps to the stored `object_path` `/objects/<entityId>`. **Verify the
    production `photo_url` format matches before running** — if legacy rows use
    a different shape, extend the `WHERE`/derivation accordingly.
- **002_workflow_assignment_insurance_retail.sql** — collapses the retired
  `'both'` / `'insurance'` workflow-assignment values into `'insurance_retail'`
  so those users keep the workflow picker.
- **003_seed_founder_super_admin.sql** — promotes each company's founder
  (`companies.founder_user_id`) to `super_admin`, but only when the company has
  no super_admin yet (breaks the chicken-and-egg where only a super_admin can
  promote anyone). Creates the founder's profile row first if it is missing.
- **015_project_pipeline_stage_key_rename.sql** — remaps pins stuck in the old
  project pipeline stage vocabulary (work_scheduled, work_started,
  replacement_complete, certificate_of_completion, final_payment_pending,
  final_payment_received, archived_complete) to their equivalent new keys so
  they reappear on the Project Pipeline board.
- **016_retail_pipeline_stage_key_rename.sql** — remaps pins stuck in the old
  retail pipeline stage vocabulary (contact_made, appt_confirmed,
  estimate_provided, followup_required, contract_sent) to their equivalent new
  keys (appt_needed, appt_complete, proposal_provided, follow_up,
  contract_pending) so they reappear on the Retail Pipeline board.
- **066_workflow_assignment_insurance.sql** — adds `'insurance'` to the
  `user_profiles.workflow_assignment` check constraint, enabling a
  Canvasser – Insurance persona (insurance-only canvassers). Existing
  `'retail'` and `'insurance_retail'` rows are untouched; the default
  remains `'insurance_retail'`.
- **052_stage_transitions.sql** — creates the `stage_transitions` table and
  adds four staging columns to `pins` (`stage_entered_at`, `loop_next_action_at`,
  `loss_reason`, `source_pipeline`). These were defined in the Drizzle schema
  by the pipeline rebuild but never applied to the live database. Without this,
  `advancePinStage()` and `emitPipelineEvent()` fail with "relation does not
  exist", breaking every pipeline-advance route and all
  `pipeline-auto-advance.test.ts` tests. All statements are idempotent.
