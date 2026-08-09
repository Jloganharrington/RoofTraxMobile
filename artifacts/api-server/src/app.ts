import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

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
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
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
