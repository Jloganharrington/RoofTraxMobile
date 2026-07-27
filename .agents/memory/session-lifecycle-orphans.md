---
name: Session lifecycle & orphan sessions
description: Why auth middleware must verify user existence and slide session expiry; test-minted sessions pollute dev DB.
---

- E2E tests mint real session rows (per api-server-e2e-testing.md) but never delete them; test cleanup deletes the users, leaving orphan sessions. An orphan session still authorizes reads (user data comes from the session JSON) but any insert with a users.id FK 500s.
- **Rule:** authMiddleware must verify the session's user row still exists before setting `req.user`; clear the session if not.
- **Rule:** session expiry slides — `touchSession` extends `sessions.expire` on authenticated activity, throttled ~1/hour/sid via a bounded in-memory map. Without it, active users get hard-logged-out 7 days after login (original cause of "can't upload photo" — presigned-URL request 401'd).
- Mobile `uploadFile` throws `UploadError(status, source)`; treat only `source==='api'` 401 as session-expired (presigned PUT 401s are storage-side).
