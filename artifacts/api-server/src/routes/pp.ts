/**
 * PP (Proof Package) self-serve subscriber auth routes.
 *
 * Public:
 *   POST /pp/checkout          — validate registration data, create Stripe checkout
 *   GET  /pp/register/confirm  — verify Stripe payment, provision company + user + session
 *   POST /pp/login             — email + password → session cookie
 *   POST /pp/logout            — destroy session
 *   GET  /pp/me                — return current PP session's user + company
 *   GET  /pp/verify            — verify email address (token from email link)
 *   POST /pp/password-reset    — send password reset email
 *   POST /pp/password-reset/confirm — apply new password from reset token
 *
 * PP sessions use the shared sessions table (session_type: 'pp') and hydrate
 * req.user exactly like OIDC sessions so all downstream requirePermission
 * checks work unchanged.
 *
 * Companies provisioned here get pp_tier = 'pp_only' and no CRM permission set.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  ahjCoverage,
  ahjPacksTable,
  ahjRequestsTable,
  attestationsTable,
  billingTerms,
  claimSectionsTable,
  companiesTable,
  companyJurisdictionPacksTable,
  damageInstancesTable,
  db,
  inspectionPhotosTable,
  inspectionProductsTable,
  inspectionSlopesTable,
  inspectionsTable,
  objectOwnershipTable,
  plans,
  ppPackageCreditsTable,
  ppPendingCheckoutsTable,
  ppPendingRegistrationsTable,
  priceBookItemsTable,
  standardsEntriesTable,
  testSquaresTable,
  claimSupplementsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { computeReadiness } from '../lib/readiness';
import type { EvaluationResult } from '@workspace/protocol';
import { Router, type IRouter, type Request, type Response } from 'express';
import { ObjectStorageService } from '../lib/objectStorage';
import { getPPLogoSignedUrl } from '../lib/ppLogoAccess';
import { renderCompiledReportHtml } from './inspections';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { clearSession, getSession, getSessionId } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/pp/crypto';
import { ppEmails, sendPPEmail } from '../lib/pp/mailer';
import { createPPSession } from '../lib/pp/session';
import { getUncachableStripeClient } from '../lib/stripe/stripeClient';

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a short human-typeable company ID (same alphabet as companies.ts). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
async function generateUniqueCompanyId(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const [existing] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, code));
    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique company ID');
}

/**
 * Returns the canonical origin for auth email links (verify, reset).
 * Uses only trusted environment variables — never derives from request
 * headers (Host / X-Forwarded-Host) to prevent host-header injection attacks.
 * Order of precedence:
 *   1. REPLIT_DEV_DOMAIN — injected by the Replit platform in development
 *   2. CANONICAL_ORIGIN  — operator-set in production (e.g. "https://app.rooftrax.com")
 *   3. PRODUCTION_ORIGIN — legacy alias, same semantics
 */
function trustedOrigin(): string {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  if (process.env.CANONICAL_ORIGIN) {
    return process.env.CANONICAL_ORIGIN;
  }
  if (process.env.PRODUCTION_ORIGIN) {
    return process.env.PRODUCTION_ORIGIN;
  }
  // Only reachable in fully-local dev where neither env var is set.
  return 'http://localhost:8080';
}

/**
 * Provision a company + founder user + userProfile atomically for a PP account.
 * Returns the new user row (for session creation).
 */
async function provisionPPAccount(opts: {
  companyName: string;
  email: string;
  passwordHash: string;
  // logoObjectPath intentionally omitted: object paths supplied during
  // unauthenticated checkout cannot be ownership-verified (the user doesn't
  // exist yet), so we always provision with no logo and let the subscriber
  // upload one post-auth via GET /pp/upload-url + PUT /pp/company/logo.
  workType?: string | null;
  tradeTypes?: string[] | null;
  ahjCoverageId?: string | null;
}) {
  const companyId = await generateUniqueCompanyId();

  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companiesTable)
      .values({
        id: companyId,
        name: opts.companyName,
        ppTier: 'pp_only',
        logoUrl: null, // set post-auth via authenticated upload
        workType: opts.workType ?? null,
        tradeTypes: opts.tradeTypes ?? null,
        ahjCoverageId: opts.ahjCoverageId ?? null,
      })
      .returning();

    const [user] = await tx
      .insert(usersTable)
      .values({
        companyId: company.id,
        email: opts.email.toLowerCase().trim(),
        passwordHash: opts.passwordHash,
        // emailVerifiedAt intentionally null until email link is clicked.
      })
      .returning();

    // First (and only initial) user is the admin.
    await tx
      .update(companiesTable)
      .set({ founderUserId: user.id })
      .where(eq(companiesTable.id, company.id));

    await tx
      .insert(userProfilesTable)
      .values({ userId: user.id, role: 'admin', department: 'inspector_canvasser' })
      .onConflictDoNothing();

    // ── Starter price book seed (Part 6 of workflow plan) ──────────────────
    // PP-only companies need a pre-populated price book or Stage 5 (estimate
    // builder) opens onto a blank page. Unit prices are intentionally left at 0
    // so contractors must set their own market rates.
    await tx.insert(priceBookItemsTable).values([
      {
        companyId: company.id,
        name: 'Standard Asphalt Shingle Roof System Replacement',
        unit: 'SQ',
        unitPrice: 0,
        description:
          'Remove one existing layer of standard asphalt roofing material and furnish and install a complete standard asphalt roofing system. The standard system includes synthetic underlayment, ice-and-water shield at eaves, valleys, and penetrations, starter course, field shingles, hip and ridge cap, drip edge, and complete flashing systems including pipe boot, valley, step, counter, headwall, and sidewall flashing. Includes ordinary tear-off labor, loading, transportation, disposal, installation labor, routine material handling, standard jobsite cleanup, and handling of materials and debris within 30 feet of the designated staging or loading area.\n\nStandard pricing applies to roof slopes of 10:12 or less and buildings up to three stories where ordinary delivery, staging, roof access, and ground access are available.\n\nRoof-sheathing replacement, permit fees, permit-administration services, code- or assembly-driven work outside the defined standard roof system including extended ice-and-water coverage and ventilation upgrades, specialty flashing fabrication, chimney crickets, skylight replacement, restricted-access labor, handling beyond 30 feet, specialized property protection, scaffolding, structural repairs, hazardous-material handling, additional roofing layers, and other documented site-condition changes are additional and priced under the applicable Price Book item or written change order.\n\nOne roofing square equals 100 square feet of measured roof surface. The quantity includes the documented waste factor required by roof geometry, material layout, and installation specifications.',
      },
      {
        companyId: company.id,
        name: 'Standard Vinyl Siding System Replacement',
        unit: 'SF',
        unitPrice: 0,
        description:
          'Remove one existing layer of standard siding material and furnish and install a complete standard-grade vinyl siding system. The standard system includes weather-resistive barrier, starter strip, horizontal field panels, inside and outside corner posts, J-channel, utility trim, finish trim, undersill trim, corrosion-resistant fasteners, and integration with existing serviceable flashing. Includes ordinary removal labor, loading, transportation, disposal, substrate inspection, installation labor, routine material handling, ordinary cutting and fitting around openings and penetrations, standard jobsite cleanup, and handling of materials and debris within 30 feet of the designated staging or loading area.\n\nStandard pricing applies to one- or two-story residential construction with a standard horizontal profile in a standard manufacturer color, over sound, installation-ready sheathing, at ordinary window and door density, where ordinary delivery, staging, and ground access are available.\n\nSheathing, framing, or structural repair, continuous-insulation and insulation-board replacement, specialty profiles including insulated, vertical, board-and-batten, shake, and scallop, premium or special-order colors, soffit, fascia, and trim wrap, window and door trim capping, shutters, vents, and mounting blocks beyond ordinary, gutter removal and reset, permit fees, permit-administration services, code- or assembly-driven work outside the defined standard siding system, restricted-access labor, handling beyond 30 feet, specialized property protection, scaffolding, hazardous-material handling, additional siding layers, and other documented site-condition changes are additional and priced under the applicable Price Book item or written change order.\n\nQuantity is measured by net wall surface area. The quantity includes the documented waste factor required by wall geometry, panel layout, and installation specifications.',
      },
      {
        companyId: company.id,
        name: 'Emergency Temporary Repair Services',
        unit: 'EA',
        unitPrice: 0,
        description:
          'Furnish and install temporary weather protection to arrest ongoing water intrusion until permanent repairs can be performed. Includes emergency mobilization, initial damage assessment, crew and vehicle, ordinary safety and fall-protection equipment, temporary covering material, fasteners, battens, and ballast as conditions require, temporary sealing of active penetrations, removal of loose debris presenting an immediate hazard, routine material handling, standard jobsite cleanup, and photographic documentation of the temporary repair before, during, and after installation.\n\nThis is a temporary protective measure. It does not restore the assembly, is not a permanent repair, and is not warranted against continued intrusion under sustained or severe weather.\n\nStandard pricing applies to a single mobilization within the normal service radius during ordinary business hours, on roof slopes of 10:12 or less and buildings up to three stories where safe roof access, ordinary staging, and ground access are available.\n\nAdditional mobilizations and return trips, covering beyond the included area, replacement of covering displaced by subsequent weather, after-hours and holiday response, structural stabilization and shoring, interior water extraction and drying, board-up of windows, doors, or wall openings, restricted-access labor, handling beyond 30 feet, specialized property protection, scaffolding, hazardous-material handling, extended monitoring and scheduled re-inspection, and any permanent repair are additional and priced under the applicable Price Book item or written change order. Standard pricing includes up to 300 square feet of temporary covering furnished and installed. Additional area is measured by covered surface and priced under the applicable Price Book item.',
      },
    ]);

    return { company, user };
  });
}

