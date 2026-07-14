---
name: orval coerce.string() swallows missing required query params
description: Why a required query param can pass zod validation as the literal "undefined" in orval-generated server zod, and how to guard it.
---

# orval `z.coerce.string()` swallows missing required query params

For a **required** query parameter, orval generates `z.coerce.string()` in the
server-side zod params schema. `coerce.string()` calls `String(value)` before
validating — and `String(undefined)` is the literal string `"undefined"`. So
when the client omits the param entirely, `safeParse` **succeeds** with
`{ location: "undefined" }` instead of failing. A route that relies on
`safeParse` to reject a missing required query param will instead proceed with
the bogus string.

**Why:** this bit the weather endpoint — a missing `location` sailed past
validation as `"undefined"` and was used as a real query key.

**How to apply:** for any required query param on a GET route, guard on the
raw `req.query.<name>` presence (e.g. `if (!req.query.location) return 400`)
*before* trusting the parsed value. Don't assume the generated zod params
schema catches an absent required query param — it doesn't for string coercion.
