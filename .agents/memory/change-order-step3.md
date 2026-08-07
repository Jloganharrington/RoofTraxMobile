---
name: Change Order Step 3 — Mobile Flow
description: Architecture decisions and constraints for the on-site CO capture flow (offline-first mobile)
---

## Server changes (changeOrders.ts)

- `CreateChangeOrderBody` and `CreateLineItemBody` both accept an optional `id: z.string().uuid()` client-generated UUID. The server uses it as the row id; duplicate id → 409.
- `SignChangeOrderBody` accepts **either** `pdfBase64` (mobile path — server uploads to object storage) **or** `documentObjectPath` (legacy/CRM path). The existing tests that send `documentObjectPath` still work unchanged.
- ObjectStorageService is instantiated once at module top: `const objectStorageService = new ObjectStorageService()`.
- 23505 pg error (unique constraint) surfaces on `err.cause.code`, not `err.code` — see Drizzle query error wrapping in memory.
- `repSignedAt` is always stamped on sign (both parties embedded in PDF), not conditionally on `repSignaturePath`.

## Mobile: what each new file does

- `lib/changeOrderTemplate.ts` — `buildChangeOrderHtml(data: ChangeOrderData)` → print-ready HTML with `/* CO_DATA_START/END */` JSON block exactly like FIPSA. `centsToDollar()` and `formatMDY()` exported.
- `lib/changeOrderSync.ts` — `useListChangeOrders(pinId)` React Query hook; `enqueueChangeOrder(input)` atomically enqueues change_order.create + N × change_order.line_item + change_order.sign in FIFO order.
- `lib/outbox/types.ts` — three new kinds + payload interfaces: ChangeOrderCreateOutboxPayload, ChangeOrderLineItemOutboxPayload, ChangeOrderSignOutboxPayload.
- `lib/outbox/handlers.ts` — three new handlers; each catches `(err as {status?:number}).status === 409` and returns (item becomes `done`, not `dead`). Uses `customFetch` directly (not generated API hooks).

## Mobile: screens

- `app/(tabs)/change-orders.tsx` — lists active pins (non-voided), tap → change-order-new?pinId=xxx, FAB for jobless entry.
- `app/change-order-new.tsx` — 5-step state machine (0=pin, 1=items, 2=review, 3=signature, 4=submit). PDF flow identical to FIPSA: `buildChangeOrderHtml` → `Print.printToFileAsync` → `FileSystem.File.bytes()` → `Crypto.digest(SHA256, bytes.buffer as ArrayBuffer)` → chunked btoa → `enqueueChangeOrder`.
- `app/(tabs)/team.tsx` — DELETED. Layout replaced Team tab with Change Orders (icon `file-text`, always visible to all roles).

## Key constraints (LOCKED by spec)

- 3c: PDF generated entirely on-device; no AI, no network during signing.
- 3d: outbox client UUIDs; 409 in handlers → return (not throw) → item marked `done`.
- 3e: SHA-256 computed with `Crypto.digest(SHA256, bytes.buffer as ArrayBuffer)`.
- `displayName` does not exist on `useProfile()` — use `profile?.firstName` + `profile?.lastName`.
- `'receipt'` is not a valid IconName; use `'file-text'`.
- Route types for `/change-order-new` require `as any` casts on `router.push` (not yet in Expo Router's type map).

## **Why:**
Offline-first field capture requires that signing works in airplane mode. The three-item outbox queue (create → line items → sign) ensures FIFO ordering so the sign item lands after all line items exist server-side.