// ── AHJ coverage list ─────────────────────────────────────────────────────────

/**
 * GET /pp/ahj-coverage
 * Public (no auth). Returns all AHJ coverage rows where status is 'covered'
 * or 'in_progress', ordered by state then county.  Used by the registration
 * wizard's AHJ step and (aliased) by authenticated CRM users.
 */
async function getAhjCoverageRows() {
  return db
    .select({
      id: ahjCoverage.id,
      state: ahjCoverage.state,
      county: ahjCoverage.county,
      status: ahjCoverage.status,
      codeCycle: ahjCoverage.codeCycle,
    })
    .from(ahjCoverage)
    .where(sql`${ahjCoverage.status} IN ('covered', 'in_progress')`)
    .orderBy(asc(ahjCoverage.state), asc(ahjCoverage.county));
}

router.get('/pp/ahj-coverage', async (_req: Request, res: Response) => {
  const rows = await getAhjCoverageRows();
  res.json(rows);
});

// ── PP checkout ──────────────────────────────────────────────────────────────

const CheckoutBody = z.object({
  companyName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  logoObjectPath: z.string().max(500).nullable().optional(),
  // Work type fields — required for PP registration.
  workType: z.enum(['retail', 'insurance', 'retail_insurance']),
  tradeTypes: z.array(z.string().max(50)).min(1).max(10),
  // AHJ: exactly one of coverageId or requestJurisdiction must be non-empty.
  // Both may be absent only for legacy / dev requests; validated below.
  ahjCoverageId: z.string().max(100).optional().nullable(),
  ahjRequestJurisdiction: z.string().max(500).optional().nullable(),
}).superRefine((data, ctx) => {
  const hasCoverage = !!data.ahjCoverageId?.trim();
  const hasRequest = !!data.ahjRequestJurisdiction?.trim();
  if (!hasCoverage && !hasRequest) {
    ctx.addIssue({
      code: 'custom',
      path: ['ahjCoverageId'],
      message: 'Select a jurisdiction or provide a request text.',
    });
  }
  if (hasCoverage && hasRequest) {
    ctx.addIssue({
      code: 'custom',
      path: ['ahjRequestJurisdiction'],
      message: 'Provide either a coverage selection or a request text, not both.',
    });
  }
});

/**
 * POST /pp/checkout
 * Validates the registration fields, stores a pending registration, and
 * returns a Stripe checkout URL. The browser redirects to Stripe; on success
 * Stripe redirects to /rooftrax-web/pp/register/confirm?session_id=...
 */
router.post('/pp/checkout', async (req: Request, res: Response) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid fields', detail: parsed.error.flatten().fieldErrors });
    return;
  }
  const { companyName, email: rawEmail, password, logoObjectPath,
    workType, tradeTypes, ahjCoverageId, ahjRequestJurisdiction } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  // Check email uniqueness across users AND pending registrations.
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existingUser) {
    res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    return;
  }

  // Validate the supplied coverage ID exists and is publicly selectable.
  if (ahjCoverageId) {
    const [coverageRow] = await db
      .select({ id: ahjCoverage.id, status: ahjCoverage.status })
      .from(ahjCoverage)
      .where(eq(ahjCoverage.id, ahjCoverageId));
    if (!coverageRow || !['covered', 'in_progress'].includes(coverageRow.status)) {
      res.status(400).json({ error: 'The selected jurisdiction is not available. Please choose from the list.' });
      return;
    }
  }

  const pwHash = await hashPassword(password);

  // Upsert pending registration (idempotent — same email re-uses same row).
  let pending;
  try {
    const [row] = await db
      .insert(ppPendingRegistrationsTable)
      .values({
        companyName,
        email,
        passwordHash: pwHash,
        logoObjectPath: logoObjectPath ?? null,
        workType: workType ?? null,
        tradeTypes: tradeTypes ?? null,
        ahjCoverageId: ahjCoverageId ?? null,
        ahjRequestJurisdiction: ahjRequestJurisdiction ?? null,
      })
      .onConflictDoUpdate({
        target: ppPendingRegistrationsTable.email,
        set: {
          companyName,
          passwordHash: pwHash,
          logoObjectPath: logoObjectPath ?? null,
          workType: workType ?? null,
          tradeTypes: tradeTypes ?? null,
          ahjCoverageId: ahjCoverageId ?? null,
          ahjRequestJurisdiction: ahjRequestJurisdiction ?? null,
          stripeSessionId: null, // cleared so a new checkout session is linked
          // Renew expiry so re-attempting registration after 24 h doesn't
          // create a charged-but-unprovisioned account on confirm.
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      .returning();
    pending = row;
  } catch (err) {
    logger.error({ err }, 'pp checkout: failed to upsert pending registration');
    res.status(500).json({ error: 'Registration could not be started. Please try again.' });
    return;
  }

  const base = trustedOrigin();
  const successUrl = `${base}/rooftrax-web/pp/register/confirm?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/rooftrax-web/pp/register?cancelled=1`;

  try {
    // Price in cents — configurable via PP_PACKAGE_PRICE_CENTS env var
    // (default $299 per package). A Stripe lookup key 'pp_package_standard'
    // takes precedence if it exists; otherwise price_data is used.
    const ppPriceCents = parseInt(process.env.PP_PACKAGE_PRICE_CENTS ?? '29900', 10);

    const stripe = await getUncachableStripeClient();

    // Try to resolve a named Stripe price first; fall back to price_data so
    // the checkout works without a pre-seeded price in dev/staging.
    type LineItem = { price: string; quantity: number } | { price_data: { currency: string; product_data: { name: string }; unit_amount: number }; quantity: number };
    let lineItem: LineItem;
    try {
      const prices = await stripe.prices.list({ lookup_keys: ['pp_package_standard'], active: true, limit: 1 });
      const namedPrice = prices.data[0];
      if (namedPrice) {
        lineItem = { price: namedPrice.id, quantity: 1 };
      } else {
        throw new Error('no named price');
      }
    } catch {
      lineItem = {
        price_data: {
          currency: 'usd',
          product_data: { name: 'RoofTrax Proof Package — Per-Package Plan' },
          unit_amount: ppPriceCents,
        },
        quantity: 1,
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [lineItem],
      metadata: { kind: 'pp_registration', pendingId: pending.id, email },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) throw new Error('Stripe returned no URL');

    // Link the Stripe session to the pending row.
    await db
      .update(ppPendingRegistrationsTable)
      .set({ stripeSessionId: session.id })
      .where(eq(ppPendingRegistrationsTable.id, pending.id));

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    // If Stripe is not configured, allow dev bypass.
    if (process.env.PP_DEV_SKIP_PAYMENT === '1') {
      res.json({ checkoutUrl: `${base}/rooftrax-web/pp/register/confirm?dev_pending_id=${pending.id}` });
      return;
    }
    logger.error({ err }, 'pp checkout: Stripe session creation failed');
    res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
});

// ── PP register confirm ──────────────────────────────────────────────────────

/**
 * GET /pp/register/confirm
 * Called by the success redirect from Stripe (query param: session_id) or dev
 * bypass (dev_pending_id). Verifies payment, provisions the account, and
 * returns the provisioned user + sets a session cookie.
 */
router.get('/pp/register/confirm', async (req: Request, res: Response) => {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : null;
  const devPendingId = typeof req.query.dev_pending_id === 'string' ? req.query.dev_pending_id : null;

  let pending;

  if (devPendingId && process.env.PP_DEV_SKIP_PAYMENT === '1') {
    const [row] = await db
      .select()
      .from(ppPendingRegistrationsTable)
      .where(eq(ppPendingRegistrationsTable.id, devPendingId));
    pending = row ?? null;
  } else if (sessionId) {
    // Verify payment with Stripe.
    try {
      const stripe = await getUncachableStripeClient();
      const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
      if (stripeSession.payment_status !== 'paid') {
        res.status(402).json({ error: 'Payment not completed.' });
        return;
      }
      const pendingId = stripeSession.metadata?.pendingId;
      if (!pendingId) {
        res.status(400).json({ error: 'Invalid checkout session.' });
        return;
      }
      const [row] = await db
        .select()
        .from(ppPendingRegistrationsTable)
        .where(eq(ppPendingRegistrationsTable.id, pendingId));
      pending = row ?? null;
    } catch (err) {
      logger.error({ err }, 'pp register confirm: Stripe verification failed');
      res.status(502).json({ error: 'Could not verify payment. Please contact support.' });
      return;
    }
  } else {
    res.status(400).json({ error: 'Missing session_id.' });
    return;
  }

  if (!pending) {
    res.status(404).json({ error: 'Registration session not found or expired.' });
    return;
  }

  // Enforce pending registration expiry (stale Stripe sessions are not honoured).
  if (pending.expiresAt && pending.expiresAt < new Date()) {
    await db.delete(ppPendingRegistrationsTable).where(eq(ppPendingRegistrationsTable.id, pending.id));
    res.status(410).json({ error: 'Registration session expired. Please start over.' });
    return;
  }

  // Bind the confirmed Stripe session to the specific pending row that created
  // it, preventing session-ID substitution or replay of an older Stripe session.
  if (req.query.session_id && typeof req.query.session_id === 'string' && pending.stripeSessionId) {
    const confirmedSessionId = req.query.session_id;
    if (confirmedSessionId !== pending.stripeSessionId) {
      logger.warn({ confirmedSessionId, storedSessionId: pending.stripeSessionId }, 'pp confirm: session_id mismatch');
      res.status(400).json({ error: 'Payment session mismatch. Please contact support.' });
      return;
    }
  }

  // Check if this email was already provisioned (idempotent confirm).
  const [existingUser] = await db
    .select({ id: usersTable.id, companyId: usersTable.companyId, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, profileImageUrl: usersTable.profileImageUrl })
    .from(usersTable)
    .where(eq(usersTable.email, pending.email));

  let user = existingUser;
  let company;

  if (!user) {
    // Provision account.
    try {
      const result = await provisionPPAccount({
        companyName: pending.companyName,
        email: pending.email,
        passwordHash: pending.passwordHash,
        // logoObjectPath intentionally not passed — unauthenticated paths cannot
        // be ownership-verified; subscribers upload logo post-auth.
        workType: pending.workType ?? null,
        tradeTypes: (pending.tradeTypes as string[] | null) ?? null,
        ahjCoverageId: pending.ahjCoverageId ?? null,
      });
      user = result.user;
      company = result.company;
    } catch (err) {
      logger.error({ err }, 'pp register confirm: account provisioning failed');
      res.status(500).json({ error: 'Account creation failed. Please contact support.' });
      return;
    }

    // If the subscriber requested a new AHJ, record it for admin review.
    if (pending.ahjRequestJurisdiction) {
      await db.insert(ahjRequestsTable).values({
        companyId: company.id,
        pendingRegistrationId: pending.id,
        jurisdictionText: pending.ahjRequestJurisdiction,
      });
    }

    // Queue verification email — token expires in 24 hours.
    const verifyToken = randomBytes(24).toString('hex');
    const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.update(usersTable).set({ verifyToken, verifyTokenExpiresAt }).where(eq(usersTable.id, user.id));
    const verifyLink = `${trustedOrigin()}/api/pp/verify?token=${verifyToken}`;
    const tmpl = ppEmails.verify(verifyLink);
    void sendPPEmail(pending.email, tmpl.subject, tmpl.text).catch(() => {});

    // Delete the pending row (account is now live).
    await db.delete(ppPendingRegistrationsTable).where(eq(ppPendingRegistrationsTable.id, pending.id));
  }

  // If company wasn't fetched above, load it now.
  if (!company) {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, user.companyId));
    company = co;
  }

  const regToken = await createPPSession(
    {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      companyId: user.companyId,
    },
    res,
  );

  res.json({ ok: true, companyId: user.companyId, token: regToken });
});

// ── PP login ─────────────────────────────────────────────────────────────────

const LoginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

/**
 * POST /pp/login
 * Email + password → session cookie. Works only for PP accounts (users with
 * a passwordHash). Returns 401 for missing or wrong credentials.
 */
router.post('/pp/login', async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const { email: rawEmail, password } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  // Join with companies to get ppTier in one query so the login response can
  // tell the client which product area to route the subscriber into.
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      companyId: usersTable.companyId,
      passwordHash: usersTable.passwordHash,
      deactivatedAt: usersTable.deactivatedAt,
      ppTier: companiesTable.ppTier,
    })
    .from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(eq(usersTable.email, email));

  // Verify password — always call verifyPassword even when user not found to
  // prevent timing-based email enumeration.
  const fakeHash = 'ff:ff'; // deterministically invalid; verifyPassword returns false
  const storedHash = user?.passwordHash ?? fakeHash;
  const match = await verifyPassword(password, storedHash);

  if (!user || !match) {
    res.status(401).json({ error: 'Incorrect email or password.' });
    return;
  }
  if (!user.passwordHash) {
    // OIDC-only account — no password set.
    res.status(401).json({ error: 'This account uses single sign-on. Please log in via the main portal.' });
    return;
  }
  if (user.deactivatedAt !== null) {
    res.status(403).json({ error: 'This account has been deactivated.' });
    return;
  }

  const token = await createPPSession(
    {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      companyId: user.companyId,
    },
    res,
  );

  // Return the session ID as `token` so mobile clients can store it and send
  // it as `Authorization: Bearer <token>` (matching how OIDC mobile sessions
  // work). Cookie-based clients (web) use the Set-Cookie header instead.
  // ppTier lets the web client decide which product area to route into.
  const ppTier = user.ppTier ?? 'pp_only';
  res.json({ ok: true, companyId: user.companyId, token, ppTier });
});

