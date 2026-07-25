-- 012: Append-only compiled report version history on inspections.
-- Each compile appends { path, generatedAt, evidenceManifestSha256 } so every
-- final package version (and its evidence-manifest integrity digest) remains
-- retrievable even though compiled_report_path is overwritten.
-- Idempotent: safe to re-run.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS compiled_report_versions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: seed the history with the current compiled report (no manifest
-- digest available for pre-manifest compilations).
UPDATE inspections
SET compiled_report_versions = jsonb_build_array(
  jsonb_build_object(
    'path', compiled_report_path,
    'generatedAt', to_char(compiled_report_ready_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'evidenceManifestSha256', NULL
  )
)
WHERE compiled_report_path IS NOT NULL
  AND compiled_report_versions = '[]'::jsonb;
