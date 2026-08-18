# AxiomRestore Inspection Flow — Current State (July 28, 2026)

Compiled from the live code: the shared protocol step engine (`lib/protocol`), the
gate rules, and the mobile screens (`artifacts/mobile/app`). Steps marked ⛔
hard-gate final submission. 📷 marks a photo requirement.

---

## Phase 1 — Lead & Preliminary

1. **Drop a pin** (map) — address and homeowner info; creates the lead/inspection record.
2. **Preliminary Intake** (`/inspection-preliminary-intake`) — damage type
   (Hail / Wind / Wind & Hail / Other) and damage surfaces (Roof / Siding /
   Collateral / Interior). Surface picks set the damage-found flags that decide
   which Phase 2 steps apply.
3. **Preliminary Photos** (`/inspection-preliminary-photos`) — 📷 4 single-shot
   evidence slots:

   | Photo | Required? |
   |---|---|
   | Front of home | Yes |
   | Roof overview | Yes |
   | Damage close-up #1 (per selected surface) | Yes — surfaces must be selected first |
   | Damage close-up #2 | Yes (second surface, or a second shot of a single surface) |

4. **Storm Confirmation** (`/inspection-storm`) — matches the property to a
   severe-weather event/date.
5. **Temporary Repairs & Mitigation** (`/inspection-mitigation`, optional here) —
   emergency tarping/mitigation with 📷 before & after photos; carries forward
   to the Phase 2 step.
6. **Checkpoint** — rep chooses "Mark Preliminary Complete" or "Proceed to FIPSA."

## Transition — FIPSA Agreement Gate

**Agreement** (`/inspection-agreement`) — must be signed before forensic work begins:
- WebView review of the legal agreement with a scroll-to-bottom gate
- Signature capture for **both** homeowner and rep
- Signed PDF generated and uploaded; agreement email sends automatically
- A 3-business-day FTC cooling-off warning appears if the rep opens the
  forensic hub too soon (acknowledgeable, not blocking)

## Phase 2 — Forensic Inspection (18 ordered steps)

Managed by the Forensic Hub (`app/inspection/[id].tsx`). An **Equipment Check**
attestation (ladder, drone, gauges, etc.) is required before proceeding.
Conditional steps only appear when their damage flag was set on the Elevation Walk.

1. **Arrival Log** ⛔ (`/inspection-arrival`) — sky, wind, temp, personnel
   present; GPS + local time auto-captured. All six required.
2. **Property Profile** (`/inspection-property-profile`) — construction type,
   stories, roof age + basis, deck type (prefilled from the lead).
3. **Elevation Walk** ⛔ (`/inspection-elevations`) — 📷 **1 required wide photo
   per elevation (Front / Right / Back / Left = 4 photos)** plus the four
   damage-found flags.
4. **Roof Facets & Measurements** ⛔ *(roof)* (`/inspection-roof`) — every facet
   F1…FN needs area, material, pitch; 📷 **each damage instance requires a
   photo**; whole-roof linear measurements.
5. **Test Squares** ⛔ *(roof)* (`/inspection-test-squares`) — 📷 **a test-square
   photo on every facet carrying hail damage**, plus hit counts.
6. **Roof Components & Penetrations** ⛔ *(roof)* (`/inspection-components`) —
   components documented per zone (📷 **one shared zone photo covers all
   components in that zone**); 📷 **every penetration requires its own photo**.
7. **Roofing Product ID** ⛔ *(roof)* (`/inspection-product`) — at least one
   product identification (catalog match with server-hydrated product data, or
   "unidentifiable"; discontinued-product entries can include a photo).
8. **Siding Inspection** ⛔ *(siding)* (`/inspection-siding`) — per facet S1…SN:
   damage classification, 📷 **1 facet photo**, 📷 **damage close-up photo(s)**
   when damaged, and 📷 **1 photo per positional component** (with action
   selected: detach/reset vs remove/replace).
9. **Collateral Sweep** *(collateral)* (`/inspection-collateral`) — 📷 labeled
   roof-level and ground-level photos, **or** an explicit "no collateral damage
   found" waiver. Not hard-gated.
