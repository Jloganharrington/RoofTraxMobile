---
name: Team roster route namespace
description: Team-roster routes moved from /admin/* to /team/*; gate distinctions between team CRUD (manager+) and org stats (admin+); task agent history note.
---

## Rule

Team user management routes live at `/team/users[/:userId]`, not `/admin/users[/:userId]`.

| Route | Gate | Notes |
|---|---|---|
| `GET /team/users` | `requireManagerOrAdmin` | Roster list |
| `PATCH /team/users/:userId` | `requireManagerOrAdmin` | Update role/dept/workflow |
| `DELETE /team/users/:userId` | `requireManagerOrAdmin` | `canSetRoleDeptSpec` / `actorOutranks` enforces rank — managers CAN delete strictly-lower-ranked users |
| `GET /admin/stats` | `requireAdmin` | PD-1: org-level stats are admin-tier only |

**Why:** Task agents have twice applied `requireAdmin` to the DELETE route, which is wrong. The policy ruling is that managers can delete users they outrank. The `actorOutranks` check (via `canSetRoleDeptSpec`) already enforces same-rank protection. Only `GET /admin/stats` is admin-only.

**How to apply:** If a future edit tightens DELETE back to `requireAdmin`, revert it. The correct gate is `requireManagerOrAdmin`. Check `artifacts/api-server/src/routes/admin.ts` (which still serves both /admin/* and /team/* routes in the same file — the filename is historical, not a namespace contract).
