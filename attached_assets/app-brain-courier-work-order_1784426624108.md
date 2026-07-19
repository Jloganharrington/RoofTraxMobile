# Work Order — App → Brain Courier (the missing connection)

**Repo:** RoofTraxMobile (`artifacts/api-server`) · **Who builds:** Replit
**Companion:** Brain side is built and live — this order only covers the outbound half.

---

## The finding

The app and the Brain have never been connected. Verified:

| | |
|---|---|
| `BRAIN_URL` / `brainBaseUrl` / any Brain host in the app | **absent everywhere** |
| Outbound HTTP in the submission path (`routes/inspections.ts`) | **none** |
| What submit actually does | writes `submission_manifest`, stamps `locked_at`, stops |
| What the Brain expects | `POST /submissions` with `SubmissionEnvelopeV1`, `requireMachineToken` |

`docs/brain-extraction-seam.md` was written when the Brain *"does not exist yet"* and
describes a **pull** model — the Brain reads the app's database. The Brain that now exists is
**push** — it receives an envelope over HTTP and stores it. Neither half of that mismatch has
a courier.

**Consequence:** a full Phase-2 inspection today produces a complete, locked, verified record
in the app's database, and the Brain never sees it.

---

## What to build

On successful submission — **after** intake's existing verification, which stays the
gatekeeper — courier the package to the Brain.

### 1. Config
- `BRAIN_BASE_URL` and `BRAIN_MACHINE_TOKEN` env vars, validated at boot alongside the
  existing env checks. Absent ⇒ courier disabled and logged, never a crash.

### 2. Build the `SubmittedInspection` payload
This is the real work. The app **has** all the data; nothing currently maps it into the
Brain's contract shape. Map from stored rows:

- `property`, `storm`, `inspector` (+ `certifications`, `yearsExperience` from the profile)
- `damageFlags` — all **four**, including `interiorDamageFound`
- `arrival`, `propertyProfile`, `existingOrUnrelatedConditions`
- `repairabilityAssessment`, `temporaryRepairs`, `propertyProtectionPlan` — pass through
  **null when not captured**; never synthesise an empty object
- `slopes[]` with `areaSqft`, `damagePresent`, `damageType`, `tieInValley`, `tieInHipRidge`
- `sidingFacets[]`, `damageInstances[]`, `testSquares[]`, `measurements[]`,
  `components[]`, `penetrations[]`, `products[]`, `interiorObservations[]`,
  `homeownerFacts`, `attestations[]`, `addenda[]`
- `photos[]` with `stage` (step key), `subjectType`, `triadRole` **or** `preliminaryRole`,
  `area`, `sha256`, `capturedAtUtc`, GPS, `caption`

The canonical target shape is `rooftrax-brain/src/submissions/types.ts`. It was aligned to
the app's schema on 2026-07-19 — field names should match; where they don't, the Brain is
wrong and should be told, not worked around.

### 3. POST it
`POST ${BRAIN_BASE_URL}/submissions` with `Authorization: Bearer ${BRAIN_MACHINE_TOKEN}` and
body `{ manifest, inspection }`. Store the returned Brain submission id on the inspection.

### 4. Do not block the rep
Courier failure must **never** fail the rep's submit. Intake has already verified and locked
the record; delivery is a background concern.

- Enqueue and retry with backoff (the outbox pattern already in the app is the obvious home).
- Surface delivery state on the inspection (`brain_delivery_status`, `brain_submission_id`,
  `brain_last_error`) so a stuck package is visible rather than silently undelivered.
- The Brain's `receiveSubmission` is **idempotent by inspectionId**, so a retry or duplicate
  send is safe by design.

---

## 5. ⚠ The Brain must be able to fetch photo bytes — this is a second connection

**The submission is one-way, but the overall relationship is not single-point.** The envelope
carries photo **URLs and SHA-256 hashes — not the images.** A forensic inspection is ~100
photos and, at full-quality masters, several hundred megabytes; that does not belong in a
JSON body.

It is also not merely a size decision. From `rooftrax-brain/src/integrity/verify.ts`:

> re-hashes the **ACTUAL bytes** from object storage and compares to the manifest. Any
> mismatch, missing photo, or unfetchable object fails integrity and **blocks rendering**.

If the app shipped the bytes *and* the hashes together, the Brain would only be confirming
the app is internally consistent with itself. Fetching independently and re-hashing is what
verifies that **the stored evidence matches the manifest** — the actual chain-of-custody
claim the proof package rests on. Do not collapse this into the envelope to make the
connection "single point"; it would quietly gut the integrity story.

