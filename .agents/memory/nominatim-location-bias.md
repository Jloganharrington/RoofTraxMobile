---
name: Nominatim address search needs location bias
description: Why /geocode/search biases by viewbox + countrycodes, and the viewbox coordinate order gotcha
---

# Nominatim forward-search must be location-biased

Unbiased Nominatim `/search` free-text queries return globally-ranked junk for
partial address strings — a query like `2333 Ol` surfaces zip codes and places
in Spain/India/Vietnam before any local street. This is the default behavior and
it looks broken to a US field rep.

**The fix (in `lib/geocode.ts` searchAddress):**
- Always set `countrycodes=us` (RoofTrax is US field ops).
- When the rep's current location is available, pass a `viewbox` (~0.35deg box
  around them) with `bounded=0` so nearby results are *boosted*, not hard-clipped
  — an exact out-of-area address still resolves.

**Why:** location biasing is the only reliable lever; Nominatim's free API has no
address-only "type" filter and no true prefix/autocomplete mode.

**How to apply:**
- Viewbox order is `left,top,right,bottom` = `minLon,maxLat,maxLon,minLat`. Get
  the sign/order wrong and the box is empty or on the wrong hemisphere.
- The rep's coordinates flow from the mobile `useCurrentLocation` hook →
  optional `latitude`/`longitude` query params → `near` in searchAddress. Both
  coords must parse finite or it falls back to the unbiased (but still US-scoped)
  path. Keep it best-effort: permission denied ⇒ plain search, never an error.
