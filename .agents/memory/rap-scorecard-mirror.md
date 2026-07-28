---
name: RAP scorecard mirror
description: Repair Attempt Protocol scorecard math exists in two places (mobile screen + api-server lib) and must stay in lockstep.
---

The Repair Attempt Protocol scorecard math (manipulated shingles = 9, unique collateral set across mat-transfer 1–2 + damage categories over shingles 3–8, per-category counts) is duplicated:

- mobile: the repairability screen computes it live for the rep
- api-server: `src/lib/rapScorecard.ts` recomputes it from the stored `repairabilityAssessment.roof.rap` jsonb for reports and AI briefs

**Why:** the report must show exactly the counts the rep saw; there is no shared package between the Expo app and the server for this today.

**How to apply:** any change to the category list, priority order (delamination > creasing for example photos), or counting rules must be made in both places. Category order in `RAP_DAMAGE_CATEGORIES` doubles as photo-selection priority. Report photos are referenced by inspection-photo id (never URL) and signed at preview time. Pre-RAP assessments must keep returning null from `extractRap`.
