import { GetMyProfileResponse } from '@workspace/api-zod';
import { db, userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

router.get('/profile/me', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userId = req.user.id;

  let [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  if (!profile) {
    [profile] = await db
      .insert(userProfilesTable)
      .values({ userId })
      .onConflictDoNothing()
      .returning();

    if (!profile) {
      [profile] = await db
        .select()
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, userId));
    }
  }

  res.json(
    GetMyProfileResponse.parse({
      profile: {
        userId: profile.userId,
        role: profile.role,
        workflowAssignment: profile.workflowAssignment,
      },
    }),
  );
});

export default router;
