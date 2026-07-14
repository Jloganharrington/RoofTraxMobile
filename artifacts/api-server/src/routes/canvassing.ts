import {
  ClockInCanvassingResponse,
  ClockOutCanvassingResponse,
  GetCurrentCanvassingSessionResponse,
} from '@workspace/api-zod';
import { canvassingSessionsTable, db } from '@workspace/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Canvassing time tracking (B2). Available to any authenticated user — all
// field roles canvass. Company scoping is stamped from the session. At most
// one open session per user is enforced here (not a DB constraint) so a
// duplicate clock-in returns a clean 409 rather than creating a second row.

async function requireUser(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return { userId: req.user.id, companyId: req.user.companyId };
}

async function findOpenSession(userId: string, companyId: string) {
  const [session] = await db
    .select()
    .from(canvassingSessionsTable)
    .where(
      and(
        eq(canvassingSessionsTable.userId, userId),
        eq(canvassingSessionsTable.companyId, companyId),
        isNull(canvassingSessionsTable.endedAt),
      ),
    )
    .orderBy(desc(canvassingSessionsTable.startedAt));
  return session;
}

router.get('/canvassing/current', async (req: Request, res: Response) => {
  const actor = await requireUser(req, res);
  if (!actor) return;

  const session = await findOpenSession(actor.userId, actor.companyId);
  res.json(GetCurrentCanvassingSessionResponse.parse({ session: session ?? null }));
});

router.post('/canvassing/clock-in', async (req: Request, res: Response) => {
  const actor = await requireUser(req, res);
  if (!actor) return;

  const existing = await findOpenSession(actor.userId, actor.companyId);
  if (existing) {
    res.status(409).json({ error: 'A canvassing session is already open' });
    return;
  }

  const [session] = await db
    .insert(canvassingSessionsTable)
    .values({ companyId: actor.companyId, userId: actor.userId })
    .returning();

  res.status(201).json(ClockInCanvassingResponse.parse({ session }));
});

router.post('/canvassing/clock-out', async (req: Request, res: Response) => {
  const actor = await requireUser(req, res);
  if (!actor) return;

  const open = await findOpenSession(actor.userId, actor.companyId);
  if (!open) {
    res.status(404).json({ error: 'No open canvassing session to end' });
    return;
  }

  const [session] = await db
    .update(canvassingSessionsTable)
    .set({ endedAt: new Date() })
    .where(eq(canvassingSessionsTable.id, open.id))
    .returning();

  res.json(ClockOutCanvassingResponse.parse({ session }));
});

export default router;
