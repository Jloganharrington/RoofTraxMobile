# Track D — Supplement Flow Rebuild (P2 — LAUNCH ONLY AFTER TRACK A MERGES)
SCOPE: supplement routes/services/UI, supplement document model, claim timeline events. CONSUMES (read-only): Track A's blob-version + signed-recompile machinery, exhibitBadgeMap append rules. DO NOT touch: primary compile/attest internals, curation manifest derivation, standards/detriment data, badge counter mechanics beyond appending through the existing API.

Fixes audit finding F-4: supplements currently render as inner-HTML blocks inside the single Proof Package blob under one attestation. This violates three locked rules: supplements are separate versioned documents; separately attested; appending exhibit badges within class without renumbering.

## 1. Supplement document model
- A supplement is its OWN document on the claim: supplement number (SUPP-1, SUPP-2...), its own section set scoped to the new analysis only, its own compile blob chain (review blob → attest → signed recompile via Track A's machinery), its own reportAttestations row, its own generationSnapshot.
- The supplement cites the original package: snapshot carries originalPackageBlobVersion + originalAttestationId; the supplement's opening identifies the original report by date and states that this analysis supplements it as a dated, attributable addendum (per Attestation Block B's concealed-conditions language).
- The original package blob is NEVER modified, re-rendered, or re-attested. Remove the inner-HTML injection path entirely.

## 2. Sections
- Supplement sections use the same lifecycle (draft → ai_generated → in_review → approved → locked) and the same hard gates, scoped to the supplement. Typical set: supplement findings (the newly exposed/changed conditions), revised scope/estimate justification deltas, closing. Summary-of-findings is NOT regenerated for the original package.
- Trigger context: supplements carry a supplementReason (concealed_conditions_exposed | carrier_response | scope_correction) recorded on the document and rendered in its opening.

## 3. Exhibits
- New supplement photos are curated through the same slot/confirm flow, scoped to the supplement, and take NEW badges appended within their class through the frozen exhibitBadgeMap (next counter values). Nothing renumbers. Supplement captions may cross-reference original exhibits by their frozen badges.

## 4. Pipeline + timeline
- Issuing a supplement is available from the Claim Hub (and the supplement_dispute pipeline stage's button_link routes here). Events: supplement_created, supplement_attested, supplement_delivered — all on the claim timeline.
- Deliver gate identical to primary: 422 without the supplement's own signed blob.

## 5. Migration
- Any existing supplements rendered as inner blocks: extract nothing, modify nothing — flag the affected package blobs legacy_inline_supplement=true and surface a claim-level notice that future supplements issue as separate documents. Attested history is not rewritten.

## 6. Tests
- Issue a supplement on a claim with a delivered package: assert original blob untouched (hash-identical), supplement has its own signed blob + attestation, supplement photo takes the next in-class badge, timeline shows the three events, deliver blocked until supplement attested.

Run the full test suite.
