---
name: RAP scorecard mirror
description: Repair Attempt Protocol scorecard math exists in two places (mobile screen + api-server lib) and must stay in lockstep.
---

The Repair Attempt Protocol scorecard math (manipulated shingles = explicit `manipulatedCount` 6/7/8 when answered, legacy fallback 9; unique collateral set across mat-transfer 1–2 + damage categories over shingles 3–8, per-category counts) is duplicated:

- mobile: the repairability screen computes it live for the rep
- api-server: `src/lib/rapScorecard.ts` recomputes it from the stored jsonb for reports and AI briefs. `extractRap` must handle both storage locations: v2 keeps the RAP at `roof.rap`, v3 keeps it top-level at `rap` (repairability jsonb is now v1|v2|v3; v3 = warranted gate + systems + roofType + rap)

**Why:** the report must show exactly the counts the rep saw; there is no shared package between the Expo app and the server for this today.

**How to apply:** any change to the category list, priority order (delamination > creasing for example photos), or counting rules must be made in both places. Category order in `RAP_DAMAGE_CATEGORIES` doubles as photo-selection priority. Report photos are referenced by inspection-photo id (never URL) and signed at preview time. Pre-RAP assessments must keep returning null from `extractRap`.
