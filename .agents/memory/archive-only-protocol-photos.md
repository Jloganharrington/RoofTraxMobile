---
name: Archive-only protocol photos
description: Photos that must stay in the inspection archive but never enter report output, and where the exclusion is enforced.
---

**Rule:** Some protocol photos are archive-only by product rule — e.g. the Vinyl Assessment Protocol (VAP) final annotated archive photo. They are stored as normal inspection photos but must never appear in any report output: AI photo brief, photo groupings, evidence manifest, or rendered HTML.

**Why:** Carriers must not receive the annotated post-repair archive shot; only the scorecard, VAP1 baseline, and up to 2 priority damage photos ship in the report. A code-review round caught the final photo leaking through the general curated-photo path even though the VAP section itself excluded it.

**How to apply:** Exclusion is enforced server-side at report compile via a pure predicate (`isVapArchiveOnlyPhoto` in the api-server vapScorecard lib) applied to the curatedPhotos filter — a single choke point. Any NEW report/export/proof-package surface that reads inspection photos must apply the same predicate (or a future server-side archive-only flag on the photo row — proposed as a follow-up task). Never rely on mobile to withhold the photo.
