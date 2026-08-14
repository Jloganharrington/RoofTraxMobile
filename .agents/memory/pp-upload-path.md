---
name: PP upload-path workflow
description: Package Generation upload path — Stages 3–5 architecture, routing, data storage, and PP-specific API endpoints.
---

## Flow

```
/pp/new           (NewPackagePage)   — damage type + checklist
/pp/new/intake    (IntakePage)       — property/claim form → POST /api/pp/inspections
/pp/new/:id/estimate (EstimatePage) — price book scope lines → PUT /api/pp/inspections/:id/estimate
/pp/wizard/:id    (PPWizardPage)    — payment gate → photo curation → compile → deliver
```

## Data storage

Estimate lines (Stage 5) are stored in `inspectionsTable.propertyProfile.ppEstimateLines` as jsonb — no extra migration.
Schema: `PPEstimateLine[]` defined in `lib/db/src/schema/inspections.ts` alongside `PropertyProfile`.

**Why jsonb not a separate table:** avoids a migration for the MVP; structure is validated by `PPEstimateLineSchema` (Zod) in pp.ts at write time.

**How to apply:** any code reading propertyProfile must treat `ppEstimateLines` as optional/nullable.

## PP-specific API endpoints (pp.ts)

| Method | Path | Purpose |
|--------|------|---------|
| POST   | /api/pp/inspections | Create upload-path inspection (pinId = null) |
| GET    | /api/pp/price-book | List company's price book items (PP-auth, no CRM permission needed) |
| GET    | /api/pp/inspections/:id/estimate | Read saved estimate lines |
| PUT    | /api/pp/inspections/:id/estimate | Save estimate lines to propertyProfile |

## Price book seeding

`provisionPPAccount` (pp.ts) seeds 3 starter items inside the registration transaction:
- Standard Asphalt Shingle Roof System Replacement (SQ, unitPrice=0)
- Standard Vinyl Siding System Replacement (SF, unitPrice=0)
- Emergency Temporary Repair Services (EA, unitPrice=0)

Unit prices intentionally 0 so each contractor sets their own rates.

## Quirks

- `propertyProfile` update: must cast to `any` before passing to Drizzle `.set()` because spreading `Record<string, unknown>` gives `recordedAtUtc` the type `{}` which conflicts with Drizzle's strict column typing. Pattern: `const updated: any = { ...existing, recordedAtUtc: ..., ppEstimateLines: lines }`.
- `GET /api/price-book/items` requires `catalog.price_book_view` — PP sessions don't have CRM permissions, so use `GET /api/pp/price-book` instead.
- The api-server runs via esbuild (build.mjs), not tsx watch — must restart the workflow after any pp.ts changes to pick up the new build.
