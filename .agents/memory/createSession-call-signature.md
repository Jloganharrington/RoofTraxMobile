---
name: createSession call signature
description: createSession takes a single SessionData object — wrong positional args silently store a string in the session, causing 401 on every authenticated request in tests.
---

## Rule
`createSession` takes **one argument**: `{ user: AuthUser, access_token: string }`.

Calling it as `createSession(userId, companyId, { ... })` is a JS signature mismatch — the function receives `userId` (a string) as `data`. That string is stored as the session's `sess` JSONB. When the auth middleware reads it back, `session.user` is undefined → clears the session → 401 on every route.

## Why
The TypeScript type `SessionData` is an object, not a string. Calling with positional args doesn't throw at runtime — JS just passes `userId` as the first (and only) argument. No error until you see all 401s in tests.

## How to apply
In test helper functions that seed sessions, always use:

```typescript
const sid = await createSession({
  user: {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    companyId,
  },
  access_token: 'test-tok',
});
```

And use `Authorization: Bearer ${sid}` (not `Cookie: sid=...`) in supertest requests.