**Integrity failure does not degrade gracefully — it refuses to render.** So this has to work
before any package can be built.

### Options considered

| | Approach | Problem |
|---|---|---|
| A | Shared bucket credentials | Brain holds storage credentials it otherwise never needs |
| B | Signed URLs embedded in the envelope | **TTL breaks it** — packages are built days later, after the measurement report arrives |
| C | **Photo proxy on the app** | one extra hop; bandwidth through the app |

### Recommended: C — a read-only photo proxy on the app

`GET /internal/photos/:photoId` on the api-server, authenticated with the **same machine
token the courier already uses**. Returns the raw bytes.

- No bucket credentials leave the app; the app keeps sole ownership of evidence storage,
  which matches the custody story the package asserts.
- No TTL problem — works whether the package is built in five minutes or five days.
- No new credential to manage: the token already exists for the courier.
- Set `OBJECT_STORAGE_BASE_URL` on the Brain to this proxy's base; `HttpPhotoFetcher`
  already resolves `objstore://` refs against it, so **no Brain change is needed**.

Must be strictly read-only, machine-token-gated (never a session), and scoped so one
company's token cannot fetch another company's photos.

**Revisit at scale:** this proxies package-sized photo volume through the api-server. Fine at
beta volume; worth measuring before 500 subscribers.

---

## 6. ⚠ The return path — how the app learns the package is ready

Currently nothing carries Brain state back. The app's `GET /inspections/:id/status` still
returns its own stub receipt (`isStub: true`), so once a package is built the rep has no way
to know. This is unowned, not broken — a decision that needs making.

### Recommended: the app's existing status endpoint queries the Brain

Do **not** add a webhook or a new client surface. `GET /inspections/:id/status` already
exists and the mobile app already calls it. Change it to ask the Brain for real state and
replace the stub:

```
GET /inspections/:id/status   (app, unchanged contract to the client)
   └─> GET {BRAIN}/submissions/{brainSubmissionId}/status   (machine token)
```

Return the Brain's `status` (`received` / `validating` / `generating` / `package_ready` /
`rejected` / `generation_failed`) alongside the existing delivery fields, and drop
`isStub` once real state is flowing.

- No new inbound surface on the app, no new credential, no retry/idempotency machinery.
- The client already polls this endpoint — zero mobile work.
- Package build takes minutes, so polling cadence is entirely adequate.
- If the Brain is unreachable, return the app's own local state and mark the Brain portion
  unavailable — **never fail the status call**, it is the rep's only visibility.

A Brain→app webhook scales better and can replace this later; keep the seam clean but do
not build it now for marginal timeliness.

---

## 7. Verification
1. Submit an inspection → Brain returns an id; app stores it.
2. `GET {brain}/submissions/:id/status` returns `received`.
3. `GET {brain}/submissions/:id/report-data` returns a populated `REPORT_DATA` v2 payload
   with `missingInputs` listing only genuinely-absent inputs.
4. Kill the Brain mid-submit → rep's submit still succeeds; delivery retries and lands.
5. Re-submit the same inspection → no duplicate on the Brain side.
6. **Photo proxy:** Brain fetches every photo by `objstore://` ref and integrity passes
   (`integrity.checked` equals the photo count, `ok: true`).
7. **Proxy auth:** an unauthenticated request is rejected; a token scoped to company A
   cannot fetch a company B photo.
8. **Return path:** app `/status` reflects the Brain's real status, and `isStub` is gone.
9. **Brain down:** app `/status` still returns local state rather than erroring.

---

## Environment the Brain needs to be useful

| Var | Needed for |
|---|---|
| `DATABASE_URL` | everything (required) |
| `BRAIN_MACHINE_TOKEN` (matching the app's) | accepting submissions |
| `OBJECT_STORAGE_BASE_URL` | photo byte-level re-hash → **package build**. Point this at the app's photo proxy from §5 — `HttpPhotoFetcher` already resolves `objstore://` refs against it, so no Brain change is needed |
| `GEMINI_API_KEY` | AI narratives → **package build only** |

`GET /report-data` deliberately needs **neither** Gemini nor object storage — it was built
that way so the data path can be tested before the AI and rendering path is configured.

## Two blockers that remain even once connected

- **Virginia is not counsel-reviewed.** `config/resolve.ts` throws while `reviewedAt` is
  NULL, so `POST /package` returns 409 `state_not_go_live`. `GET /report-data` is unaffected.
- **No price book exists**, so scope/estimate content will be thin. Expected until the Price
  Book wizard and its content land.

Neither blocks the courier or the REPORT_DATA path — they block the final rendered PDF.
