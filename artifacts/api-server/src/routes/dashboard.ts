import { GetDashboardManifestResponse, GetDashboardLayoutResponse, PatchDashboardLayoutBody } from '@workspace/api-zod';
import { db, userProfilesTable } from '@workspace/db';
import type { Department, Role, WorkflowAssignment } from '@workspace/authz';
import { selectWidgetsFor, WIDGET_CATALOG } from '@workspace/authz';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { requireWidgetCapability } from '../lib/dashboardGuard';

const router: IRouter = Router();

// ── Shared helper ────────────────────────────────────────────────────────────

interface ProfileAndLayout {
  role: Role;
  department: Department;
  workflow: WorkflowAssignment;
  layout: { hidden: string[]; order: string[] } | null;
}

async function loadProfileAndLayout(userId: string): Promise<ProfileAndLayout> {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  return {
    role: (profile?.role ?? 'field_rep') as Role,
    department: (profile?.department ?? 'canvasser') as Department,
    workflow: (profile?.workflowAssignment ?? 'retail') as WorkflowAssignment,
    layout: profile?.dashboardLayout ?? null,
  };
}

// ── GET /dashboard/manifest ──────────────────────────────────────────────────
// Role/department/workflow are always loaded from the authenticated user's
// profile row — never from the request body, query string, or any other
// client-supplied field. Client values cannot escalate privilege.
router.get('/dashboard/manifest', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { role, department, workflow, layout } = await loadProfileAndLayout(req.user.id);

  // Resolve the full capability set — this is the security boundary.
  // The layout can only hide or reorder; it can never GRANT an uncapable widget.
  const resolved = selectWidgetsFor({ role, department, workflow });
  const resolvedKeys = new Set(resolved.map((w) => w.key));
  const resolvedMap = new Map(resolved.map((w) => [w.key, w]));

  let widgets: typeof resolved;

  if (!layout) {
    widgets = resolved;
  } else {
    const { hidden = [], order = [] } = layout;
    const hiddenSet = new Set(hidden);

    // Ordered widgets: keys that are granted + not hidden + in the stored order
    const orderedWidgets = order
      .filter((key) => resolvedKeys.has(key) && !hiddenSet.has(key))
      .map((key) => resolvedMap.get(key)!)
      .filter(Boolean);

    const orderedKeySet = new Set(order);

    // Append resolved widgets not mentioned in order[], excluding hidden ones
    const unorderedWidgets = WIDGET_CATALOG
      .filter((w) => resolvedKeys.has(w.key) && !orderedKeySet.has(w.key) && !hiddenSet.has(w.key))
      .map((w) => resolvedMap.get(w.key)!)
      .filter(Boolean);

    widgets = [...orderedWidgets, ...unorderedWidgets];
  }

  const body = GetDashboardManifestResponse.parse({
    widgets: widgets.map((w) => ({ key: w.key, title: w.title, size: w.size })),
  });
  res.json(body);
});

// ── GET /dashboard/layout ────────────────────────────────────────────────────
// Returns ALL capability-resolved widgets with their current hidden state,
// so settings UIs can toggle individual widgets back on without a full reset.
// Unlike /manifest, hidden widgets ARE included (with hidden: true).
router.get('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { role, department, workflow, layout } = await loadProfileAndLayout(req.user.id);

  const resolved = selectWidgetsFor({ role, department, workflow });
  const resolvedKeys = new Set(resolved.map((w) => w.key));
  const resolvedMap = new Map(resolved.map((w) => [w.key, w]));

  const hiddenSet = new Set(layout?.hidden ?? []);
  const order = layout?.order ?? [];

  // Build display order: ordered visible first, then unordered (catalog order),
  // then hidden (catalog order). All are security-filtered to granted widgets.
  const orderedKeySet = new Set(order);

  const orderedVisible = order
    .filter((key) => resolvedKeys.has(key) && !hiddenSet.has(key))
    .map((key) => ({ ...resolvedMap.get(key)!, hidden: false }))
    .filter((w) => w.key !== undefined);

  const unorderedVisible = WIDGET_CATALOG
    .filter((w) => resolvedKeys.has(w.key) && !orderedKeySet.has(w.key) && !hiddenSet.has(w.key))
    .map((w) => ({ ...w, hidden: false as const }));

  const hiddenWidgets = WIDGET_CATALOG
    .filter((w) => resolvedKeys.has(w.key) && hiddenSet.has(w.key))
    .map((w) => ({ ...w, hidden: true as const }));

  const allWidgets = [...orderedVisible, ...unorderedVisible, ...hiddenWidgets];

  const body = GetDashboardLayoutResponse.parse({
    widgets: allWidgets.map((w) => ({
      key: w.key,
      title: w.title,
      size: w.size,
      hidden: w.hidden,
    })),
  });
  res.json(body);
});

// ── PATCH /dashboard/layout ──────────────────────────────────────────────────
// Persist the user's widget visibility and order preferences. Self-only.
// Security enforcement happens at manifest resolution time, not here.
router.patch('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Strict parse: rejects extra fields beyond hidden + order.
  const parsed = PatchDashboardLayoutBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  const { hidden, order } = parsed.data;

  await db
    .insert(userProfilesTable)
    .values({
      userId: req.user.id,
      dashboardLayout: { hidden, order },
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: { dashboardLayout: { hidden, order } },
    });

  res.status(204).end();
});

// ── DELETE /dashboard/layout ─────────────────────────────────────────────────
// Restore defaults by nulling the layout column.
router.delete('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  await db
    .update(userProfilesTable)
    .set({ dashboardLayout: null })
    .where(eq(userProfilesTable.userId, req.user.id));

  res.status(204).end();
});

// ── Widget data endpoints ────────────────────────────────────────────────────
// Every widget data route MUST use requireWidgetCapability(key) as its first
// middleware. Omission from the manifest is NOT access control — an attacker
// can call this URL directly. The guard re-checks the capability server-side
// on every request, independent of the manifest.

// GET /dashboard/widgets/action_required
// Payload is a placeholder — this endpoint proves the guard pattern (Task 4).
// Real query implementation follows in Task 8.
router.get(
  '/dashboard/widgets/action_required',
  requireWidgetCapability('action_required'),
  (_req: Request, res: Response) => {
    res.json({ items: [] });
  },
);

export default router;
