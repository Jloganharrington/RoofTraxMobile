---
name: Per-user SMTP report emailing
description: Constraints for the user-configurable SMTP send feature (security + UX)
---
Users store personal SMTP creds on their profile; the server emails report PDFs on their behalf.
**Rules:**
- Password is AES-256-GCM encrypted (keyed off SESSION_SECRET, smtpCrypto) and write-only — never returned by any API response.
- Any user-supplied outbound host is an SSRF vector: resolve DNS yourself, reject private/loopback/link-local/metadata ranges, and connect to the vetted IP with `tls.servername` = original host (smtpGuard). Applies to any future user-configurable outbound endpoint too.
- Large base64 uploads get a route-scoped express.json limit registered BEFORE the global parser (parsed bodies are skipped by later parsers); never raise the global limit.
- Mobile send failures must offer the device mail/share fallback — never dead-end a field rep offline.
