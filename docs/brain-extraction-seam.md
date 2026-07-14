# Brain extraction seam (M-F / F5)

This document defines the contract between the RoofTrax **field app** (capture +
intake) and the **Brain** — the standalone package-rendering/analysis service
that does **not** exist yet. After Phase M-F the field app is feature-complete:
it captures evidence, enforces the protocol, hardens submission ("Brain v0"),
and exposes every seam the real Brain will plug into. The Brain can be built and
swapped in later **without changing the field app**, because it consumes only the
stable artifacts described here.

## Design principles

- **Additive only.** Every M-F change added columns/tables/routes; nothing was
  removed or repurposed. The Brain reads what intake persisted.
- **The server is the gatekeeper.** Intake ("Brain v0") verifies evidence before
  it ever reaches the Brain, so the Brain can trust a submitted package.
- **Fabricate nothing.** Seams the Brain will own (package rendering, CRM
  scheduled feed, appointment completion, report ingest) report `pending` /
  empty / `null` / `isStub: true` until the real implementation lands. No
  placeholder deliverables are ever synthesized.

## Seam 1 — Submission manifest (the package boundary)

When an inspection is submitted, intake stores a **`SubmissionManifestV1`** on
`inspections.submission_manifest` and stamps `inspections.locked_at`. This
manifest is the self-contained description of the package the Brain will render.

Intake guarantees, enforced server-side at submit (no client bypass):

1. **Photo integrity** — every `photoHashes[]` entry (`{ photoId, sha256 }`) is
   re-hashed against the stored photo row; any mismatch or missing photo rejects
   the submission (HTTP 422 `photo_hash_mismatch`). The Brain can therefore
   trust that each referenced photo's bytes match its recorded SHA-256.
2. **Protocol satisfied** — the shared `@workspace/protocol` `evaluate()` is
   re-run on the server from stored rows; any hard deficiency rejects (422
   `gate_deficiencies`). A submitted package has zero blocking deficiencies.
3. **Signature on file** — the assigned inspector must have a signature on file
   (see Seam 3); otherwise submission rejects (422 `signature_required`). The
   stored manifest's `signatureOnFile` is re-stamped from the profile by the
   server, so it is authoritative.

Manifest shape (`records` maps record-type → id[]; see `lib/api-spec/openapi.yaml`
`SubmissionManifestV1`):

- `protocolVersion`, `generatedAtUtc`
- `records` — ids of every child record included, grouped by type
- `photoHashes` — verified `{ photoId, sha256 }` pairs
- `gateResults` — the client's gate snapshot (advisory; server re-derives its own)
- `signatureOnFile` — `{ url, sha256, signedAt }`, server-authoritative

**Brain contract:** consume `submission_manifest` + `locked_at`. All referenced
records/photos are immutable once `locked_at` is set. Render the deliverable from
these ids; never recompute the gate to *decide acceptance* (intake already did).

## Seam 2 — Package status & receipt (`GET /inspections/{id}/status`)

Returns `{ status, lockedAt, submissionManifest, receipt }`. The **receipt** is
currently a **stub** (`isStub: true`) derived from the manifest counts
(`recordCount`, `verifiedPhotoCount`). It reports what intake verified — not a
rendered package.

**Brain contract:** when the Brain renders a real package it should populate a
non-stub receipt (drop `isStub`, advance `stage` past `validated`, e.g. to
`package_ready`) and flip `inspections.status` to `package_ready`. The mobile
package screen already polls this endpoint and renders whatever the server
returns, so no client change is needed when the real receipt appears.

## Seam 3 — Signature on file (F0)

`user_profiles` carries `signature_url`, `signature_sha256`, `signature_signed_at`.
The inspector captures their signature once (uploaded to object storage,
tenant-scoped by the same object-ownership record every upload gets) and applies
it to each inspection's S8 declaration by reference. The Brain reads the signed
declaration attestation (S8) and the manifest's `signatureOnFile` for the
rendered package's signature block.

## Seam 4 — Addenda (post-lock corrections)

`inspection_addenda` (append-only) is the **only** write permitted on a locked
inspection (`POST /inspections/{id}/addenda`, idempotent by client id). Original
evidence is never edited. **Brain contract:** render addenda as an appended
corrections section, distinct from the original record.

## Seam 5 — CRM linkage (F4)

`company_crm_config` (`enabled`, `field_key`, per tenant; disabled by default)
gates the CRM seam. `GET /crm/status` reports each thread as `pending` or
`active`:

- **Scheduled feed** (inbound) — `GET /inspections/scheduled` returns `[]` while
  the seam is pending; when a real CRM key is provisioned (`enabled` + `field_key`),
  the upstream fetch drops in behind the same config gate.
- **Appointment sync** (outbound) — appointment-completion metrics stay `null`
  while pending (see `routes/activity.ts`); the Brain/CRM integration fills them.
- **Report ingest** (outbound) — the Brain will POST finished reports back to the
  CRM. That endpoint is intentionally **not built** in M-F; `CrmStatus.reportIngest`
  reports `pending`. When built, it should live behind the same per-tenant config
  gate and key.

**Brain contract:** treat a `pending` thread as "no external system connected" —
read empty, write nothing. Only act on `active` threads.

## What the Brain must NOT assume

- That the field app will re-run any analysis. It stores raw captured facts only
  (e.g. raw measurements, never computed squares/waste — that is the Brain's job).
- That records referenced by a manifest can change. They are locked.
- That a `pending`/`stub` field will be backfilled by anyone but the Brain.
