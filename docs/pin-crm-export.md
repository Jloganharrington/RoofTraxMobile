# Pin Data → CRM Export Reference

This document is the reference spec for sending RoofTrax pin data to an
external CRM. It captures every measured/documented field currently stored
on a pin, and the recommended structure for exporting it.

## All fields on a saved pin

### Core (always present)

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Pin's unique ID |
| `userId` | string | Field rep who created it |
| `latitude` / `longitude` | number | Immutable after creation |
| `address` | string \| null | Reverse-geocoded from lat/lng |
| `workflow` | `"insurance"` \| `"retail"` | Determines which fields below are populated |
| `photoUrl` | string \| null | Object-storage URL of the photo |
| `status` | string | Currently only `"active"` is used |
| `createdAt` | ISO datetime | No `updatedAt` exists yet — see caveat below |

### Insurance-workflow fields

| Field | Type |
|---|---|
| `damageType` | `"roof"` \| `"siding"` \| `"roof_and_siding"` \| null |
| `contactOutcome` | `"no_soliciting"` \| `"priority_inspection"` \| `"call_to_schedule"` \| null |
| `customerName` | string \| null (set only when `contactOutcome = call_to_schedule`) |
| `customerPhone` | string \| null (same condition) |

### Retail-workflow fields

| Field | Type |
|---|---|
| `doorKnockResult` | `"no_answer"` \| `"no_appointment"` \| `"appointment"` \| null |
| `retailData` | object \| null, containing: |
| — `ownerName1` | string |
| — `ownerName2` | string \| null |
| — `phone` | string \| null |
| — `email` | string \| null |
| — `interestedRoof` / `interestedSiding` / `interestedWindows` / `interestedDoors` | boolean |
| — `interestNotes` | string \| null |
| — `appointmentDate` | string \| null |
| — `notes` | string \| null |

### Tracked internally but not currently exposed by the API

- `companyId` (which tenant the pin belongs to)
- No `updatedAt` timestamp exists yet — only `createdAt`. This means there's
  currently no reliable way to detect that a pin was edited after creation
  for incremental sync purposes. Add this column before building an
  incremental CRM pull.

## Most efficient way to send it to a CRM

For pin data specifically (relatively low volume — a rep drops pins
throughout the day, not thousands/sec), an **event-driven webhook** beats
polling:

1. **Trigger point**: fire on the mutation points that already exist in the
   codebase — `POST /pins` (create), `PATCH /pins/:pinId` (edit),
   `POST /pins/bulk` (drone bulk-create), and `DELETE /pins/:pinId`.
2. **Delivery**: `POST` a signed JSON payload to a CRM-configured webhook
   URL (HMAC signature header so the CRM can verify it's really from
   RoofTrax). Retry with backoff on non-2xx; queue rather than blocking the
   mutation response.
3. **Fallback/reconciliation**: keep `GET /pins` available for the CRM to do
   a periodic full/incremental pull in case a webhook is missed — this is
   where the missing `updatedAt` becomes a real gap; add that column so the
   CRM can query "give me everything changed since X" reliably.

## Suggested payload structure

```json
{
  "event": "pin.created",
  "eventId": "evt_8f3a...",
  "occurredAt": "2026-07-12T20:15:00Z",
  "company": {
    "id": "RFTRAX",
    "name": "Acme Roofing"
  },
  "rep": {
    "id": "45611481",
    "name": "Jordan Lee",
    "email": "jordan@acmeroofing.com"
  },
  "pin": {
    "id": "b3a1...",
    "status": "active",
    "createdAt": "2026-07-12T20:15:00Z",
    "location": {
      "latitude": 39.1,
      "longitude": -84.5,
      "address": "123 Main St, Cincinnati, OH"
    },
    "workflow": "insurance",
    "photoUrl": "https://.../photo.jpg",
    "insurance": {
      "damageType": "roof",
      "contactOutcome": "call_to_schedule",
      "customerName": "Pat Smith",
      "customerPhone": "555-0100"
    },
    "retail": null
  }
}
```

For a retail pin, `insurance` would be `null` and `retail` would carry
`doorKnockResult` plus the full `retailData` object (owner names, contact
info, interest flags, notes).

This shape is deliberately flat and CRM-friendly: workflow-specific data is
nested under `insurance`/`retail` keys (whichever is null tells the CRM
which lead type it is) rather than one giant flat object with a pile of
always-conditionally-null fields.

**Status:** documentation only — the webhook delivery system (outbox table,
signing, retries) has not been implemented yet.
