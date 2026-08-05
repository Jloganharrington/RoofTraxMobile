---
name: Report attestation signed-recompile index shift
description: GET /report-attestation returns attested:false after post-attest recompile appends a signed entry; use blobVersionIndex from the signed entry for lookup.
---

# Report attestation GET index shift after signed recompile

## Rule
When POST /report-attestation succeeds, it appends an `isSignedVersion: true` entry to `compiledReportVersions` carrying the **original** compiled version's index in its own `blobVersionIndex` field. If GET /report-attestation uses `versions.length - 1` naively, it resolves the signed entry's position (e.g. index 1), not the original compile's position (index 0), and finds no attestation row → returns `attested: false`.

**Fix** (applied to inspections.ts): detect `lastVersion.isSignedVersion === true` and use `lastVersion.blobVersionIndex` for the attestation DB lookup instead of `lastVersionIndex`.

## Why
The post-attest signed recompile is non-fatal; it appends a new blob entry so the deliver route can reference a self-contained signed artifact. But that shifts the index by 1, breaking the naive lookup.

## How to apply
Any code that resolves "the current attestation" from `compiledReportVersions` must check the last entry for `isSignedVersion: true` and redirect the lookup through its stored `blobVersionIndex`.
