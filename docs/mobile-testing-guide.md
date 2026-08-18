# AxiomRestore Mobile App — Testing Guide

> **How to use this guide**
> Log in through the Developer Login panel (small amber link, top-left of the login screen) to switch between personas instantly. Each section notes which persona(s) to use. Work top-to-bottom or jump to the section you care about.

---

## 0 — Dev Login & Auth

### 0-A Developer Login
1. Open the app to the login screen.
2. Tap **Developer Login** (top-left, small amber text).
3. Enter your dev credentials → tap **Authenticate**.
4. Seven persona buttons appear. Tap one to log in instantly.
5. After 24 hours the panel stays up without re-entering credentials; verify by closing and reopening the app within the window.

**Verify:** Correct name/role shown in Profile after login.

### 0-B OIDC Login (real account)
1. Hide the dev panel (tap **⚙ Dev**).
2. Tap **Log in** → complete Replit OIDC flow.
3. If no company is linked, expect a "join a company" prompt.

### 0-C PP Email Login
1. Tap **Join a company** → enter a PP-only company ID.
2. Expect the email + password form (not OIDC button).
3. Wrong email → **"Username not found."**
4. Wrong password → **"Password is incorrect."**
5. Tap **Forgot password?** → enter email → expect reset email (or success message).

### 0-D Logout
1. Profile tab → **Log out**.
2. App returns to login screen immediately (no spinner/delay).
3. Dev panel is still unlocked if within the 24-hour window.

---

## 1 — Home / Dashboard

**Persona:** Field Rep, Manager, Admin, Super Admin

### 1-A Dashboard loads
1. Log in as **Field Rep**.
2. Home tab shows KPI cards, activity feed, and/or leaderboard.
3. Pull down to refresh — data reloads without error.

### 1-B Clock In / Clock Out
1. On Home, locate the clock-in button.
2. Tap **Clock In** — status updates.
3. Tap **Clock Out** — status resets.

### 1-C CRM upgrade prompt (PP-only company)
1. If testing a PP-only company, Home shows an **Upgrade Required** screen instead of the leads board.
2. Verify CTA copy is correct.

---

## 2 — Map & Pin Management

**Persona:** Field Rep, Manager, Admin (canvassers see a limited map)

### 2-A Map loads
1. Tap the map from Home or navigate to the map screen.
2. Location permission prompt appears on first use — allow it.
3. Pins for the company appear as colored dots.

### 2-B Pin colors (canvasser-specific)
1. Log in as **Canvasser – Retail**.
2. Your own pins appear in the brand color; other reps' pins appear muted/grey.

### 2-C Add a pin
1. **Field Rep** → tap **Add Pins** (map header).
2. Search or tap map to set location.
3. Fill in customer name, address, workflow (retail / insurance).
4. Save — pin appears on map immediately.

### 2-D Edit a pin
1. Tap an existing pin → tap **Edit**.
2. Change customer name → save.
3. Verify updated name on map callout.

### 2-E Bulk upload
1. **Admin** → tap **Bulk Upload** from the map.
2. Upload a CSV of leads.
3. Verify pins appear on map after upload.

### 2-F Address autocomplete
1. In the new-pin or edit-pin form, type a partial address.
2. Suggestions appear within ~1 second.
3. Tap a suggestion — fields populate.

### 2-G Filter pins
1. On map, open the filter/search panel.
2. Filter by workflow (retail / insurance).
3. Only matching pins remain visible.
4. **Manager/Admin:** filter by specific rep using the rep picker.

---

## 3 — Change Orders

**Persona:** Field Rep, Manager, Admin, Super Admin  
*(Canvassers do not see this tab)*

### 3-A List loads
1. Tap **Change Orders** tab.
2. List shows all active (non-voided) jobs in the company.
3. **"CO Verify – Test Job"** should appear (seeded in QA).
4. Pull to refresh — list updates.

### 3-B Create a change order from a job
1. Tap **CO Verify – Test Job** (or any job row).
2. Change-order form opens pre-filled with the job.
3. Add at least one line item (description, quantity, price).
4. Proceed to the signature step.
5. Sign with finger → submit.
6. CO appears in the server-side records (verify via CRM web app if needed).

