---
name: Drizzle query error wrapping
description: DrizzleQueryError wraps pg DatabaseError — the pg error code lives on .cause, not the top level
---

## Rule

Never check `err.code === '23505'` (or any PostgreSQL error code) directly on the thrown error from drizzle-orm. The error is a `DrizzleQueryError` whose `code` property is `undefined`; the pg `DatabaseError` is nested on `.cause`, which has `code: '23505'`.

## Why

Drizzle-orm wraps pg driver errors in its own `DrizzleQueryError` class. Direct code checks like `(err as { code?: string }).code === '23505'` will always be `undefined` for drizzle queries, causing unique-constraint and other pg-level errors to fall through to the Express default handler → 500.

## How to apply

Use a helper like:

```ts
function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const anyErr = err as Record<string, unknown>;
  if (anyErr['code'] === '23505') return true; // direct pg (rare)
  const cause = anyErr['cause'];
  if (typeof cause === 'object' && cause !== null) {
    return (cause as Record<string, unknown>)['code'] === '23505';
  }
  return false;
}
```

The same pattern applies to any pg error code check (FK violations 23503, not-null 23502, etc.) in routes that use drizzle.

Apply to every route that does `try { db.insert/update } catch (err) { if (uniqueConstraint) ... }`.