// ── PP logout ────────────────────────────────────────────────────────────────

/** POST /pp/logout — destroy the current session cookie. */
router.post('/pp/logout', async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

// ── PP me ────────────────────────────────────────────────────────────────────

/** GET /pp/me — return current PP session's user + company. */
router.get('/pp/me', async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (!sid) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const session = await getSession(sid);
  if (!session?.user?.id || session.session_type !== 'pp') {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.user.id));
  if (!user || user.deactivatedAt !== null) {
    await clearSession(res, sid);
    res.status(401).json({ error: 'Session invalid.' });
    return;
  }

  const [company] = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
      ppTier: companiesTable.ppTier,
      logoUrl: companiesTable.logoUrl,
      workType: companiesTable.workType,
      tradeTypes: companiesTable.tradeTypes,
      ahjCoverageId: companiesTable.ahjCoverageId,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId));

  // Generate a fresh signed read URL — only when objectOwnershipTable confirms
  // the path belongs to this company (cross-tenant guard via getPPLogoSignedUrl).
  const logoSignedUrl = company?.logoUrl
    ? await getPPLogoSignedUrl(
        company.id,
        company.logoUrl,
        db,
        (path, ttl) => objectStorage.tryGetSignedObjectUrl(path, ttl),
      )
    : null;

  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId: user.companyId,
      emailVerified: user.emailVerifiedAt !== null,
    },
    company: company ? { ...company, logoSignedUrl } : company,
  });
});

// ── Email verification ───────────────────────────────────────────────────────

/**
 * GET /pp/verify?token=...
 * Marks the user's email verified and redirects to the PP portal dashboard.
 */
router.get('/pp/verify', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(400).send('Missing verification token.');
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.verifyToken, token), gt(usersTable.verifyTokenExpiresAt, new Date())));
  if (!user) {
    res.status(410).send('This verification link has expired or is no longer valid. Please request a new one.');
    return;
  }

  await db
    .update(usersTable)
    .set({ emailVerifiedAt: user.emailVerifiedAt ?? new Date(), verifyToken: null })
    .where(eq(usersTable.id, user.id));

  const base = trustedOrigin();
  res.redirect(`${base}/rooftrax-web/pp/portal?verified=1`);
});

// ── Password reset ───────────────────────────────────────────────────────────

const PasswordResetBody = z.object({
  email: z.string().email().max(255),
});

/**
 * POST /pp/password-reset
 * Sends a password reset email. Always responds 200 to prevent email
 * enumeration — the link is emailed only if the account exists.
 */
router.post('/pp/password-reset', async (req: Request, res: Response) => {
  const parsed = PasswordResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email)));

  if (user?.passwordHash) {
    const resetToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db
      .update(usersTable)
      .set({ resetToken, resetTokenExpiresAt: expiresAt })
      .where(eq(usersTable.id, user.id));

    const base = trustedOrigin();
    const link = `${base}/rooftrax-web/pp/reset-password?token=${resetToken}`;
    const tmpl = ppEmails.passwordReset(link);
    void sendPPEmail(email, tmpl.subject, tmpl.text).catch(() => {});
  }

  res.json({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' });
});

const PasswordResetConfirmBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

/**
 * POST /pp/password-reset/confirm
 * Applies a new password from a valid reset token.
 */
router.post('/pp/password-reset/confirm', async (req: Request, res: Response) => {
  const parsed = PasswordResetConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Token and new password are required.' });
    return;
  }
  const { token, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.resetToken, token), gt(usersTable.resetTokenExpiresAt, new Date())));

  if (!user) {
    res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    return;
  }

  const newHash = await hashPassword(password);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, resetToken: null, resetTokenExpiresAt: null })
    .where(eq(usersTable.id, user.id));

  res.json({ ok: true });
});

// ── PP session helper ────────────────────────────────────────────────────────

async function requirePPSession(req: Request, res: Response) {
  const sid = getSessionId(req);
  if (!sid) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  const session = await getSession(sid);
  if (!session?.user?.id || session.session_type !== 'pp') {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.user.id));
  if (!user || user.deactivatedAt !== null) {
    await clearSession(res, sid);
    res.status(401).json({ error: 'Session invalid.' });
    return null;
  }
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId));
  if (!company) {
    res.status(401).json({ error: 'Company not found.' });
    return null;
  }
  return { user, company };
}

// ── PP inspections list ──────────────────────────────────────────────────────

/**
 * GET /pp/inspections
 * Lists all inspections for the authenticated PP company.
 * Returns readiness (inspection locked + AI summary generated), photo count,
 * inspector name, and compiled package count per inspection.
 */
