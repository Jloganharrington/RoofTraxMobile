---
name: Proof Package A–M template
description: How the v6 Proof Package (A–M exhibit) pipeline works and its invariants
---

# Proof Package A–M template (compiled blob schemaVersion 6)

- v6 compile blobs bake a `reportData` snapshot (company settings, state legal pack, storm, methodology counts, scope, product, photoMeta, coverPhotoId, signaturePath). Render branches: v6+`reportData` → `buildProofPackageHtml` (proofPackageTemplate.ts); v≤5 → legacy `buildReportHtml`. Never remove the legacy branch — old versions must keep opening.
- Exhibit letters A–M are FIXED: an inapplicable exhibit is omitted, letters never re-shift. New content goes in as supplemental pages after M, not as new letters.
- Compile 422-gates on company report settings (licenses, qualifications) and a state pack matching the property state (parsed from the address, case-insensitive; single-pack fallback). Portal/preview routes only render existing blobs, so the gate can't be bypassed.
- State-pack text supports `{{contractor}}`/`{{license}}` tokens, substituted at render from company settings.
- **Why:** report content is legal collateral per state; company/state settings are super-admin curated (report-settings + state-packs routes, `requireSameCompanySuperAdmin`).
- **How to apply:** any new report surface must reuse the same reportData snapshot + fresh-signing rule (object paths in blobs, sign at render), and keep carrier-visibility gating (`carrierVisible`) in every render branch.
