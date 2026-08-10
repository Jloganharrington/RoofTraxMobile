# One-time data migrations

## Applying schema changes

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