router.get('/pp/inspections', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company } = ppCtx;

  // Inspector alias table for the join
  const inspectorAlias = {
    id: usersTable.id,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
  };

  const wantReadiness = req.query.readiness === 'true';

  // Fetch inspections with inspector name (left join — inspector may be deleted)
  const inspections = await db
    .select({
      id: inspectionsTable.id,
      address: inspectionsTable.address,
      insuredName: inspectionsTable.insuredName,
      status: inspectionsTable.status,
      createdAt: inspectionsTable.createdAt,
      lockedAt: inspectionsTable.lockedAt,
      updatedAt: inspectionsTable.updatedAt,
      aiSummary: inspectionsTable.aiSummary,
      compiledReportVersions: inspectionsTable.compiledReportVersions,
      carrierName: inspectionsTable.carrierName,
      claimNumber: inspectionsTable.claimNumber,
      dateOfLoss: inspectionsTable.dateOfLoss,
      // readiness computation fields
      roofDamageFound: inspectionsTable.roofDamageFound,
      sidingDamageFound: inspectionsTable.sidingDamageFound,
      interiorDamageFound: inspectionsTable.interiorDamageFound,
      estimate: inspectionsTable.estimate,
      rapGateReason: inspectionsTable.rapGateReason,
      temporaryRepairs: inspectionsTable.temporaryRepairs,
      propertyProfile: inspectionsTable.propertyProfile,
      repairabilityAssessment: inspectionsTable.repairabilityAssessment,
      inspectorUserId: inspectionsTable.inspectorUserId,
      inspectorFirstName: usersTable.firstName,
      inspectorLastName: usersTable.lastName,
      inspectorEmail: usersTable.email,
    })
    .from(inspectionsTable)
    .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
    .where(eq(inspectionsTable.companyId, company.id))
    .orderBy(desc(inspectionsTable.createdAt));

  // Photo counts via a grouped subquery
  const photoCounts = await db
    .select({
      inspectionId: inspectionPhotosTable.inspectionId,
      count: sql<number>`count(*)::int`,
    })
    .from(inspectionPhotosTable)
    .where(eq(inspectionPhotosTable.companyId, company.id))
    .groupBy(inspectionPhotosTable.inspectionId);

  const photoCountMap = new Map(photoCounts.map((p) => [p.inspectionId, p.count]));

  // Supplement counts (one batch query)
  const supplementCounts = await db
    .select({
      inspectionId: claimSupplementsTable.inspectionId,
      count: sql<number>`count(*)::int`,
    })
    .from(claimSupplementsTable)
    .where(
      inspections.length > 0
        ? inArray(claimSupplementsTable.inspectionId, inspections.map((i) => i.id))
        : sql`false`,
    )
    .groupBy(claimSupplementsTable.inspectionId);

  const supplementCountMap = new Map(supplementCounts.map((s) => [s.inspectionId, s.count]));

  // ── Batch readiness (only when ?readiness=true) ───────────────────────────
  type ReadinessSummary = {
    overallPass: boolean;
    can_generate: boolean;
    variant: 'upload_path' | 'field_inspection';
    deficiencyCount: number;
  };
  const readinessMap = new Map<string, ReadinessSummary>();

  if (wantReadiness && inspections.length > 0) {
    const ids = inspections.map((i) => i.id);
    // Batch per-inspection data — one IN query each
    const [
      allProducts,
      allAttestations,
      allTestSquares,
      allDamageInstances,
      allSlopes,
      [companyRow],
      ahjPacks,
      legacyPacks,
      allClaimSections,
      standardsEntries,
    ] = await Promise.all([
      db
        .select({
          inspectionId: inspectionProductsTable.inspectionId,
          identificationMethod: inspectionProductsTable.identificationMethod,
          discontinued: inspectionProductsTable.discontinued,
          ordinaryAvailability: inspectionProductsTable.ordinaryAvailability,
        })
        .from(inspectionProductsTable)
        .where(inArray(inspectionProductsTable.inspectionId, ids)),
      db
        .select({ inspectionId: attestationsTable.inspectionId, attestationType: attestationsTable.attestationType })
        .from(attestationsTable)
        .where(inArray(attestationsTable.inspectionId, ids)),
      db
        .select({ inspectionId: testSquaresTable.inspectionId })
        .from(testSquaresTable)
        .where(inArray(testSquaresTable.inspectionId, ids)),
      db
        .select({ inspectionId: damageInstancesTable.inspectionId })
        .from(damageInstancesTable)
        .where(
          and(
            inArray(damageInstancesTable.inspectionId, ids),
            eq(damageInstancesTable.companyId, company.id),
          ),
        ),
      db
        .select({ inspectionId: inspectionSlopesTable.inspectionId, materialType: inspectionSlopesTable.materialType })
        .from(inspectionSlopesTable)
        .where(inArray(inspectionSlopesTable.inspectionId, ids)),
      db
        .select({ contractorLicenses: companiesTable.contractorLicenses, qualificationsText: companiesTable.qualificationsText })
        .from(companiesTable)
        .where(eq(companiesTable.id, company.id))
        .limit(1),
      db
        .select({ packType: ahjPacksTable.packType, jurisdiction: ahjPacksTable.jurisdiction, state: ahjPacksTable.state })
        .from(ahjPacksTable)
        .where(eq(ahjPacksTable.companyId, company.id)),
      db
        .select({ state: companyJurisdictionPacksTable.state })
        .from(companyJurisdictionPacksTable)
        .where(eq(companyJurisdictionPacksTable.companyId, company.id)),
      db
        .select({
          inspectionId: claimSectionsTable.inspectionId,
          sectionType: claimSectionsTable.sectionType,
          libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot,
        })
        .from(claimSectionsTable)
        .where(
          and(
            inArray(claimSectionsTable.inspectionId, ids),
            isNull(claimSectionsTable.supplementId),
          ),
        ),
      db
        .select({ entryKey: standardsEntriesTable.entryKey, verificationStatus: standardsEntriesTable.verificationStatus })
        .from(standardsEntriesTable)
        .where(eq(standardsEntriesTable.companyId, company.id)),
    ]);

    // Group per-inspection data by inspectionId
    const productsByInspection = new Map<string, typeof allProducts>();
    const attestationsByInspection = new Map<string, typeof allAttestations>();
    const testSquaresByInspection = new Map<string, typeof allTestSquares>();
    const damageCountByInspection = new Map<string, number>();
    const slopesByInspection = new Map<string, typeof allSlopes>();
    const sectionsByInspection = new Map<string, typeof allClaimSections>();

    for (const p of allProducts) {
      const arr = productsByInspection.get(p.inspectionId) ?? [];
      arr.push(p); productsByInspection.set(p.inspectionId, arr);
    }
    for (const a of allAttestations) {
      const arr = attestationsByInspection.get(a.inspectionId) ?? [];
      arr.push(a); attestationsByInspection.set(a.inspectionId, arr);
    }
    for (const t of allTestSquares) {
      const arr = testSquaresByInspection.get(t.inspectionId) ?? [];
      arr.push(t); testSquaresByInspection.set(t.inspectionId, arr);
    }
    for (const d of allDamageInstances) {
      damageCountByInspection.set(d.inspectionId, (damageCountByInspection.get(d.inspectionId) ?? 0) + 1);
    }
    for (const s of allSlopes) {
      const arr = slopesByInspection.get(s.inspectionId) ?? [];
      arr.push(s); slopesByInspection.set(s.inspectionId, arr);
    }
    for (const cs of allClaimSections) {
      const arr = sectionsByInspection.get(cs.inspectionId) ?? [];
      arr.push(cs); sectionsByInspection.set(cs.inspectionId, arr);
    }

    for (const insp of inspections) {
      const products = productsByInspection.get(insp.id) ?? [];
      const testSquares = testSquaresByInspection.get(insp.id) ?? [];
      const attestations = attestationsByInspection.get(insp.id) ?? [];
      const slopes = slopesByInspection.get(insp.id) ?? [];
      const claimSections = sectionsByInspection.get(insp.id) ?? [];
      const damageInstancesCount = damageCountByInspection.get(insp.id) ?? 0;

      const ppEvaluationResult: EvaluationResult = {
        deficiencies: [
          ...(products.length === 0 ? [{
            stage: 'product' as const,
            code: 'NO_PRODUCT_RECORD',
            message: 'No roofing-product identification recorded.',
            resolution: 'capture_in_app' as const,
          }] : []),
          ...(testSquares.length === 0 && insp.roofDamageFound ? [{
            stage: 'test_squares' as const,
            code: 'MISSING_TEST_SQUARE_pp',
            message: 'No test squares found.',
            resolution: 'capture_in_app' as const,
          }] : []),
        ],
        softFlags: [],
      };

      const result = computeReadiness({
        inspectionId: insp.id,
        inspection: {
          ...insp,
          rapGateReason: (insp.rapGateReason as string | null | undefined) ?? null,
          estimate: (insp.estimate as { lines?: Array<{ description?: string; categoryCode?: string }> } | null),
          temporaryRepairs: (insp.temporaryRepairs as { performed?: boolean; openings?: boolean } | null),
          propertyProfile: (insp.propertyProfile as { structureType?: string; garageAttached?: boolean } | null),
          interiorDamageFound: insp.interiorDamageFound,
        },
        products: products.map((p) => ({
          identificationMethod: p.identificationMethod,
          discontinued: p.discontinued ?? null,
          ordinaryAvailability: p.ordinaryAvailability ?? null,
        })),
        slopes,
        attestations: attestations.map((a) => ({ attestationType: a.attestationType ?? null })),
        evaluationResult: ppEvaluationResult,
        damageInstancesCount,
        company: {
          contractorLicenses: companyRow?.contractorLicenses ?? null,
          qualificationsText: companyRow?.qualificationsText ?? null,
        },
        ahjPacks,
        legacyJurisdictionStates: legacyPacks.map((p) => p.state),
        claimSections: claimSections.map((s) => ({
          sectionType: s.sectionType,
          libraryVersionSnapshot:
            (s.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null) ?? null,
        })),
        standardsEntries: standardsEntries.map((e) => ({
          entryKey: e.entryKey,
          verificationStatus: e.verificationStatus,
        })),
      });

      const failedItems = result.items.filter((item) => item.state !== 'pass');
      readinessMap.set(insp.id, {
        overallPass: result.overallPass,
        can_generate: result.overallPass,
        variant: 'upload_path',
        deficiencyCount: failedItems.length,
      });
    }
  }

  const result = inspections.map((insp) => {
    const versions = Array.isArray(insp.compiledReportVersions) ? insp.compiledReportVersions : [];
    const inspectorName =
      [insp.inspectorFirstName, insp.inspectorLastName].filter(Boolean).join(' ') ||
      insp.inspectorEmail ||
      'Unknown';
    const base = {
      id: insp.id,
      address: insp.address,
      insuredName: insp.insuredName,
      carrierName: insp.carrierName,
      claimNumber: insp.claimNumber,
      dateOfLoss: insp.dateOfLoss,
      status: insp.status,
      inspectedAt: (insp.lockedAt ?? insp.createdAt).toISOString(),
      lastTouchedAt: (insp.updatedAt ?? insp.lockedAt ?? insp.createdAt).toISOString(),
      inspectorName,
      photoCount: photoCountMap.get(insp.id) ?? 0,
      supplementCount: supplementCountMap.get(insp.id) ?? 0,
      // Ready = inspection is locked (submitted) AND an AI summary has been generated
      ready: insp.lockedAt !== null && insp.aiSummary !== null,
      packageCount: versions.length,
      compiledVersionCount: versions.length,
    };
    if (wantReadiness) {
      const rs = readinessMap.get(insp.id);
      return {
        ...base,
        overallPass: rs?.overallPass ?? false,
        can_generate: rs?.can_generate ?? false,
        variant: rs?.variant ?? ('upload_path' as const),
        deficiencyCount: rs?.deficiencyCount ?? 0,
      };
    }
    return base;
  });

  res.json({ inspections: result });
});

