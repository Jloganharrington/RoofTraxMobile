import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { betaApplications } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router = Router();

const BetaApplyBody = z.object({
  firstName:     z.string().min(1).max(100),
  lastName:      z.string().min(1).max(100),
  email:         z.string().email().max(255),
  phone:         z.string().min(7).max(50),
  company:       z.string().min(1).max(255),
  state:         z.string().min(1).max(100),
  repCount:      z.string().min(1).max(50),
  claimVolume:   z.string().min(1).max(50),
  revenueRange:  z.string().min(1).max(100),
  currentStack:  z.string().min(1).max(255),
  challenge:     z.string().max(2000).default(""),
  referralSource: z.string().max(500).default(""),
  committed:     z.boolean(),
});

// Public endpoint — no auth required (unauthenticated marketing funnel)
router.post("/beta-apply", async (req, res) => {
  const parsed = BetaApplyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid submission", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  if (!data.committed) {
    return res.status(400).json({ error: "Beta commitment acknowledgement is required." });
  }

  try {
    await db.insert(betaApplications).values({
      firstName:      data.firstName,
      lastName:       data.lastName,
      email:          data.email,
      phone:          data.phone,
      company:        data.company,
      state:          data.state,
      repCount:       data.repCount,
      claimVolume:    data.claimVolume,
      revenueRange:   data.revenueRange,
      currentStack:   data.currentStack,
      challenge:      data.challenge,
      referralSource: data.referralSource,
    });

    logger.info({ email: data.email, company: data.company }, "Beta application received");
    return res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to save beta application");
    return res.status(500).json({ error: "Failed to save application. Please try again." });
  }
});

export default router;
