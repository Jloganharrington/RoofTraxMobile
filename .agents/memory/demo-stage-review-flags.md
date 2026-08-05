---
name: Demo + stage-review flags
description: pins.is_demo marks seed data; pins.needs_stage_review flags auto-mapped null-stage pins; both backed by migration 0001.
---

## is_demo
- DB column: `pins.is_demo boolean NOT NULL DEFAULT false`
- Migration: `lib/db/drizzle/0001_known_cyclops.sql`
- All 12 pre-existing pins were marked `is_demo = true` as part of the initial data-normalisation pass.
- Frontend: every pipeline page (Retail, Insurance, Project) and All Leads have a **"Hide demo"** toggle (localStorage key `rt_hide_demos`, default `false` = demos visible). The toggle count is drawn from the unfiltered list; filtering is client-side only.

## needs_stage_review
- DB column: `pins.needs_stage_review boolean NOT NULL DEFAULT false`
- Set to `true` for the 11 pins whose `pipeline_stage` was NULL and was auto-mapped to `pin_dropped`.
- Frontend: `StageCard` renders an orange **"Stage review needed"** label when the prop is `true`.
- The prop flows: API select → API response map → RetailLead/PipelineInspection type → pipeline card → StageCard.

**Why:** Seed data should be toggleable so managers can work in a clean view without deleting the fixtures. Stage-review badge surfaces mis-staged leads without hiding them.

**How to apply:** New pins created via the API default to `is_demo = false` and `needs_stage_review = false`. Only the initial seed pass sets them true.