// ── PP inspection create (upload path) ───────────────────────────────────────

/**
 * POST /pp/inspections
 * Creates a new inspection record for the upload path (pinId = null).
 * The upload path is for contractors who already have photos, a measurement
 * report, and a carrier estimate — no prior mobile inspection is required.
 */
const CreatePPInspectionBody = z.object({
  address:           z.string().trim().min(1).max(500),
  insuredName:       z.string().trim().max(200).optional(),
  carrierName:       z.string().trim().max(200).optional(),
  policyNumber:      z.string().trim().max(100).optional(),
  claimNumber:       z.string().trim().max(100).optional(),
  dateOfLoss:        z.string().trim().max(50).optional(),
  roofDamageFound:   z.boolean().optional(),
  sidingDamageFound: z.boolean().optional(),
  notes:             z.string().trim().max(2000).optional(),
});

router.post('/pp/inspections', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const parsed = CreatePPInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const [inspection] = await db
    .insert(inspectionsTable)
    .values({
      companyId:         ppCtx.company.id,
      inspectorUserId:   ppCtx.user.id,
      pinId:             null, // upload path — no linked CRM pin
      status:            'scheduled',
      address:           parsed.data.address,
      insuredName:       parsed.data.insuredName ?? null,
      carrierName:       parsed.data.carrierName ?? null,
      policyNumber:      parsed.data.policyNumber ?? null,
      claimNumber:       parsed.data.claimNumber ?? null,
      dateOfLoss:        parsed.data.dateOfLoss ?? null,
      roofDamageFound:   parsed.data.roofDamageFound ?? false,
      sidingDamageFound: parsed.data.sidingDamageFound ?? false,
      notes:             parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json({ inspectionId: inspection.id });
});

// ── PP price book (upload-path catalog) ──────────────────────────────────────

/**
 * GET /pp/price-book
 * Returns the authenticated PP company's price book items.
 * Used by the Stage 5 estimate builder — PP sessions do not have the CRM
 * catalog.price_book_view permission so we expose a separate PP-gated route.
 */
router.get('/pp/price-book', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const items = await db
    .select({
      id:          priceBookItemsTable.id,
      name:        priceBookItemsTable.name,
      description: priceBookItemsTable.description,
      unit:        priceBookItemsTable.unit,
      unitPrice:   priceBookItemsTable.unitPrice,
    })
    .from(priceBookItemsTable)
    .where(eq(priceBookItemsTable.companyId, ppCtx.company.id))
    .orderBy(asc(priceBookItemsTable.name));

  res.json({ items });
});

// ── PP estimate lines (per inspection) ───────────────────────────────────────

const PPEstimateLineSchema = z.object({
  id:               z.string().uuid(),
  name:             z.string().trim().min(1).max(300),
  description:      z.string().trim().max(2000).default(''),
  unit:             z.string().trim().min(1).max(50),
  unitPrice:        z.number().int().min(0),
  quantity:         z.number().min(0),
  priceBookItemId:  z.string().uuid().optional(),
});

const PutEstimateBody = z.object({
  lines: z.array(PPEstimateLineSchema).max(100),
});

/**
 * GET /pp/inspections/:inspectionId/estimate
 * Returns the current estimate lines (from propertyProfile.ppEstimateLines).
 */
router.get('/pp/inspections/:inspectionId/estimate', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const inspectionId = req.params.inspectionId as string;

  const [row] = await db
    .select({ propertyProfile: inspectionsTable.propertyProfile })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, inspectionId),
        eq(inspectionsTable.companyId, ppCtx.company.id),
      ),
    );

  if (!row) {
    res.status(404).json({ error: 'Inspection not found.' });
    return;
  }

  const lines = (row.propertyProfile as Record<string, unknown> | null)?.ppEstimateLines ?? [];
  res.json({ lines });
});

/**
 * PUT /pp/inspections/:inspectionId/estimate
 * Saves estimate lines into propertyProfile.ppEstimateLines.
 */
router.put('/pp/inspections/:inspectionId/estimate', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const inspectionId = req.params.inspectionId as string;

  const parsed = PutEstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid estimate payload', details: parsed.error.flatten() });
    return;
  }

  const [row] = await db
    .select({ propertyProfile: inspectionsTable.propertyProfile })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, inspectionId),
        eq(inspectionsTable.companyId, ppCtx.company.id),
      ),
    );

  if (!row) {
    res.status(404).json({ error: 'Inspection not found.' });
    return;
  }

  const existingProfile = (row.propertyProfile ?? {}) as Record<string, unknown>;
  // Spread first so explicit keys win; cast to `any` — the column is jsonb and
  // the shape is enforced at the application layer via PPEstimateLineSchema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatedProfile: any = {
    ...existingProfile,
    recordedAtUtc:
      typeof existingProfile.recordedAtUtc === 'string'
        ? existingProfile.recordedAtUtc
        : new Date().toISOString(),
    ppEstimateLines: parsed.data.lines,
  };

  await db
    .update(inspectionsTable)
    .set({ propertyProfile: updatedProfile, updatedAt: new Date() })
    .where(eq(inspectionsTable.id, inspectionId));

  res.json({ ok: true });
});

// ── PP packages list ─────────────────────────────────────────────────────────

/**
 * GET /pp/packages
 * Lists all compiled proof packages for the authenticated PP company.
 * Returns version metadata; each version links to the render endpoint
 * (GET /pp/inspections/:id/report/:versionIndex) which resolves the blob,
 * enforces the blocked-content policy, and returns rendered text/html.
 */
router.get('/pp/packages', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company } = ppCtx;

  const inspections = await db
    .select({
      id: inspectionsTable.id,
      address: inspectionsTable.address,
      insuredName: inspectionsTable.insuredName,
      compiledReportVersions: inspectionsTable.compiledReportVersions,
    })
    .from(inspectionsTable)
    .where(eq(inspectionsTable.companyId, company.id))
    .orderBy(desc(inspectionsTable.createdAt));

  type VersionEntry = { path: string; generatedAt: string; evidenceManifestSha256?: string | null };

  const pkgEntries = inspections
    .filter((insp) => {
      const versions = Array.isArray(insp.compiledReportVersions)
        ? insp.compiledReportVersions
        : [];
      return versions.length > 0;
    })
    .map((insp) => {
      const rawVersions = (
        Array.isArray(insp.compiledReportVersions) ? insp.compiledReportVersions : []
      ) as VersionEntry[];

      // Only include versions that have a stored blob path (no path = compile failed).
      // The render endpoint enforces the blocked-content policy on open.
      const versions = rawVersions
        .map((ver, idx) => ({ index: idx, generatedAt: ver.generatedAt, hasBlob: !!ver.path }))
        .filter((v) => v.hasBlob);

      if (versions.length === 0) return null;
      const latestVer = rawVersions[rawVersions.length - 1];
      return {
        inspectionId: insp.id,
        address: insp.address,
        insuredName: insp.insuredName,
        latestCompiledAt: latestVer.generatedAt,
        versionCount: versions.length,
        versions,
        status: 'compiled' as const,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  res.json({ packages: pkgEntries });
});

// ── PP report render ─────────────────────────────────────────────────────────

/**
 * GET /pp/inspections/:inspectionId/report/:versionIndex
 * Renders a compiled Proof Package version as text/html for a PP subscriber.
 * Applies the same blocked-content policy as the public Evidence Portal
 * (allowBlocked: false — blocked versions return 409).
 */
router.get('/pp/inspections/:inspectionId/report/:versionIndex', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const inspectionId = req.params.inspectionId as string;
  const versionIndex = parseInt(req.params.versionIndex as string, 10);

  if (!inspectionId || isNaN(versionIndex) || versionIndex < 0) {
    res.status(400).json({ error: 'Invalid inspection ID or version index.' });
    return;
  }

  // Load inspection — scoped to the PP company (tenant isolation)
  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, ppCtx.company.id)));

  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found.' });
    return;
  }

  type VersionEntry = { path: string; generatedAt: string };
  const versions = (
    Array.isArray(inspection.compiledReportVersions) ? inspection.compiledReportVersions : []
  ) as VersionEntry[];

  const version = versions[versionIndex];
  if (!version?.path) {
    res.status(404).json({ error: 'Report version not found.' });
    return;
  }

  // Render via the shared renderer — allowBlocked:false matches public portal policy
  const rendered = await renderCompiledReportHtml({
    inspection,
    reportPath: version.path,
    companyId: ppCtx.company.id,
    allowBlocked: false,
  });

  if (!rendered.ok) {
    // 409 = blocked content, same as Evidence Portal behaviour
    res.status(409).json({ error: rendered.error });
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(rendered.html);
});

