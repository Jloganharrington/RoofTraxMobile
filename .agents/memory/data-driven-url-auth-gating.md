---
name: Data-driven URL auth gating
description: Never attach the session Bearer token to a fetch whose URL comes from a record; gate it to the trusted API origin.
---

# Gate the Bearer token to the trusted API origin for data-driven URLs

When the mobile app fetches a URL that originates from a **record/database field**
(e.g. an inspection `photo.url`) and attaches `Authorization: Bearer <token>`, it
must first verify the URL is on our own API origin. Otherwise a poisoned/attacker
-controlled absolute URL stored on the record would receive the session token —
a direct credential-exfiltration vector.

**Why:** photo URLs are data-driven (built server-side but stored as absolute
URLs on the record). A tenant or a compromised write path could plant a URL to
`https://evil.com/...`; an unconditional auth header would leak the Bearer token
to that host. Flagged in code review of the homeowner-report PDF feature.

**How to apply:**
- Compare against `getApiBaseUrl()` with a trailing-slash boundary:
  `url === base || url.startsWith(base + '/')` (after stripping trailing slashes
  from base). The `/` boundary stops look-alike hosts like
  `https://api.example.com.evil.com` from matching a `startsWith` prefix.
- Only attach the token when trusted; for any other URL fetch without auth (or
  reject). Local `file://` URIs never need auth.
- Applies to any future feature that embeds or downloads record-sourced URLs
  (reports, exports, thumbnails), not just photos.
