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
