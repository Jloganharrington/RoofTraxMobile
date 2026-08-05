---
name: Component zone photo gate
description: Every documented component (regardless of status) requires a shared zone photo; interior_observation photos require a subjectId from an entity.
---

# Component zone photo gate + interior photo subjectId

## Rule 1 — Zone photo gate
Every component added via POST /inspections/:id/components requires a shared zone photo — a photo with `subjectType: 'component'` and `zone: <zone>` — even when `status: 'not_observed'`. Zone map: `drip_edge, gutter_apron, starter, ice_and_water_shield, underlayment, decking, layer_count` → `eave_edge`; `ventilation` → `ridge_hip`. Missing zone photos block submission with a `MISSING_ZONE_PHOTO_<zone>` deficiency.

## Rule 2 — Interior observation photos
`subjectType: 'interior_observation'` requires a `subjectId` pointing to a real interior observation entity (POST /inspections/:id/interior-observations). There is no exemption. Using only `stage: 'interior'` without `subjectType: 'interior_observation'` creates a photo that does NOT satisfy `interiorPhotoCaptured` in the protocol gate — the gate checks `photos.some(p => p.subjectType === 'interior_observation')`.

Correct order: create interior observation entity first → use its id as `subjectId` when adding photos.

## Why
Both gates are enforced server-side in `evaluateServerInspection` and block the submission API. They are not soft flags.

## How to apply
Scripts and fixtures that add components must add the corresponding zone photo. Scripts that add interior photos must create the parent entity first.
