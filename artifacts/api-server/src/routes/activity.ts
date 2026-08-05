import { GetActivityStatsQueryParams, GetActivityStatsResponse } from '@workspace/api-zod';
import {
  canvassingSessionsTable,
  db,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { isManagerOrAdmin } from '@workspace/authz';

const router: IRouter = Router();

// Company-scoped canvassing activity stats (B1). Every number here is
// computed server-side over the canvassing cohort — the client only
// displays. `appointmentsCompleted` is a CRM-owned metric surfaced as null
// ("pending") until that seam is wired. All departments canvass, so the
// ranking cohort is every user in the company.

const DAY_MS = 24 * 60 * 60 * 1000;

interface PinAgg {
  pinsDropped: number;
  appointmentsSet: number;
}

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || 'Unknown';
}

async function pinMetrics(companyId: string, since: Date, userIds?: string[]): Promise<PinAgg> {
  const conds = [eq(pinsTable.companyId, companyId), gte(pinsTable.createdAt, since)];
  if (userIds) {
    if (userIds.length === 0) return { pinsDropped: 0, appointmentsSet: 0 };
    conds.push(inArray(pinsTable.userId, userIds));
  }
  const [row] = await db
    .select({
      pinsDropped: sql<number>`count(*)`,
      appointmentsSet: sql<number>`count(*) filter (where ${pinsTable.doorKnockResult} = 'appointment')`,
    })
    .from(pinsTable)
    .where(and(...conds));
  return {
    pinsDropped: Number(row?.pinsDropped ?? 0),
    appointmentsSet: Number(row?.appointmentsSet ?? 0),
  };
}

async function hoursTracked(companyId: string, since: Date, userIds?: string[]): Promise<number> {
  const conds = [
    eq(canvassingSessionsTable.companyId, companyId),
    gte(canvassingSessionsTable.startedAt, since),
  ];
  if (userIds) {
    if (userIds.length === 0) return 0;
    conds.push(inArray(canvassingSessionsTable.userId, userIds));
  }
  const [row] = await db
    .select({
      seconds: sql<number>`coalesce(sum(extract(epoch from (coalesce(${canvassingSessionsTable.endedAt}, now()) - ${canvassingSessionsTable.startedAt}))), 0)`,
    })
    .from(canvassingSessionsTable)
    .where(and(...conds));
  return Math.round((Number(row?.seconds ?? 0) / 3600) * 100) / 100;
}

router.get('/activity-stats', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedQuery = GetActivityStatsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: 'Invalid query' });
    return;
  }

  const companyId = req.user.companyId;
  const actorUserId = req.user.id;

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, actorUserId));
  const role = profile?.role ?? 'field_rep';
  const canViewLeaderboard = isManagerOrAdmin(role);

  // Cohort = every user in the company (all roles canvass).
  const cohortUsers = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.companyId, companyId));
  const cohortIds = cohortUsers.map((u) => u.id);

  // Resolve effective scope. Field reps are clamped to their own numbers.
  let scope: 'own' | 'total' | 'department' | 'individual' = parsedQuery.data.scope ?? 'own';
  let individualUserId: string | null = null;
  if (!canViewLeaderboard) {
    scope = 'own';
  } else if (scope === 'individual') {
    individualUserId = parsedQuery.data.userId ?? null;
    if (!individualUserId) {
      res.status(400).json({ error: 'scope=individual requires userId' });
      return;
    }
    if (!cohortIds.includes(individualUserId)) {
      res.status(404).json({ error: 'User not found in company' });
      return;
    }
  }

  const now = Date.now();
  const startOfToday = new Date(new Date(now).setUTCHours(0, 0, 0, 0));
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS);

  // Period (today) metrics reflect the selected scope.
  let periodUserIds: string[] | undefined;
  if (scope === 'own') periodUserIds = [actorUserId];
  else if (scope === 'individual' && individualUserId) periodUserIds = [individualUserId];
  else if (scope === 'department') periodUserIds = cohortIds;
  else periodUserIds = undefined; // total → whole company

  const periodPins = await pinMetrics(companyId, startOfToday, periodUserIds);
  const periodHours = await hoursTracked(companyId, startOfToday, periodUserIds);

  // Competitive panel: always actor-centric, trailing 30 days.
  const mePins = await pinMetrics(companyId, thirtyDaysAgo, [actorUserId]);
  const meHours = await hoursTracked(companyId, thirtyDaysAgo, [actorUserId]);
  const teamPins = await pinMetrics(companyId, thirtyDaysAgo, cohortIds);
  const teamHours = await hoursTracked(companyId, thirtyDaysAgo, cohortIds);

  // Per-user 30d aggregates for ranking + leaderboard.
  const perUserRows =
    cohortIds.length === 0
      ? []
      : await db
          .select({
            userId: pinsTable.userId,
            pinsDropped: sql<number>`count(*)`,
            appointmentsSet: sql<number>`count(*) filter (where ${pinsTable.doorKnockResult} = 'appointment')`,
          })
          .from(pinsTable)
          .where(
            and(
              eq(pinsTable.companyId, companyId),
              gte(pinsTable.createdAt, thirtyDaysAgo),
              inArray(pinsTable.userId, cohortIds),
            ),
          )
          .groupBy(pinsTable.userId);

  const aggByUser = new Map<string, PinAgg>();
  for (const r of perUserRows) {
    aggByUser.set(r.userId, {
      pinsDropped: Number(r.pinsDropped ?? 0),
      appointmentsSet: Number(r.appointmentsSet ?? 0),
    });
  }

  // Rank every cohort user by appointmentsSet, then pinsDropped, then name.
  const ranked = cohortUsers
    .map((u) => {
      const agg = aggByUser.get(u.id) ?? { pinsDropped: 0, appointmentsSet: 0 };
      return { user: u, ...agg };
    })
    .sort(
      (a, b) =>
        b.appointmentsSet - a.appointmentsSet ||
        b.pinsDropped - a.pinsDropped ||
        displayName(a.user).localeCompare(displayName(b.user)),
    );

  const myRankIndex = ranked.findIndex((e) => e.user.id === actorUserId);
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;

  const leaderboard = canViewLeaderboard
    ? ranked.map((e, i) => ({
        userId: e.user.id,
        name: displayName(e.user),
        pinsDropped: e.pinsDropped,
        appointmentsSet: e.appointmentsSet,
        appointmentsCompleted: null,
        rank: i + 1,
      }))
    : [];

  res.json(
    GetActivityStatsResponse.parse({
      stats: {
        scope,
        canViewLeaderboard,
        period: {
          pinsDropped: periodPins.pinsDropped,
          appointmentsSet: periodPins.appointmentsSet,
          appointmentsCompleted: null,
          hoursTracked: periodHours,
        },
        competitive: {
          me: {
            pinsDropped: mePins.pinsDropped,
            appointmentsSet: mePins.appointmentsSet,
            appointmentsCompleted: null,
            hoursTracked: meHours,
          },
          teamTotal: {
            pinsDropped: teamPins.pinsDropped,
            appointmentsSet: teamPins.appointmentsSet,
            appointmentsCompleted: null,
            hoursTracked: teamHours,
          },
          myRank,
          cohortSize: cohortIds.length,
        },
        leaderboard,
        myRank,
      },
    }),
  );
});

export default router;