10. **Interior / Attic** *(interior)* (`/inspection-interior`) — interior
    observations 📷 with photo, or an explicit no-interior-claim waiver.
11. **Repairability Assessment** *(roof or siding)*
    (`/inspection-repairability`) — see the protocol breakdown below. Optional:
    skipping omits the report section.
12. **Temporary Repairs & Mitigation** (`/inspection-mitigation`) —
    tarping/mitigation performed, 📷 before & after photos.
13. **Homeowner** (`/inspection-homeowner`) — prior repairs / prior claims
    intake (optional).
14. **Existing / Unrelated Conditions** (`/inspection-existing-conditions`) —
    pre-existing conditions explicitly excluded from the claim.
15. **Declaration** ⛔ (`/inspection-declaration`) — inspector signs the
    methodology attestation.
16. **AI Summary** (`/inspection-summary`) — optional; AI drafts the forensic
    narrative for review.
17. **Estimate** (`/inspection-estimate`) — optional advisory pricing from the
    company price book (never gates submit).
18. **Readiness & Submit** ⛔ (`/inspection-readiness`) — zero deficiencies
    remaining, rep confirms, package submits.

## Repairability Assessment Protocol (asphalt shingle)

1. **Gate:** "Is a Repairability Assessment warranted and authorized at this
   time?" — Yes / Not Warranted – Discontinued / Not Authorized. Only **Yes**
   opens the flow.
2. **Repairability assessed on:** Roof / Siding (pre-selected from marked damage).
3. **Type of Roof:** Asphalt Shingle (more types planned).
4. **Marking instructions** — mark X, shingles 1–2 below, 3–4 left/right, 5–6
   above, 7–8 above those (if needed).
5. **"How many shingles require manipulation to complete the protocol?"** —
   6 / 7 / 8 → supplies the Manipulated shingles scorecard count.
6. 📷 **RAP1 photo** — required marked-layout photograph.
7. **Pull instructions** — break seals (flat bar or 5-in-1), remove nails, pull X.
8. **Mat transfer on Shingle 1 and Shingle 2** — Yes/No each.
9. **Replace & re-secure instructions** — replace X, re-nail in new holes
   (straight and flush), hand-tap every 6 inches (no tools).
10. **Damage questions 1–5** — each Yes opens the xA follow-up: select affected
    shingles (3 up to the manipulation count — e.g. 7 chosen means no 8) +
    📷 one example photo with note:
    1. Delamination
    2. Creasing, cracking or fracturing
    3. Nail pull-through / nail-zone damage
    4. Puncture, tearing or gouge while releasing seals
    5. Failure to re-seat flat / unable to be properly resecured
11. **Live Scorecard** (unique-shingle counting — a shingle with two damage
    types counts once):
    - Manipulated shingles (from the 6/7/8 answer)
    - New collateral-damaged shingles (unique count)
    - Mat-transfer findings on 1–2
    - Delamination / Creasing-cracking-fracture / Nail-zone /
      Puncture-tear-gouge / Reseating counts

**Report output:** the scorecard, the RAP1 photo, and up to 2 example photos —
priority to 1 delamination and 1 creasing/cracking/fracture example.

## Photo requirements summary

| Step | Photos | Required |
|---|---|---|
| Preliminary | Front, roof overview, 2 damage close-ups | Yes |
| Elevation Walk | 4 wide (one per elevation) | Yes ⛔ |
| Roof Facets | 1 per damage instance | Yes ⛔ |
| Test Squares | 1 per hail facet | Yes ⛔ |
| Components | 1 per zone; 1 per penetration | Yes ⛔ |
| Siding | Facet + damage close-up + per-component | Yes ⛔ |
| Collateral | Roof- & ground-level labeled | Optional (or waiver) |
| Interior | Observation photos | If interior claimed (or waiver) |
| Repairability (RAP) | RAP1 + 1 example per Yes damage question | RAP1 yes; examples per finding |
| Mitigation | Before & after | When mitigation performed |
