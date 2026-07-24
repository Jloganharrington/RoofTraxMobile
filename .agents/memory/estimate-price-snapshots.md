---
name: Estimate price-book snapshot integrity
description: Rules for the inspection estimate feature — server-authoritative snapshots and advisory-step conventions.
---

Rule: any estimate/pricing line that references a catalog record (price-book item) must be server-hydrated — description, unit, and unit price come from the DB row, never the client body. Manual lines (null ref id) keep client values. All money math (line totals, subtotal, waste-adjusted basis) is recomputed server-side.

**Why:** a same-tenant user could otherwise launder a tampered price behind a legitimate item id, making a fake estimate look price-book-backed in the Proof Package. Caught in code review of the estimate builder.

**How to apply:** on any write route accepting catalog-referencing lines, load the referenced rows (company-scoped), reject unknown ids with 400, and overwrite the snapshot fields before computing totals.

Also: advisory protocol steps (like summary and estimate) get no gate rules — they join all three stage mirrors, and the hub marks them done from data presence. Any test fixture enumerating the full step list must be updated when a step is added. New persisted columns need an idempotent migration in data-migrations/ even when dev used drizzle push — existing databases break otherwise.
