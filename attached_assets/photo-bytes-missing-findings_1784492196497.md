# Photo Bytes Missing in Object Storage — Findings for Replit

**Repo:** RoofTraxMobile · **Severity:** blocks package rendering entirely
**Found:** first real `POST /package` for inspection abd06ef9 (Brain submission b316c237)

## The result

Package build got all the way to photo integrity verification — auth, URL, path, and
machine token all correct — and then **failed on every photo** with:

```
integrity_failed · fetch_failed · photo fetch failed (404)
```

Probing the proxy directly with the correct machine token gives the specific reason:

```
GET /api/internal/photos/3231c2d2-...   (Bearer <token>)
→ 404  {"error":"Photo bytes not found in storage"}
```

That is **not** an auth failure and **not** a wrong-URL failure. Both of those are already
proven working (a bad token → 401, a nonexistent id → the same 404). This is
`ObjectNotFoundError` from `internal.ts:88` — the photo's DB row exists, its `url` is set,
the inspection is locked and in-scope, but **the actual image bytes are not at that storage
key.**

## Root cause

`POST /inspections/:id/photos` (`inspections.ts:1799`) writes the photo row with a
**client-supplied** `url` and `sha256` in one request:

```ts
const values = {
  ...
  url: parsed.data.url,       // <-- path the client says it uploaded to
  sha256: parsed.data.sha256, // <-- hash the client computed
};
```

The **upload of the actual bytes to object storage is a separate client step.** So the DB
row can be created pointing at a key the upload never actually wrote. On this inspection,
that is exactly what happened — every photo has a row and a `url`, and no bytes behind it.

Most likely trigger (matches this test): **library-picked photos.** Logan filled gaps with
photos chosen from the device library rather than camera captures. If the library path
records the row but does not run (or does not complete) the object-storage upload that the
camera path does, you get precisely this: rows without bytes.

## Why the architecture is actually right

Worth stating, because the fix should preserve this: the DB row carrying a **client-computed
sha256** is what makes the Brain's chain-of-custody meaningful. The Brain fetches the bytes
**independently** and re-hashes them against that stored sha256 — so if the bytes were
swapped, truncated, or (as here) never uploaded, integrity fails and the package refuses to
render. **The system caught real missing evidence and refused to fabricate a package around
it.** That is the behaviour you want. The bug is upstream, in the upload never completing.

## The intended flow (and where it breaks)

The client is supposed to do three steps per photo:

1. `POST /storage/uploads/request-url` → returns a presigned `uploadURL` + `objectPath`
   (`storage.ts:44`).
2. **PUT the raw bytes to that presigned `uploadURL`.** ← the step that failed or was skipped
3. `POST /inspections/:id/photos` with `url: objectPath` → row created (`inspections.ts:1799`).

**Step 3 succeeds no matter what happened in step 2.** Nothing checks that the bytes are
actually in storage before the row is committed. That is the entire bug.

## The fix (Mobile) — small, and the mechanism already exists

The api-server already has an existence check: `objectStorageService.getObjectEntityFile(url)`
(`objectStorage.ts:136`) calls `objectFile.exists()` and throws `ObjectNotFoundError` when the
bytes are absent. It is exactly what the proxy uses. The photo-create handler simply never
calls it.

**Primary fix — reject a photo row whose bytes are not in storage.** In
`POST /inspections/:id/photos` (`inspections.ts:1799`), before the insert:

```ts
try {
  await objectStorageService.getObjectEntityFile(parsed.data.url);
} catch (err) {
  if (err instanceof ObjectNotFoundError) {
    res.status(409).json({
      error: 'photo_bytes_missing',
      detail: 'Upload the photo to object storage before registering it.',
    });
    return;
  }
  throw err;
}
```

This makes it structurally impossible to create a photo row without bytes — the failure
surfaces at capture time on the rep's device, not days later at package build. It also
converts the current silent data-loss into a loud, immediate error.

**Secondary fix — make the library-pick path upload like the camera path.** If
`pickEvidencePhotoFromLibrary` records the row without running the presign→PUT upload the
camera flow runs, that is the specific gap that produced this test's result. With the
primary fix in place this can no longer create a phantom row, but the library path still
needs to actually upload so those photos are usable at all.

**Backfill note:** the existing inspection (abd06ef9) has ~19 rows already pointing at empty
keys. The primary fix prevents NEW ones but does not heal these — they will still fail
integrity. Simplest path to a testable package: after the fix lands, re-capture/re-upload
this inspection's photos (or run a fresh inspection), so the bytes exist before submit.

**Do NOT "fix" this by having the Brain skip missing photos.** A proof package with silently
absent evidence is worse than one that fails to build — the whole value is that every
referenced photo is present and hash-verified.

## Interim, to finish the end-to-end test today

If you want to see a package render before the upload fix lands, the fastest path is to
re-run one clean inspection using **camera captures only** (no library picks) and confirm
those bytes land in storage — then build the package from that submission. That isolates
whether the library path is the culprit and gives us a rendered document to look at.

## Verify the fix

- `GET /api/internal/photos/:id` with the machine token returns the actual image bytes
  (200, non-empty) for every photo on a locked inspection.
- `POST /submissions/:id/package` on the Brain passes integrity (`integrity.checked` equals
  the photo count, `ok: true`) and returns `package_ready`.