// ── PP company settings ──────────────────────────────────────────────────────

const PatchCompanyBody = z.object({
  companyName: z.string().min(1).max(255).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  billingEmail: z.string().email().max(255).optional(),
  workType: z.enum(['retail', 'insurance', 'retail_insurance']).optional().nullable(),
  tradeTypes: z.array(z.string().max(50)).max(10).optional().nullable(),
});

/**
 * PATCH /pp/company
 * Update company name and/or founder user contact details.
 */
router.patch('/pp/company', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const parsed = PatchCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid fields', detail: parsed.error.flatten().fieldErrors });
    return;
  }

  const { companyName, firstName, lastName, billingEmail, workType, tradeTypes } = parsed.data;

  // Update company fields
  const companyUpdates: {
    name?: string;
    workType?: string | null;
    tradeTypes?: string[] | null;
  } = {};
  if (companyName !== undefined) companyUpdates.name = companyName;
  if (workType !== undefined) companyUpdates.workType = workType;
  if (tradeTypes !== undefined) companyUpdates.tradeTypes = tradeTypes;

  if (Object.keys(companyUpdates).length > 0) {
    await db
      .update(companiesTable)
      .set(companyUpdates)
      .where(eq(companiesTable.id, ppCtx.company.id));
  }

  // Update user contact fields if provided
  const userUpdates: {
    firstName?: string;
    lastName?: string;
    email?: string;
  } = {};
  if (firstName !== undefined) userUpdates.firstName = firstName;
  if (lastName !== undefined) userUpdates.lastName = lastName;
  if (billingEmail !== undefined) {
    const normalizedEmail = billingEmail.toLowerCase().trim();
    // Check uniqueness — prevent stealing another user's email
    if (normalizedEmail !== (ppCtx.user.email ?? '').toLowerCase().trim()) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, normalizedEmail));
      if (existing) {
        res.status(409).json({ error: 'That email address is already in use.' });
        return;
      }
    }
    userUpdates.email = normalizedEmail;
  }

  if (Object.keys(userUpdates).length > 0) {
    await db
      .update(usersTable)
      .set(userUpdates)
      .where(eq(usersTable.id, ppCtx.user.id));
  }

  res.json({ ok: true });
});

// ── PP per-package payment checkout ─────────────────────────────────────────

const PackageCheckoutBody = z.object({
  inspectionId: z.string().min(1).max(100),
});

/**
 * POST /pp/packages/checkout
 * Idempotent: reuses the pending Stripe Checkout Session for this
 * (companyId, inspectionId) if one is still open.  Only creates a new session
 * when none exists or the previous one has expired.  This prevents duplicate
 * charges when a user retries checkout or navigates back before completing.
 */
router.post('/pp/packages/checkout', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company, user } = ppCtx;

  const parsed = PackageCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'inspectionId is required.' });
    return;
  }
  const { inspectionId } = parsed.data;

  // Verify the inspection belongs to this company (tenant isolation).
  const [inspection] = await db
    .select({ id: inspectionsTable.id })
    .from(inspectionsTable)
    .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, company.id)));

  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found.' });
    return;
  }

  // Fast-path: if a credit already exists, no payment needed.
  const [credit] = await db
    .select({ id: ppPackageCreditsTable.id })
    .from(ppPackageCreditsTable)
    .where(
      and(
        eq(ppPackageCreditsTable.companyId, company.id),
        eq(ppPackageCreditsTable.inspectionId, inspectionId),
      ),
    );
  if (credit) {
    res.json({ alreadyPaid: true });
    return;
  }

  // Dev bypass: mint a credit directly without hitting Stripe.
  if (process.env.PP_DEV_SKIP_PAYMENT === '1') {
    await db
      .insert(ppPackageCreditsTable)
      .values({
        companyId: company.id,
        inspectionId,
        stripePaymentIntentId: `dev_${Date.now()}`,
      })
      .onConflictDoNothing();
    res.json({ checkoutUrl: null, alreadyPaid: true });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const now = new Date();

    // ── Reuse an existing pending session if it is still open ───────────────
    const [pending] = await db
      .select({
        stripeSessionId: ppPendingCheckoutsTable.stripeSessionId,
        sessionUrl: ppPendingCheckoutsTable.sessionUrl,
        expiresAt: ppPendingCheckoutsTable.expiresAt,
      })
      .from(ppPendingCheckoutsTable)
      .where(
        and(
          eq(ppPendingCheckoutsTable.companyId, company.id),
          eq(ppPendingCheckoutsTable.inspectionId, inspectionId),
          // Only consider sessions that haven't expired locally.
          gt(ppPendingCheckoutsTable.expiresAt, now),
        ),
      );

    if (pending) {
      // Verify Stripe still considers the session open.
      try {
        const stripeSession = await stripe.checkout.sessions.retrieve(pending.stripeSessionId);
        if (stripeSession.status === 'open') {
          res.json({ checkoutUrl: stripeSession.url ?? pending.sessionUrl, alreadyPaid: false });
          return;
        }
      } catch {
        // Session retrieval failed — fall through to create a fresh one.
      }
      // Session expired/completed on Stripe — remove the stale pending row.
      await db
        .delete(ppPendingCheckoutsTable)
        .where(
          and(
            eq(ppPendingCheckoutsTable.companyId, company.id),
            eq(ppPendingCheckoutsTable.inspectionId, inspectionId),
          ),
        );
    }

    // ── Create a new Stripe Checkout Session ─────────────────────────────────
    const ppPriceCents = parseInt(process.env.PP_PACKAGE_PRICE_CENTS ?? '29900', 10);
    const base = trustedOrigin();
    const successUrl = `${base}/rooftrax-web/pp/wizard/${inspectionId}?checkout_session={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/rooftrax-web/pp/inspections?checkout=canceled`;

    type LineItem =
      | { price: string; quantity: number }
      | { price_data: { currency: string; product_data: { name: string }; unit_amount: number }; quantity: number };

    let lineItem: LineItem;
    try {
      const prices = await stripe.prices.list({ lookup_keys: ['pp_package_per_package'], active: true, limit: 1 });
      const namedPrice = prices.data[0];
      if (namedPrice) {
        lineItem = { price: namedPrice.id, quantity: 1 };
      } else {
        throw new Error('no named price');
      }
    } catch {
      lineItem = {
        price_data: {
          currency: 'usd',
          product_data: { name: 'RoofTrax Proof Package — Per-Package Fee' },
          unit_amount: ppPriceCents,
        },
        quantity: 1,
      };
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: user.email ?? undefined,
        line_items: [lineItem],
        metadata: { kind: 'pp_package', companyId: company.id, inspectionId },
        success_url: successUrl,
        cancel_url: cancelUrl,
        // Stripe Checkout sessions expire after 24 hours.
        expires_at: Math.floor(now.getTime() / 1000) + 23 * 3600,
      },
      // Idempotency key: one session per (company, inspection) per day.
      {
        idempotencyKey: `pp-checkout-${company.id}-${inspectionId}-${Math.floor(now.getTime() / 86400000)}`,
      },
    );

    if (!session.url) throw new Error('Stripe returned no URL');

    // Persist the pending session so retries can reuse it.
    const sessionExpiresAt = new Date((session.expires_at ?? Math.floor(now.getTime() / 1000) + 23 * 3600) * 1000);
    await db
      .insert(ppPendingCheckoutsTable)
      .values({
        companyId: company.id,
        inspectionId,
        stripeSessionId: session.id,
        sessionUrl: session.url,
        expiresAt: sessionExpiresAt,
      })
      .onConflictDoUpdate({
        target: [ppPendingCheckoutsTable.companyId, ppPendingCheckoutsTable.inspectionId],
        set: {
          stripeSessionId: session.id,
          sessionUrl: session.url,
          expiresAt: sessionExpiresAt,
        },
      });

    res.json({ checkoutUrl: session.url, alreadyPaid: false });
  } catch (err) {
    logger.error({ err }, 'pp packages/checkout: Stripe session creation failed');
    res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
});

// ── PP checkout confirm (success redirect) ───────────────────────────────────

