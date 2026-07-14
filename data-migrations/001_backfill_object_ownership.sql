-- FIX-1 (CRITICAL): backfill object_ownership for pre-existing stored files.
--
-- The object ACL denies (404) any object path without an object_ownership row.
-- Rows are only created when an upload URL is issued, so files uploaded before
-- the ownership table existed have no row and can never be read back. This
-- creates the missing rows from the object paths already recorded in the app's
-- URL columns.
--
-- Servable URLs have the form `<host>/storage/objects/<entityId>`, which the
-- ACL looks up as object_path `/objects/<entityId>`. The extraction takes the
-- text after `/storage/objects/` and strips any `?query` / `#fragment` so the
-- derived object_path matches exactly what the ACL computes. The `_%` guard +
-- non-empty check skip rows with nothing after the marker. Idempotent via the
-- primary-key ON CONFLICT DO NOTHING, so re-running only adds still-missing
-- rows and never overwrites an existing owner.
--
-- NOTE: this assumes the canonical URL shape above. Verify the production
-- photo_url values before running; if legacy rows use a different shape,
-- extend the derivation to cover them.

-- Pin photos.
INSERT INTO object_ownership (object_path, user_id, company_id, created_at)
SELECT
  '/objects/' || split_part(split_part(split_part(p.photo_url, '/storage/objects/', 2), '?', 1), '#', 1),
  p.user_id,
  p.company_id,
  p.created_at
FROM pins p
WHERE p.photo_url LIKE '%/storage/objects/_%'
  AND split_part(split_part(split_part(p.photo_url, '/storage/objects/', 2), '?', 1), '#', 1) <> ''
ON CONFLICT (object_path) DO NOTHING;

-- Inspection photos (audited as the other column holding /storage/objects/
-- paths). No user_id on the photo row, so the owner is the inspection's
-- inspector.
INSERT INTO object_ownership (object_path, user_id, company_id, created_at)
SELECT
  '/objects/' || split_part(split_part(split_part(ip.url, '/storage/objects/', 2), '?', 1), '#', 1),
  i.inspector_user_id,
  ip.company_id,
  ip.created_at
FROM inspection_photos ip
JOIN inspections i ON i.id = ip.inspection_id
WHERE ip.url LIKE '%/storage/objects/_%'
  AND split_part(split_part(split_part(ip.url, '/storage/objects/', 2), '?', 1), '#', 1) <> ''
  AND i.inspector_user_id IS NOT NULL
ON CONFLICT (object_path) DO NOTHING;
