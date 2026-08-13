import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { WebhookHandlers } from "./lib/stripe/webhookHandlers";
import { handleStripeBusinessEvent } from "./lib/pricing/fulfillment";
import { db, ppPackageCreditsTable, ppPendingCheckoutsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getUncachableStripeClient } from "./lib/stripe/stripeClient";

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────
// This is a pure JSON API — it never serves HTML. Disable CSP because the
// header is meaningless on JSON responses and could confuse future tooling.
// All other helmet defaults apply: X-Frame-Options, HSTS, X-Content-Type-Options,
// Referrer-Policy, X-XSS-Protection, etc.
app.use(helmet({ contentSecurityPolicy: false }));

// Trust one reverse-proxy hop so req.ip is the client address (from
// X-Forwarded-For), not the proxy's address. Replit's infrastructure
// adds exactly one hop; trusting more would allow IP spoofing via
// arbitrary X-Forwarded-For headers from untrusted sources.
app.set('trust proxy', 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ── CORS ─────────────────────────────────────────────────────────────────────
// All web portals (CRM, signing, photo) share the same origin as the API via
// Replit's path-based routing — they need no CORS configuration.
// The only genuine cross-origin caller is the Expo web preview, which uses
// Bearer tokens (not cookies). Native mobile (iOS/Android) never hits CORS.
//
// Allowlist is env-driven so production domains are added without code changes:
//   REPLIT_DEV_DOMAIN       — shared by all dev artifacts
//   REPLIT_EXPO_DEV_DOMAIN  — Expo web preview domain
//   PRODUCTION_ORIGIN       — set at deployment (https://your-deployed-url.replit.app)
const _corsAllowList: Array<string | undefined> = [
  process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : undefined,
  process.env.REPLIT_EXPO_DEV_DOMAIN
    ? `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`
    : undefined,
  process.env.PRODUCTION_ORIGIN || undefined,
];
const CORS_ALLOWED_ORIGINS = new Set(_corsAllowList.filter(Boolean) as string[]);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // No Origin header = same-origin request (e.g. server-to-server, curl).
      if (!origin || CORS_ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
      } else {
        // Deny gracefully: omit CORS headers (browser blocks the response)
        // instead of erroring the whole request with a 500.
        callback(null, false);
      }
    },
  }),
);
app.use(cookieParser());

// ── Stripe webhook ───────────────────────────────────────────────────────────
// Must be registered BEFORE express.json(): stripe-replit-sync verifies the
// signature against the raw Buffer body.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature' });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0]! : signature;
      // processWebhook verifies the signature — only after it succeeds do we
      // trust the payload for business fulfillment.
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      try {
        await handleStripeBusinessEvent(JSON.parse((req.body as Buffer).toString('utf8')));
      } catch (err) {
        // Fulfillment errors must not make Stripe re-deliver forever if the
        // sync layer succeeded — they are logged and the confirm endpoints
        // remain as the reconciliation path.
        logger.error({ err }, 'Stripe business fulfillment error');
      }
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error({ err: error }, 'Stripe webhook processing error');
      res.status(400).json({ error: 'Webhook processing error' });
    }
  },
);

// ── PP per-package Stripe webhook ─────────────────────────────────────────────
// Must be registered BEFORE express.json() so constructEvent() receives the
// raw Buffer body — parsed JSON breaks HMAC signature verification.
// Fails closed (501) when PP_STRIPE_WEBHOOK_SECRET is absent in production.
app.post(
  '/api/pp/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const webhookSecret = process.env.PP_STRIPE_WEBHOOK_SECRET;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any;

    if (webhookSecret) {
      const sig = req.headers['stripe-signature'];
      if (!sig) {
        res.status(400).json({ error: 'Missing stripe-signature header.' });
        return;
      }
      try {
        const stripe = await getUncachableStripeClient();
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
      } catch (err) {
        logger.warn({ err }, 'pp webhook: signature verification failed');
        res.status(400).json({ error: 'Webhook signature invalid.' });
        return;
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // Dev only: accept unsigned body with a loud warning.
      logger.warn('pp webhook: PP_STRIPE_WEBHOOK_SECRET not set — accepting unsigned payload (dev only)');
      try {
        event = JSON.parse((req.body as Buffer).toString('utf8'));
      } catch {
        res.status(400).json({ error: 'Invalid JSON body.' });
        return;
      }
    } else {
      // Fail closed in production: never mint credits from unsigned payloads.
      logger.error('pp webhook: PP_STRIPE_WEBHOOK_SECRET not configured — rejecting unsigned payload');
      res.status(501).json({ error: 'Webhook not configured.' });
      return;
    }

    if (event?.type === 'checkout.session.completed') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = event.data?.object as any;
      if (session?.metadata?.kind === 'pp_package' && session?.payment_status === 'paid') {
        const { companyId, inspectionId } = session.metadata as { companyId: string; inspectionId: string };
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent as { id?: string } | null)?.id ?? (session.id as string);

        if (companyId && inspectionId) {
          try {
            await db
              .insert(ppPackageCreditsTable)
              .values({ companyId, inspectionId, stripePaymentIntentId: paymentIntentId })
              .onConflictDoNothing();
            // Clean up the pending checkout so future checkout calls don't try to
            // reuse a session that's already completed.
            await db
              .delete(ppPendingCheckoutsTable)
              .where(
                and(
                  eq(ppPendingCheckoutsTable.companyId, companyId),
                  eq(ppPendingCheckoutsTable.inspectionId, inspectionId),
                ),
              );
          } catch (err) {
            logger.error({ err, companyId, inspectionId }, 'pp webhook: failed to insert credit');
            // Return 5xx so Stripe redelivers — do not swallow DB errors with 200.
            res.status(500).json({ error: 'Credit persistence failed; retry.' });
            return;
          }
        }
      }
    }

    res.json({ received: true });
  },
);

// Routes that receive large base64 payloads get specific size limits.
// All others keep the Express default (100kb) to limit the DoS surface.
// Registered first: express.json marks the body as parsed, so the general
// parser below skips requests these already handled.
app.use('/api/inspections/:inspectionId/email-report', express.json({ limit: '15mb' }));
// AHJ Wizard corpus upload: licensed code documents may be several MB of text.
app.use('/api/ahj-wizard/sources', express.json({ limit: '10mb' }));
// Sign endpoint: receives a base64 PNG signature image (~50–500KB).
// PDF base64 from expo-print can be ~2 MB binary → ~2.7 MB base64; allow 5 MB.
app.use('/api/inspections/:inspectionId/agreement/sign', express.json({ limit: '5mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