const PackageCheckoutConfirmBody = z.object({
  sessionId: z.string().min(1),
  inspectionId: z.string().min(1),
});

/**
 * POST /pp/packages/checkout/confirm
 * Called after Stripe redirects back with a checkout_session param.
 * Verifies the session with Stripe and upserts a pp_package_credits row.
 */
router.post('/pp/packages/checkout/confirm', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company } = ppCtx;

  const parsed = PackageCheckoutConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'sessionId and inspectionId are required.' });
    return;
  }
  const { sessionId, inspectionId } = parsed.data;

  try {
    const stripe = await getUncachableStripeClient();
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

    if (stripeSession.payment_status !== 'paid') {
      res.status(402).json({ error: 'Payment not completed.' });
      return;
    }

    // Bind the session to this specific company + inspection to prevent replay.
    if (
      stripeSession.metadata?.kind !== 'pp_package' ||
      stripeSession.metadata?.companyId !== company.id ||
      stripeSession.metadata?.inspectionId !== inspectionId
    ) {
      res.status(400).json({ error: 'Checkout session does not match this request.' });
      return;
    }

    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : stripeSession.payment_intent?.id ?? stripeSession.id;

    await db
      .insert(ppPackageCreditsTable)
      .values({
        companyId: company.id,
        inspectionId,
        stripePaymentIntentId: paymentIntentId,
      })
      .onConflictDoNothing();

    // Clean up the pending checkout now that payment is confirmed.
    await db
      .delete(ppPendingCheckoutsTable)
      .where(
        and(
          eq(ppPendingCheckoutsTable.companyId, company.id),
          eq(ppPendingCheckoutsTable.inspectionId, inspectionId),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'pp packages/checkout/confirm: verification failed');
    res.status(502).json({ error: 'Could not verify payment. Please contact support.' });
  }
});

// NOTE: POST /pp/webhook/stripe is registered in app.ts before express.json()
// so Stripe signature verification receives the raw Buffer body.

// ── PP credit status ─────────────────────────────────────────────────────────

/**
 * GET /pp/packages/credit-status/:inspectionId
 * Returns { paid: boolean, paidAt: string | null } for the given inspection.
 * Used by the wizard to check whether a payment step should be shown.
 */
router.get('/pp/packages/credit-status/:inspectionId', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const inspectionId = req.params.inspectionId as string;

  const [credit] = await db
    .select({ id: ppPackageCreditsTable.id, paidAt: ppPackageCreditsTable.paidAt })
    .from(ppPackageCreditsTable)
    .where(
      and(
        eq(ppPackageCreditsTable.companyId, ppCtx.company.id),
        eq(ppPackageCreditsTable.inspectionId, inspectionId),
      ),
    );

  res.json({ paid: !!credit, paidAt: credit?.paidAt?.toISOString() ?? null });
});

// ── PP inspection readiness ───────────────────────────────────────────────────

/**
 * GET /pp/inspections/:inspectionId/readiness
 * PP-session-gated readiness endpoint for the wizard Step 3 checklist.
 * Runs the same Stage-0 readiness computation as the compile route.
 */
router.get('/pp/inspections/:inspectionId/readiness', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const inspectionId = req.params.inspectionId as string;
  const { company } = ppCtx;

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, company.id)));

  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found.' });
    return;
  }

  const [
    products,
    attestations,
    testSquares,
    damageInstances,
    slopes,
    [companyRow],
    ahjPacks,
    legacyPacks,
    claimSections,
    standardsEntries,
  ] = await Promise.all([
    db
      .select({
        identificationMethod: inspectionProductsTable.identificationMethod,
        discontinued: inspectionProductsTable.discontinued,
        ordinaryAvailability: inspectionProductsTable.ordinaryAvailability,
      })
      .from(inspectionProductsTable)
      .where(
        and(
          eq(inspectionProductsTable.inspectionId, inspectionId),
          eq(inspectionProductsTable.companyId, company.id),
        ),
      ),
    db
      .select({ attestationType: attestationsTable.attestationType })
      .from(attestationsTable)
      .where(
        and(
          eq(attestationsTable.inspectionId, inspectionId),
          eq(attestationsTable.companyId, company.id),
        ),
      ),
    db
      .select({ id: testSquaresTable.id })
      .from(testSquaresTable)
      .where(
        and(
          eq(testSquaresTable.inspectionId, inspectionId),
          eq(testSquaresTable.companyId, company.id),
        ),
      ),
    db
      .select({ id: damageInstancesTable.id })
      .from(damageInstancesTable)
      .where(
        and(
          eq(damageInstancesTable.inspectionId, inspectionId),
          eq(damageInstancesTable.companyId, company.id),
        ),
      )
      .limit(1),
    db
      .select({ materialType: inspectionSlopesTable.materialType })
      .from(inspectionSlopesTable)
      .where(
        and(
          eq(inspectionSlopesTable.inspectionId, inspectionId),
          eq(inspectionSlopesTable.companyId, company.id),
        ),
      ),
    db
      .select({
        contractorLicenses: companiesTable.contractorLicenses,
        qualificationsText: companiesTable.qualificationsText,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, company.id))
      .limit(1),
    db
      .select({ packType: ahjPacksTable.packType, jurisdiction: ahjPacksTable.jurisdiction, state: ahjPacksTable.state })
      .from(ahjPacksTable)
      .where(eq(ahjPacksTable.companyId, company.id)),
    db
      .select({ state: companyJurisdictionPacksTable.state })
      .from(companyJurisdictionPacksTable)
      .where(eq(companyJurisdictionPacksTable.companyId, company.id)),
    db
      .select({
        sectionType: claimSectionsTable.sectionType,
        libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot,
      })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          isNull(claimSectionsTable.supplementId),
        ),
      ),
    db
      .select({
        entryKey: standardsEntriesTable.entryKey,
        verificationStatus: standardsEntriesTable.verificationStatus,
      })
      .from(standardsEntriesTable)
      .where(eq(standardsEntriesTable.companyId, company.id)),
  ]);

  // Build a synthetic EvaluationResult from the data pp.ts already fetches.
  // This mirrors the two checks that computeReadiness() delegates to
  // evaluationResult (product existence and test-square existence) without
  // re-querying or pulling all the photos/elevations/components that the full
  // evaluateServerInspection() requires. PP inspections are upload-path, so
  // capture_in_app fields won't be populated — the gate-reason logic handles that.
  const ppEvaluationResult: EvaluationResult = {
    deficiencies: [
      ...(products.length === 0 ? [{
        stage: 'product' as const,
        code: 'NO_PRODUCT_RECORD',
        message: 'No roofing-product identification recorded.',
        resolution: 'capture_in_app' as const,
      }] : []),
      // Synthesise a missing-square marker when no squares exist AND roof damage
      // is flagged — matches the old testSquaresCount > 0 gate condition.
      ...(testSquares.length === 0 && inspection.roofDamageFound ? [{
        stage: 'test_squares' as const,
        code: 'MISSING_TEST_SQUARE_pp',
        message: 'No test squares found.',
        resolution: 'capture_in_app' as const,
      }] : []),
    ],
    softFlags: [],
  };

  const result = computeReadiness({
    inspectionId,
    inspection: {
      ...inspection,
      rapGateReason: (inspection.rapGateReason as string | null | undefined) ?? null,
      estimate: (inspection.estimate as { lines?: Array<{ description?: string; categoryCode?: string }> } | null),
      temporaryRepairs: (inspection.temporaryRepairs as { performed?: boolean; openings?: boolean } | null),
      propertyProfile: (inspection.propertyProfile as { structureType?: string; garageAttached?: boolean } | null),
      interiorDamageFound: inspection.interiorDamageFound,
    },
    products: products.map((p) => ({
      identificationMethod: p.identificationMethod,
      discontinued: p.discontinued ?? null,
      ordinaryAvailability: p.ordinaryAvailability ?? null,
    })),
    slopes,
    attestations: attestations.map((a) => ({ attestationType: a.attestationType ?? null })),
    evaluationResult: ppEvaluationResult,
    damageInstancesCount: damageInstances.length,
    company: {
      contractorLicenses: companyRow?.contractorLicenses ?? null,
      qualificationsText: companyRow?.qualificationsText ?? null,
    },
    ahjPacks,
    legacyJurisdictionStates: legacyPacks.map((p) => p.state),
    claimSections: claimSections.map((s) => ({
      sectionType: s.sectionType,
      libraryVersionSnapshot:
        (s.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null) ?? null,
    })),
    standardsEntries: standardsEntries.map((e) => ({
      entryKey: e.entryKey,
      verificationStatus: e.verificationStatus,
    })),
  });

  res.json(result);
});

// ── PP logo upload URL ───────────────────────────────────────────────────────

/**
 * GET /pp/upload-url
 * Returns a presigned PUT URL and the resulting objectPath for logo upload.
 * PP users cannot access the CRM storage.upload permission, so this provides
 * a PP-session-gated equivalent.
 */
router.get('/pp/upload-url', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);

    // Record ownership so the logo path is verifiable as belonging to this
    // company at update time and so object-storage ACL checks can run.
    await db
      .insert(objectOwnershipTable)
      .values({ objectPath, userId: ppCtx.user.id, companyId: ppCtx.company.id })
      .onConflictDoNothing();

    res.json({ uploadURL, objectPath });
  } catch (err) {
    logger.error({ err }, 'pp upload-url: failed to generate signed URL');
    res.status(503).json({ error: 'Could not generate upload URL. Please try again.' });
  }
});