### 3-C Create a change order via FAB
1. Tap the **+** FAB (bottom-right).
2. Pick a job from the job picker.
3. Complete the same form flow as 3-B.

### 3-D Offline change order
1. Enable Airplane Mode on device.
2. Create a change order and sign it.
3. App shows "saved locally — will sync when back online."
4. Re-enable connectivity.
5. Outbox drains automatically — CO syncs within seconds.

---

## 4 — Inspections

**Persona:** Field Rep (inspector_canvasser dept), Admin, Super Admin  
*(Managers and canvassers do not see this tab)*

### 4-A Inspections list loads
1. Tap **Inspections** tab.
2. List shows scheduled and in-progress inspections.
3. Statuses: **Scheduled**, **In Progress**, **Validating**, **Submitted**, **Package Ready**.

### 4-B Start a new inspection
1. Tap **Start Inspection** (or equivalent CTA).
2. Select or create a lead/job to attach it to.
3. Walk through intake step — fill in property details.
4. Inspection appears in list as **In Progress**.

### 4-C Reschedule a scheduled inspection
1. Long-press a **Scheduled** inspection.
2. Date-picker modal appears.
3. Pick a new date → confirm.
4. Updated date shown in list.

### 4-D Cancel an inspection
1. Long-press a **Scheduled** inspection.
2. Tap **Cancel** → confirm destructive action.
3. Inspection removed from list.

### 4-E Protocol — Photo capture
1. Open an in-progress inspection → Photos step.
2. Tap a photo slot → camera opens.
3. Capture photo — thumbnail appears in slot.
4. Attempt to proceed without required photos — gate blocks with a clear message.

### 4-F Protocol — AI analysis
1. After photos are captured, trigger the AI analysis step.
2. Progress indicator shows while model runs.
3. Results appear (facet counts, areas, pitches).
4. Inspector confirms or adjusts values.

### 4-G Submit an inspection
1. Complete all required steps.
2. Tap **Submit** — confirmation modal appears.
3. Confirm — status changes to **Submitted**.
4. Re-open the inspection — it's read-only.

### 4-H Offline inspection sync
1. Enable Airplane Mode.
2. Capture photos, fill fields.
3. Photos and writes queue in the outbox.
4. Restore connectivity — outbox drains and data syncs to server.

---

## 5 — Documents

**Persona:** Field Rep (inspector_canvasser), Admin, Super Admin

### 5-A Documents list loads
1. Tap **Documents** tab.
2. List shows FIPSA agreements, Phase 1 reports, Phase 2 reports.
3. Filter chips: **All / FIPSA / Phase 1 / Phase 2** — tap each, list narrows correctly.

### 5-B Search
1. Type in the search bar.
2. List filters to matching document/customer names.

### 5-C Open a FIPSA agreement
1. Tap a FIPSA row.
2. Options: **Open PDF**, **Resend** (email modal).
3. Open PDF — PDF viewer or browser opens.
4. Resend — enter email address → send → success toast.

### 5-D Open a Phase 1 report
1. Tap a **Phase 1** row.
2. Homeowner report opens (in-app or browser).

### 5-E Open a Phase 2 / Inspection Hub
1. Tap a **Phase 2** row.
2. Inspection hub opens with full report detail.

---

## 6 — Profile

**Persona:** All (canvassers see a reduced view)

### 6-A Profile loads
1. Tap **Profile** tab.
2. Name, email, role, workflow assignment are correct for the active persona.

### 6-B Workflow label
| Persona | Expected label |
|---|---|
| Canvasser – Retail | Retail |
| Canvasser – Insurance | Insurance |
| Canvasser – Both | Insurance & Retail |
| Field Rep | Insurance & Retail |
| Manager | Insurance & Retail |
| Admin | Insurance & Retail |

### 6-C Canvasser — reduced profile
1. Log in as **Canvasser – Retail**.
2. **My Profile** accordion is hidden.
3. **Email Sending** accordion is hidden.
4. Only fields appropriate for a canvasser are shown.

### 6-D Non-canvasser — full profile
1. Log in as **Field Rep**.
2. **My Profile** accordion is visible — tap to expand.
3. **Email Sending** accordion is visible.

### 6-E Signature
1. **Field Rep** → Profile → Signature section.
2. Draw a signature → save.
3. Leave and return — signature persists.

