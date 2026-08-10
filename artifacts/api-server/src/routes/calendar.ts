/**
 * GET /calendar?from=ISO&to=ISO
 *
 * Unified team calendar feed — four sources, one normalised CalendarItem shape.
 *
 * Sources:
 *   inspection_phase1   inspections.scheduledFor  WHERE phase='preliminary'
 *   inspection_phase2   inspections.scheduledFor  WHERE phase='forensic'
 *   retail_appointment  pins.appointment_at
 *   adjuster_meeting    pins.adjusterMeetingDate
 *
 * Scoping mirrors GET /inspections/scheduled:
 *   field_rep  → only items assigned to them
 *   manager+   → the whole company
 *
 * Invariants:
 *   - Range is required; cap is 90 days; out-of-range → 400.
 *   - field_rep scope cannot be widened via any request parameter.
 *   - Company-scope enforced at every source via direct company_id column.
 *   - endsAt is always null (no source carries duration).
 */

import { and, between, eq, isNotNull } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  db,
  inspectionsTable,
  pinsTable,
  usersTable,
} from '@workspace/db';
import { requirePermission } from '../middlewares/requirePermission';
import { isManagerOrAdmin } from '@workspace/authz';
import { getRole } from './pins';

const router: IRouter = Router();

const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface CalendarItem {
  id:               string;
  type:             'inspection_phase1' | 'inspection_phase2' | 'retail_appointment' | 'adjuster_meeting';
  startsAt:         string;
  endsAt:           null;
  title:            string;
  propertyAddress:  string | null;
  assignedUserId:   string | null;
  assignedUserName: string | null;
  pinId:            string | null;
  inspectionId:     string | null;
  status:           string | null;
}

// calendar.view
router.get('/calendar', requirePermission('calendar.view'), async (req: Request, res: Response) => {

  // ── Parse & validate range ───────────────────────────────────────────────
  const fromRaw = req.query.from;
  const toRaw   = req.query.to;

  const rangeParsed = z.object({
    from: z.string().datetime({ offset: true }),
    to:   z.string().datetime({ offset: true }),
  }).safeParse({ from: fromRaw, to: toRaw });

  if (!rangeParsed.success) {
    res.status(400).json({ error: 'from and to are required ISO 8601 datetime strings' });
    return;
  }

  const from = new Date(rangeParsed.data.from);
  const to   = new Date(rangeParsed.data.to);

  if (to <= from) {
    res.status(400).json({ error: 'to must be after from' });
    return;
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    res.status(400).json({ error: 'Range exceeds the 90-day maximum. Narrow the window and retry.' });
    return;
  }

  // ── Resolve actor scope ──────────────────────────────────────────────────
  const userId    = req.actorCtx!.actorId;
  const companyId = req.actorCtx!.companyId;

  // Mirror the role scoping used by GET /inspections/scheduled.
  const role      = await getRole(userId);
  const isManager = isManagerOrAdmin(role);

  // ── Resolve user display names (batch lookup for assignee names) ─────────
  // We'll collect user IDs that appear in the results and resolve them all at once.
  const userNameCache = new Map<string, string>();
  async function resolveUserName(uid: string | null | undefined): Promise<string | null> {
    if (!uid) return null;
    if (userNameCache.has(uid)) return userNameCache.get(uid) ?? null;
    const [u] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, uid));
    const name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || null : null;
    if (name) userNameCache.set(uid, name);
    return name;
  }

  const items: CalendarItem[] = [];

  // ── Source 1 + 2: inspections (phase1 and phase2) ───────────────────────
  const inspectionRows = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        isManager ? undefined : eq(inspectionsTable.inspectorUserId, userId),
        isNotNull(inspectionsTable.scheduledFor),
        between(inspectionsTable.scheduledFor, from, to),
      ),
    );

  for (const row of inspectionRows) {
    const phase    = row.phase === 'preliminary' ? 'inspection_phase1' : 'inspection_phase2';
    const phaseLabel = row.phase === 'preliminary' ? 'Phase 1' : 'Phase 2';
    const assignee = await resolveUserName(row.inspectorUserId);

    items.push({
      id:               `insp:${row.id}`,
      type:             phase,
      startsAt:         row.scheduledFor!.toISOString(),
      endsAt:           null,
      title:            `${phaseLabel} Inspection — ${row.insuredName ?? row.address ?? 'Unknown'}`,
      propertyAddress:  row.address ?? null,
      assignedUserId:   row.inspectorUserId,
      assignedUserName: assignee,
      pinId:            row.pinId ?? null,
      inspectionId:     row.id,
      status:           row.status,
    });
  }

  // ── Source 3: retail appointments ───────────────────────────────────────
  const retailRows = await db
    .select()
    .from(pinsTable)
    .where(
      and(
        eq(pinsTable.companyId, companyId),
        isManager ? undefined : eq(pinsTable.userId, userId),
        isNotNull(pinsTable.appointmentAt),
        between(pinsTable.appointmentAt, from, to),
      ),
    );

  for (const row of retailRows) {
    // Assigned rep: appointmentAssignedTo (explicit assignee) takes precedence
    // over the pin's creating user (userId) for scope and display.
    const displayUserId = row.appointmentAssignedTo ?? row.userId;
    const assignee      = await resolveUserName(displayUserId);
    const ownerName     = row.customerName ?? (row.retailData as { ownerName1?: string } | null)?.ownerName1 ?? null;

    items.push({
      id:               `pin:${row.id}-appt`,
      type:             'retail_appointment',
      startsAt:         row.appointmentAt!.toISOString(),
      endsAt:           null,
      title:            `Appointment — ${ownerName ?? row.address ?? 'Unknown'}`,
      propertyAddress:  row.address ?? null,
      assignedUserId:   displayUserId,
      assignedUserName: assignee,
      pinId:            row.id,
      inspectionId:     null,
      status:           row.appointmentStatus ?? null,
    });
  }

  // ── Source 4: adjuster meetings ──────────────────────────────────────────
  const adjusterRows = await db
    .select()
    .from(pinsTable)
    .where(
      and(
        eq(pinsTable.companyId, companyId),
        isManager ? undefined : eq(pinsTable.userId, userId),
        isNotNull(pinsTable.adjusterMeetingDate),
        between(pinsTable.adjusterMeetingDate, from, to),
      ),
    );

  for (const row of adjusterRows) {
    const assignee  = await resolveUserName(row.userId);
    const ownerName = row.ownerFirstName || row.ownerLastName
      ? [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(' ')
      : row.customerName ?? null;

    items.push({
      id:               `pin:${row.id}-adj`,
      type:             'adjuster_meeting',
      startsAt:         row.adjusterMeetingDate!.toISOString(),
      endsAt:           null,
      title:            `Adjuster Meeting — ${ownerName ?? row.address ?? 'Unknown'}`,
      propertyAddress:  row.address ?? null,
      assignedUserId:   row.userId,
      assignedUserName: assignee,
      pinId:            row.id,
      inspectionId:     null,
      status:           null,
    });
  }

  // ── Sort by startsAt ascending ───────────────────────────────────────────
  items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  res.json({ items });
});

export default router;
