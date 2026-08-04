# One-time data migrations

This project applies schema with `drizzle-kit push` (no generated migration
files), so one-off **data** backfills that must accompany a schema change live
here as hand-written, **idempotent, re-runnable** SQL. Each script is safe to
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
