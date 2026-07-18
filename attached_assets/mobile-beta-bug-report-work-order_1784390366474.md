# Work Order — Beta Bug Reporting (temporary, flag-gated)

**Repo:** RoofTraxMobile · **Who builds:** Replit (mobile + api-server)
**Context:** beta launch to 20–30 contractors. This is a **temporary beta instrument**,
built so it can be switched off by config at the end of beta — not ripped out by revert.

**Design constraint that drives everything below:** a roofer standing on a roof will type
one sentence and hit submit. The value of this feature is **not** the sentence — it is the
**context captured automatically alongside it**. A bug report that says "photos broke"
with no screen, version, or inspection ID is unactionable. Build the context capture first.

---

## 1. One component, not 34 screens

The app is expo-router with a root `app/_layout.tsx`. **Do not add a button to each of the
34 screens.** Mount a single floating overlay in the root layout; it renders above every
screen automatically.

- New `components/BugReportButton.tsx` — a small floating pill/FAB, bottom-right,
  deliberately low-contrast so it never competes with primary actions. Must not overlap
  the camera shutter on capture screens or the primary CTA on step screens — check
  `inspection-photo-capture.tsx` and `inspection-readiness.tsx` specifically.
- Mount once in `app/_layout.tsx`.
- **Current screen is derived, not passed:** use expo-router's `usePathname()` /
  `useSegments()`. No per-screen prop wiring, nothing to keep in sync.
- Hide it on the auth/login screen (no user context to attach yet).

## 2. Auto-captured context (the actual deliverable)

On open, snapshot **without asking the user**:

| Field | Source | Why it matters |
|---|---|---|
| `route` | `usePathname()` | which screen — the whole point |
| `routeParams` | `useLocalSearchParams()` | which inspection/facet/pin |
| `appVersion`, `buildNumber` | `expo-constants` | "fixed in 1.4.2" needs to know they're on 1.4.1 |
| `platform`, `osVersion` | RN `Platform` (built-in) | iOS-vs-Android-only bugs |
| `userId`, `companyId`, `role`, `department` | existing session | who to call back; permission bugs |
| `inspectionId`, `phase`, `currentStep` | route params + inspection state | reproduces the exact record |
| `damageFlags` | inspection state | v2.1 conditional-step bugs are invisible without this |
| `pendingOutboxCount`, `lastSyncError` | `listAllOutboxItems()` | distinguishes "app broke" from "sync backed up" — expect a LOT of these |
| `isOnline` | existing connectivity signal | most field bugs are offline bugs |
| `capturedAt` | device clock | ordering |

**No new dependencies.** `expo-constants` and `expo-image-picker` are already installed;
`Platform` is built into React Native. Do not add `expo-device` or netinfo for this — the
1-day `minimumReleaseAge` supply-chain gate in `pnpm-workspace.yaml` applies, and the
marginal detail isn't worth it. If you believe one is genuinely required, flag it and stop
rather than adding it.

## 3. The form (keep it brutally short)

1. **What went wrong?** — multiline text, required, autofocused. This is the only required field.
2. **Severity** — three chips: `Blocks me` / `Annoying` / `Cosmetic`. Default `Annoying`.
3. **Attach screenshot** — optional, via `expo-image-picker` from the photo library. The
   reporter takes a normal phone screenshot of the broken state, then attaches it. (This is
   why no screen-capture dependency is needed.) Reuse the existing photo upload path.
4. **Submit** / **Cancel**.

Show the captured screen name as read-only text ("Reporting from: Roof Facets &
Measurements") so the reporter trusts it's attached and doesn't retype it.

On submit: close immediately with a toast — **"Thanks — sent. Logan can reach you at the
number on your profile."** Never block on the network (see §4).

## 4. Offline-first — reuse the outbox (non-negotiable)

The bugs most worth catching happen with no signal. A report that requires connectivity
fails exactly when it's most needed.

- Add `'bug_report'` to `OutboxItemKind` in `lib/outbox/types.ts`.
- Add `BugReportOutboxPayload` following the existing payload interfaces.
- Add a handler to `OUTBOX_HANDLERS` in `lib/outbox/handlers.ts`.
- Submit = `enqueueOutboxItem('bug_report', payload)`. It drains with everything else.
- Screenshot rides the existing photo-upload mechanism, not a new one.

**Do not let a failing bug report block the inspection outbox.** If the bug-report handler
fails repeatedly it must go `dead` on its own without stalling the queue behind it — verify
this, since an inspection failing to submit because a bug report is wedged would be a far
worse bug than any it reports.

## 5. Storage + server

- New table `bug_reports`: `id, companyId, userId, route, routeParams jsonb, severity,
  description text, context jsonb, screenshotRef nullable, appVersion, platform, osVersion,
  createdAt, status varchar default 'new', resolvedAt nullable, internalNote text nullable`.
- `POST /bug-reports` — authenticated, company-scoped, **rate-limited** (e.g. 10/user/hour)
  so a stuck retry loop can't flood the table.
- Store the whole `context` blob as jsonb — do not flatten into columns you'll regret.
  Over-capture now; you cannot retroactively collect context from a beta that already ended.

## 6. Viewing them (keep it in one repo)

Do **not** build a cross-service auth path to the Brain for this. For a 20–30 person beta
producing maybe a few dozen reports, add a minimal in-app list:

- `GET /bug-reports` — role-gated to `admin` / `super_admin` (use `lib/permissions.ts`).
- A simple in-app screen: newest first, severity chip, screen name, reporter, description,
  tap for full context + screenshot, and mark `new → triaged → fixed`.
- Also expose **`GET /bug-reports/export.csv`** — with 30 contractors reporting, triaging
  in a spreadsheet will beat any UI you build in a week.

## 7. Turning it off after beta (build this in now)

The button is temporary; **removal must be a config toggle, not a code change.**

- Gate rendering on a company/config flag — `betaBugReporting` on the existing company
  settings, defaulting **on** for beta.
- End of beta = flip the flag. No revert, no regression risk, and it can be re-enabled
  instantly for the next beta cohort.
- Leave the table and data in place when disabling.

## 8. Privacy

Bug descriptions and attached screenshots **will** contain homeowner names, addresses, and
claim details — a screenshot of a broken inspection screen is by definition full of PII.

- Lives in the **app production DB**, same governance as inspection data. Not the
  agent-swarm Supabase.
- Company-scoped on read: one contractor must never see another's reports.
- Screenshots go to the same object storage as inspection photos, under the same access rules.

## 9. Verification (state in the completion report)

1. Button appears on all 34 screens; hidden on login; overlaps nothing on
   `inspection-photo-capture` or `inspection-readiness`.
2. Reported from three different screens → each stores the **correct distinct** `route`.
3. Reported mid-inspection → `inspectionId`, `phase`, `currentStep`, `damageFlags` all
   present and correct in `context`.
4. **Airplane mode**: submit succeeds, toast shows, report queues; re-connect → it drains.
5. A deliberately failing bug report goes `dead` **without** blocking a queued inspection
   submission behind it.
6. Screenshot attach → stored, viewable in the admin list.
7. Flag off → button gone everywhere, existing reports still readable, no crash.
8. Non-admin `GET /bug-reports` → 403. Cross-company read → empty/403.
9. Rate limit returns a sane error, does not crash the client or wedge the outbox.
10. Workspace typecheck clean.

## 10. Out of scope

- Crash/error auto-reporting (Sentry et al.) — different tool, different decision, later.
- Two-way messaging or a reply thread in-app. Logan calls the reporter; that's the loop.
- Brain or CRM surfacing of reports.