---

## 7 — Canvasser Flows

**Personas:** Canvasser – Retail, Canvasser – Insurance, Canvasser – Both

### 7-A Tab visibility
| Tab | Canvasser sees? |
|---|---|
| Home | ✅ |
| Change Orders | ❌ (hidden) |
| Inspections | ❌ (hidden) |
| Documents | ❌ (hidden) |
| Profile | ✅ (reduced) |

### 7-B Map — own vs others' pins
1. Log in as **Canvasser – Retail**.
2. Drop a new pin → it appears in brand color.
3. Other reps' pins appear muted/grey.

### 7-C Workflow-filtered content
1. **Canvasser – Retail** → verify only retail workflow content is surfaced.
2. **Canvasser – Insurance** → verify insurance content.
3. **Canvasser – Both** → verify both workflows are available.

---

## 8 — Notifications & Deep Links

### 8-A Push notification permission
1. First launch on a physical device.
2. Permission prompt appears — allow.
3. Token registers with server (no error in Profile or console).

### 8-B Notification deep link — inspection
1. Trigger an inspection-related push notification (or simulate via server).
2. Tap notification.
3. App opens directly to the relevant inspection.

### 8-C Notification deep link — change order
1. Trigger a CO-related notification.
2. Tap — app opens directly to the Change Orders tab.

---

## 9 — Offline & Outbox

### 9-A Outbox drains on reconnect
1. Enable Airplane Mode.
2. Create a pin, capture a photo, start a CO.
3. All three queue locally — no error shown.
4. Re-enable connectivity.
5. Within ~10 seconds all three sync silently.

### 9-B Idempotent replay
1. Make an offline write.
2. Force-quit and reopen app before connectivity returns.
3. Outbox replays from where it left off — no duplicate records on the server.

---

## 10 — Bug Reporting (Beta)

### 10-A Submit a bug report
1. Tap the floating **bug report** pill (visible in beta builds).
2. Set severity, enter description.
3. Optionally attach a screenshot.
4. Submit — confirmation shown.

---

## 11 — Persona Matrix (quick reference)

| Feature | Canv (any) | Field Rep | Manager | Admin | Super Admin |
|---|---|---|---|---|---|
| Home / Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Map — view pins | ✅ (muted others) | ✅ | ✅ | ✅ | ✅ |
| Map — add pin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Map — edit any pin | ❌ | Own only | ✅ | ✅ | ✅ |
| Change Orders tab | ❌ | ✅ | ✅ | ✅ | ✅ |
| Inspections tab | ❌ | ✅ | ❌ | ✅ | ✅ |
| Documents tab | ❌ | ✅ | ❌ | ✅ | ✅ |
| Profile — full | ❌ | ✅ | ✅ | ✅ | ✅ |
| Clock In/Out | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bulk pin upload | ❌ | ❌ | ❌ | ✅ | ✅ |
| Filter pins by rep | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## 12 — Known Test Data (ZZTEST_ALPHA company)

| Persona | Email | Role / Dept / Workflow |
|---|---|---|
| Canvasser – Retail | a-canv-1@zztest.local | field_rep / canvasser / retail |
| Canvasser – Insurance | a-canv-ins@zztest.local | field_rep / canvasser / insurance |
| Canvasser – Both | a-canv-both@zztest.local | field_rep / canvasser / insurance_retail |
| Field Rep | a-insp-1@zztest.local | field_rep / inspector_canvasser / insurance_retail |
| Manager | a-mgr-f@zztest.local | manager / inspector_canvasser / insurance_retail |
| Admin | a-admin@zztest.local | admin / office / insurance_retail |
| Super Admin | a-super@zztest.local | super_admin / office / insurance_retail |

**Seeded jobs (ZZTEST_ALPHA):**
- CO Verify – Test Job (742 Evergreen Terrace, Springfield IL) — `contract_signed`, insurance_retail
- ZZTEST Retail Homeowner (1600 Pennsylvania Ave NW) — `pin_dropped`, retail
- ZZTEST Retail Homeowner (1600 Pennsylvania Ave NW) — `deposit_received`, retail
- ZZTEST Insurance Homeowner (N Street NW) — `claim_approved`, insurance
