---
name: Contract Record system
description: Migration 036 tables, routes, signing portal, and key invariants for the contract builder + signing portal feature.
---

## Tables (migration 036)
- `contracts` — main record; `access_code` is generated at draft creation, NOT NULL always, only exposed when `status = 'sent'`.
- `contract_scope_packages` — FK to selectionCategoriesTable; quantity as numeric.
- `contract_selections` — snapshot at write time (productName, brandName, optionName, unitDeltaCents, quantity, extendedDeltaCents). Never re-read from library.

## Derived fields rule (LOCKED)
- `betterments_cents = SUM(contract_selections.extended_delta_cents)` — recomputed via `recomputeContractTotals(contractId)`.
- `total_contract_cents = covered_scope_cents + betterments_cents`.
- Neither field is ever accepted from a client.

## Write-back on sign (atomic transaction)
- `pins.contract_amount` ← formatted dollar string (legacy varchar, do NOT change type).
- `pins.betterments_amount_cents` ← `contract.bettermentsCents`.
- Column name on pinsTable: `bettermentsAmountCents` (camelCase).

## Routes
- Authenticated (rep-facing): `contracts.ts` — GET/POST `/api/pins/:pinId/contracts`, full CRUD on `/api/contracts/:contractId`, scope packages, send, generate-document, void.
- Public (portal): `contractPortal.ts` — GET/POST `/portal/contract/:code/*`, plus GET `/portal/contract/:code/document` (streams PDF bytes, no auth).
- Both routers registered in `artifacts/api-server/src/routes/index.ts`.

## Signing Portal artifact
- Slug: `signing-portal`, previewPath `/signing-portal/`, port 24332.
- artifact.toml bootstrap: write via `cat > path << 'EOF'` shell, then call `verifyAndReplaceArtifactToml({ tempFilePath, artifactTomlPath })` with the edit file.
- No vite proxy needed — Replit's path proxy routes `/portal/...` to API server (catch-all).

## UI wiring
- `ContractBuilderTab` at `artifacts/axiomrestore-web/src/components/contracts/ContractBuilderTab.tsx`.
- Imported into `LeadProfile.tsx`, rendered at `activeTab === 'contract_builder' && isInsurance` with props `pinId` and `isManager`.
- Uses `customFetch` + React Query (hand-written hooks, not orval-generated).
- Categories fetched from `/api/selections/categories` for the add-package dropdown.

## Gates (sign endpoint)
1. All scope packages must have a selection.
2. A generated document must exist (`documentObjectPath` non-null).
3. `status` must be `'sent'` (not draft/signed/voided).

**Why:** ensures customer only signs a finalized document they've seen with all choices locked in.
