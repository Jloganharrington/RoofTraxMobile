---
name: Stage vocabulary mirrors
description: The protocol step-key list is mirrored in three places that must stay order-aligned.
---

The inspection stage/step vocabulary exists in three deliberately decoupled copies: the protocol package's step list, the DB schema's capture-stage varchar enum, and the OpenAPI CaptureStage enum.

**Why:** they mirror "by key only" to avoid hard package dependencies, so nothing enforces alignment; adding a conditional step mid-sequence drifted the ordering between copies and code review flagged it as parity drift.

**How to apply:** when adding/reordering a protocol step, update all three lists in the same order, regenerate the API clients, and rebuild lib/db. Order is not semantically load-bearing at runtime, but keep it identical so diffs and reviews stay trustworthy.
