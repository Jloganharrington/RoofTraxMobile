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
import { and, eq, gt, lt } from 'drizzle-orm';
import {
  companiesTable,
  db,
  ppPendingRegistrationsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { clearSession, getSession, getSessionId } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/pp/crypto';
import { ppEmails, sendPPEmail } from '../lib/pp/mailer';
import { createPPSession } from '../lib/pp/session';
import { getUncachableStripeClient } from '../lib/stripe/stripeClient';

const router: IRouter = Router();

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
  logoObjectPath?: string | null;
}) {
  const companyId = await generateUniqueCompanyId();

  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companiesTable)
      .values({
        id: companyId,
        name: opts.companyName,
        ppTier: 'pp_only',
        logoUrl: opts.logoObjectPath ?? null,
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
      .values({ userId: user.id, role: 'admin' })
      .onConflictDoNothing();

    return { company, user };
  });
}

// ── PP checkout ──────────────────────────────────────────────────────────────

const CheckoutBody = z.object({
  companyName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  logoObjectPath: z.string().max(500).nullable().optional(),
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
  const { companyName, email: rawEmail, password, logoObjectPath } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  // Check email uniqueness across users AND pending registrations.
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existingUser) {
    res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    return;
  }

  const pwHash = await hashPassword(password);

  // Upsert pending registration (idempotent — same email re-uses same row).
  let pending;
  try {
    const [row] = await db
      .insert(ppPendingRegistrationsTable)
      .values({ companyName, email, passwordHash: pwHash, logoObjectPath: logoObjectPath ?? null })
      .onConflictDoUpdate({
        target: ppPendingRegistrationsTable.email,
        set: {
          companyName,
          passwordHash: pwHash,
          logoObjectPath: logoObjectPath ?? null,
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
        logoObjectPath: pending.logoObjectPath,
      });
      user = result.user;
      company = result.company;
    } catch (err) {
      logger.error({ err }, 'pp register confirm: account provisioning failed');
      res.status(500).json({ error: 'Account creation failed. Please contact support.' });
      return;
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

  await createPPSession(
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

  res.json({ ok: true, companyId: user.companyId });
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

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email)));

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

  await createPPSession(
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

  res.json({ ok: true, companyId: user.companyId });
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
    .select({ id: companiesTable.id, name: companiesTable.name, ppTier: companiesTable.ppTier, logoUrl: companiesTable.logoUrl })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId));

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
    company,
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

export default router;
