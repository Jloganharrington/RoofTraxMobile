import app from "./app";
import { logger } from "./lib/logger";
import { startTerminationSweep } from "./lib/terminationSweep";
import { startTrialNightlyJob } from "./lib/trial/purge";
import { initStripe } from "./lib/stripe/init";
import { startAnnualTrueUpJob } from "./lib/pricing/trueUp";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startTerminationSweep();
  startTrialNightlyJob();
  startAnnualTrueUpJob();
  // Stripe init (schema, managed webhook, backfill) runs after listen so a
  // Stripe outage can't take down the rest of the API; billing routes will
  // surface their own errors if Stripe stays unreachable.
  initStripe().catch((err) => {
    logger.error({ err }, "Stripe initialization failed — billing routes degraded");
  });
});