// ── PP company logo ──────────────────────────────────────────────────────────

const LogoBody = z.object({ objectPath: z.string().min(1).max(500) });

/**
 * PUT /pp/company/logo
 * Update the company logo stored in object storage.
 */
router.put('/pp/company/logo', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const parsed = LogoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'objectPath is required.' });
    return;
  }

  const { objectPath } = parsed.data;

  // Tenant boundary: verify the objectPath was issued to this company via
  // GET /pp/upload-url (ownership row inserted at that time). This prevents
  // a subscriber from pointing their logo at another tenant's object.
  const [ownership] = await db
    .select({ companyId: objectOwnershipTable.companyId })
    .from(objectOwnershipTable)
    .where(eq(objectOwnershipTable.objectPath, objectPath));

  if (!ownership || ownership.companyId !== ppCtx.company.id) {
    res.status(403).json({ error: 'Object does not belong to your company.' });
    return;
  }

  await db
    .update(companiesTable)
    .set({ logoUrl: objectPath })
    .where(eq(companiesTable.id, ppCtx.company.id));

  res.json({ ok: true });
});

// ── PP upgrade — status check ────────────────────────────────────────────────

/**
 * GET /pp/upgrade/status
 * Returns { upgraded: boolean } reflecting the company's current pp_tier.
 * Used by the success page to confirm webhook fulfillment before declaring
 * the upgrade complete rather than relying on a fixed timeout.
 */
router.get('/pp/upgrade/status', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;
  res.json({ upgraded: ppCtx.company.ppTier === 'crm' });
});

// ── PP upgrade — reconciliation ───────────────────────────────────────────────

const ReconcileBody = z.object({
  sessionId: z.string().min(1),
});

/**
 * POST /pp/upgrade/reconcile
 * Called by the success page when polling times out — verifies the Stripe
 * session is paid and re-runs fulfillCRMUpgrade (which is idempotent).
 * This is the durable reconciliation path for transient webhook failures.
 */
router.post('/pp/upgrade/reconcile', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company } = ppCtx;

  // Already upgraded — nothing to do.
  if (company.ppTier === 'crm') {
    res.json({ ok: true, upgraded: true });
    return;
  }

  const parsed = ReconcileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'sessionId is required.' });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId);

    if (
      session.metadata?.kind !== 'pp_crm_upgrade' ||
      session.metadata?.companyId !== company.id
    ) {
      res.status(400).json({ error: 'Session does not match this account.' });
      return;
    }
    if (session.payment_status !== 'paid') {
      res.status(402).json({ error: 'Payment not completed.', upgraded: false });
      return;
    }

    const { fulfillCRMUpgrade } = await import('../lib/pp/upgrade');
    const customerId =
      typeof session.customer === 'string' ? session.customer : (session.customer as { id?: string } | null)?.id ?? null;
    const stripeSubId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as { id?: string } | null)?.id ?? null;
    await fulfillCRMUpgrade(company.id, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubId,
      planKey: session.metadata?.planKey ?? null,
    });

    res.json({ ok: true, upgraded: true });
  } catch (err) {
    logger.error({ err }, 'pp upgrade reconcile: fulfillment failed');
    res.status(500).json({ error: 'Reconciliation failed. Please contact support if this persists.' });
  }
});

// ── PP upgrade — credit inquiry ──────────────────────────────────────────────

/**
 * GET /pp/upgrade/credit
 * Returns the credit amount (cents) available toward a CRM upgrade.
 * Credit = PP registration fee if company is within the 90-day window.
 *
 * Response: { creditCents: number, eligibleDaysRemaining: number }
 */
router.get('/pp/upgrade/credit', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { company } = ppCtx;

  if (company.ppTier !== 'pp_only') {
    res.json({ creditCents: 0, eligibleDaysRemaining: 0 });
    return;
  }

  const ppPriceCents = parseInt(process.env.PP_PACKAGE_PRICE_CENTS ?? '29900', 10);
  const CREDIT_WINDOW_DAYS = 90;
  const elapsedDays = (Date.now() - new Date(company.createdAt).getTime()) / 86_400_000;
  const eligibleDaysRemaining = Math.max(0, Math.floor(CREDIT_WINDOW_DAYS - elapsedDays));

  res.json({
    creditCents: eligibleDaysRemaining > 0 ? ppPriceCents : 0,
    eligibleDaysRemaining,
  });
});

// ── PP upgrade — Stripe subscription checkout ────────────────────────────────

const UpgradeCheckoutBody = z.object({
  planKey: z.string(),
  billingTerm: z.string().default('annual'),
});

/**
 * POST /pp/upgrade/checkout
 * Creates a Stripe subscription checkout session for a PP-only company
 * upgrading to the full CRM tier. Returns the Stripe-hosted checkout URL.
 *
 * Webhook fulfillment: checkout.session.completed with kind='pp_crm_upgrade'
 * calls fulfillCRMUpgrade(companyId) → sets companies.pp_tier = 'crm'.
 */
router.post('/pp/upgrade/checkout', async (req: Request, res: Response) => {
  const ppCtx = await requirePPSession(req, res);
  if (!ppCtx) return;

  const { user, company } = ppCtx;

  if (company.ppTier !== 'pp_only') {
    res.status(409).json({ error: 'Your account is already on the full CRM plan.' });
    return;
  }

  const parsed = UpgradeCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  const { planKey, billingTerm: termKey } = parsed.data;

  const [planRows, termRows] = await Promise.all([
    db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder)),
    db.select().from(billingTerms).orderBy(asc(billingTerms.installments)),
  ]);

  const plan = planRows.find((p) => p.planKey === planKey);
  if (!plan) {
    res.status(422).json({ error: `Unknown plan: ${planKey}` });
    return;
  }
  const term = termRows.find((t) => t.termKey === termKey);
  if (!term) {
    res.status(422).json({ error: `Unknown billing term: ${termKey}` });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const planLookupKey = `plan_${plan.planKey}_${term.termKey}`;

    type LineItem =
      | { price: string; quantity: number }
      | { price_data: { currency: string; unit_amount: number; recurring: { interval: 'month' | 'year' }; product_data: { name: string } }; quantity: number };

    let lineItem: LineItem;
    try {
      const prices = await stripe.prices.list({ lookup_keys: [planLookupKey], active: true, limit: 1 });
      const namedPrice = prices.data[0];
      if (namedPrice) {
        lineItem = { price: namedPrice.id, quantity: 1 };
      } else {
        throw new Error('no named price');
      }
    } catch {
      // Dev fallback — use price_data so checkout works without pre-seeded prices.
      const multiplier = Number(term.multiplier);
      const annualSub = Math.round(plan.annualCents * multiplier);
      const interval: 'month' | 'year' = term.termKey === 'annual' ? 'year' : 'month';
      const unitAmount = interval === 'year' ? annualSub : Math.round(annualSub / (term.installments || 12));
      lineItem = {
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          recurring: { interval },
          product_data: { name: `RoofTrax CRM — ${plan.displayName} (${term.termKey})` },
        },
        quantity: 1,
      };
    }

    // Compute any PP-spend credit to apply to the first invoice.
    const ppPriceCents = parseInt(process.env.PP_PACKAGE_PRICE_CENTS ?? '29900', 10);
    const CREDIT_WINDOW_DAYS = 90;
    const elapsedDays = (Date.now() - new Date(company.createdAt).getTime()) / 86_400_000;
    const eligibleDaysRemaining = Math.max(0, Math.floor(CREDIT_WINDOW_DAYS - elapsedDays));
    const creditCents = eligibleDaysRemaining > 0 ? ppPriceCents : 0;

    // Apply the credit as a one-time Stripe coupon so the first invoice is
    // actually reduced by the displayed amount (not just shown as a label).
    // If credit is eligible but coupon creation fails, we fail the request
    // rather than charging the full price while the UI promised a discount.
    const discounts: Array<{ coupon: string }> = [];
    if (creditCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: creditCents,
        currency: 'usd',
        duration: 'once',
        name: 'PP package spend credit',
      });
      discounts.push({ coupon: coupon.id });
    }

    const base = trustedOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email ?? undefined,
      line_items: [lineItem],
      ...(discounts.length > 0 ? { discounts } : {}),
      metadata: {
        kind: 'pp_crm_upgrade',
        companyId: company.id,
        planKey: plan.planKey,
        billingTerm: term.termKey,
      },
      // Propagate companyId and planKey to the Stripe subscription object so
      // customer.subscription.deleted / updated events can revoke entitlement
      // without needing to look up the checkout session.
      subscription_data: {
        metadata: {
          kind: 'pp_crm_upgrade',
          companyId: company.id,
          planKey: plan.planKey,
        },
      },
      success_url: `${base}/rooftrax-web/pp/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/rooftrax-web/pp/upgrade`,
    });

    if (!session.url) throw new Error('Stripe returned no URL');

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    // Dev bypass — immediately fulfill without Stripe.
    if (process.env.PP_DEV_SKIP_PAYMENT === '1') {
      const { fulfillCRMUpgrade } = await import('../lib/pp/upgrade');
      await fulfillCRMUpgrade(company.id);
      const base = trustedOrigin();
      res.json({ checkoutUrl: `${base}/rooftrax-web/pp/upgrade/success?dev=1` });
      return;
    }
    logger.error({ err }, 'pp upgrade checkout: Stripe session creation failed');
    res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
});

export default router;
