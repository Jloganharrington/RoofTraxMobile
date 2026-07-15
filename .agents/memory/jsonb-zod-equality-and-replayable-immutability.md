---
name: jsonb vs zod-parsed equality + replay-tolerant immutability guards
description: Comparing a jsonb column read from Postgres against a zod-parsed request body, and how to make an immutability guard survive offline outbox replays.
---

# jsonb-vs-body equality and replay-tolerant immutability

## Order-independent JSON comparison
A `jsonb` value read back from Postgres and the same object parsed from a
request body (via zod) can serialize their **keys in different orders**. A raw
`JSON.stringify(a) === JSON.stringify(b)` comparison of two structurally-equal
objects can therefore wrongly report a difference.

**Rule:** compare with a canonical serializer that recursively sorts object keys
(and drops `undefined`) before `===`. A small local `stableStringify` is enough;
don't reach for `JSON.stringify` directly on either side.

**Why:** this bit the storm-of-record immutability check — an idempotent replay
of the identical stored value was rejected as a "change" purely because of key
ordering.

## Immutability guards must tolerate idempotent replays
When a field becomes read-only after some transition (e.g. the storm of record
is editable in `preliminary` but read-only once `forensic`), enforcement lives
on the server route, not just the UI — a client can still `PATCH` the field.

But the mobile writes go through an **offline outbox** that can re-drain a queued
`PATCH` after the transition already happened. A hard reject of *any* value
would wedge that replay.

**Rule:** reject only a *genuine change* (incoming value differs from stored),
and allow a no-op replay of the identical value through as `200`. Combine with
the canonical comparison above.

**How to apply:** any "field X is immutable after state Y" guard on a route that
mobile reaches via the outbox needs: (1) gate on the record's *current* state,
(2) reject only when the canonical-serialized incoming value differs from the
stored one.
