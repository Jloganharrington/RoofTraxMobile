# Track E — Route & Surface Cleanup (P1)
SCOPE: routing, navigation, docs/route-inventory.md. DO NOT touch: compile/attest, curation, libraries, pipeline stage logic, supplement routes.

Fixes audit finding F-10 and refreshes the route inventory.

## 1. Legacy summary route (F-10)
- /inspections/:id/summary (legacy monolithic "Forensic Summary" surface) is stale: permanently redirect to the claim's stepper at /leads/:id (step 4, AI Sections). Preserve the id mapping (inspection id → lead id) in the redirect.
- Remove the legacy Forensic Summary page component and its hooks IF nothing else imports them (verify with grep, list evidence). If any component is shared, leave it and note the shared consumer.
- Any nav entries, deep links, or buttons pointing at the legacy route are updated to the stepper.

## 2. Duplicate-surface check
- Verify the old AI Sections tab vs. the stepper: if both surfaces exist, the stepper is canonical — the tab either redirects into the stepper step or is removed. One review surface only; a section must not be approvable from two places.

## 3. Inventory refresh
- Update docs/route-inventory.md with this pass: the redirect added, components removed, and current disposition for every route. Diff against the previous inventory; list what changed at the top of the file with the date.

Run the frontend test suite and a full route smoke check (every route in the inventory returns a render or its documented redirect, no 404s from nav).
