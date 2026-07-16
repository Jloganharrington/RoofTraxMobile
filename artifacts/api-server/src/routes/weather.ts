import { GetWeatherEventsQueryParams, GetWeatherEventsResponse } from '@workspace/api-zod';
import { db, userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { logger } from '../lib/logger';
import { canAccessInspectionModule } from '../lib/permissions';
import {
  aggregateByDate,
  normalizeEvents,
  passesHardGates,
  primaryTime,
  primaryType,
  severityScore,
  type NormalizedWeatherEvent,
  type RawVisualCrossingResponse,
} from '../lib/weatherEngine';

const router: IRouter = Router();

// -----------------------------------------------------------------------------
// B5 — Weather engine. The deterministic VisualCrossing retrieval, event
// normalization, per-day aggregation, hard-gate eligibility, and severity
// ranking live in ../lib/weatherEngine (extracted verbatim from RoofTrax Pro).
// The AI (Anthropic) hail-scoring seam is intentionally CUT — this endpoint
// returns deterministic candidate storms only; the inspector confirms the
// storm of record. No LLM, no ANTHROPIC_API_KEY. Gated by the inspection
// module permission and always company-scoped by the caller's session.
// -----------------------------------------------------------------------------

const VISUALCROSSING_BASE =
  'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline';
const LOOKBACK_MONTHS = 24;
const FRESH_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CANDIDATES = 15;

interface WeatherEventsResult {
  location: string;
  events: NormalizedWeatherEvent[];
  cachedAtMs: number;
}

// In-memory, per-process cache. Fresh for FRESH_TTL_MS; stale entries are kept
// forever and served whenever the provider call fails — a long Timeline query
// burns hundreds of VisualCrossing "result records" against the daily budget,
// so every avoidable call matters.
const weatherCache = new Map<string, WeatherEventsResult>();

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function requireInspectionModuleAccess(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  const department = profile?.department ?? 'canvasser';
  if (!canAccessInspectionModule(role, department)) {
    res.status(403).json({ error: 'Inspection module not enabled for this user' });
    return null;
  }

  return { companyId: req.user.companyId };
}

router.get('/weather/events', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  // Guard on the raw query first: the generated zod uses `coerce.string()`
  // for required query params, which turns a MISSING value into the literal
  // string "undefined" — so safeParse alone can't detect an absent location.
  if (typeof req.query.location !== 'string' || !req.query.location.trim()) {
    res.status(400).json({ error: 'location is required' });
    return;
  }

  const parsed = GetWeatherEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query' });
    return;
  }

  const location = parsed.data.location.trim();
  const dateOfLoss = parsed.data.dateOfLoss?.trim() || null;

  const apiKey = process.env.VISUALCROSSING_API_KEY;
  if (!apiKey) {
    res.status(502).json({ error: 'Weather data provider is not configured' });
    return;
  }

  const cacheKey = location.toLowerCase();
  const cached = weatherCache.get(cacheKey);

  let result: WeatherEventsResult | null = null;
  let servedFromCache = false;

  if (cached && Date.now() - cached.cachedAtMs < FRESH_TTL_MS) {
    result = cached;
    servedFromCache = true;
  } else {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - LOOKBACK_MONTHS);

    const url =
      `${VISUALCROSSING_BASE}/${encodeURIComponent(location)}/${toYMD(start)}/${toYMD(end)}` +
      `?unitGroup=us&include=events&contentType=json&key=${apiKey}`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        logger.error(
          { status: response.status, body: bodyText.slice(0, 500) },
          '[weather] VisualCrossing request failed',
        );
        if (cached) {
          result = cached;
          servedFromCache = true;
        } else {
          res.status(502).json({ error: 'Failed to retrieve weather data' });
          return;
        }
      } else {
        const raw = (await response.json()) as RawVisualCrossingResponse;
        result = {
          location: raw.resolvedAddress ?? location,
          events: normalizeEvents(raw),
          cachedAtMs: Date.now(),
        };
        weatherCache.set(cacheKey, result);
      }
    } catch (err) {
      logger.error({ err }, '[weather] VisualCrossing request threw');
      if (cached) {
        result = cached;
        servedFromCache = true;
      } else {
        res.status(502).json({ error: 'Failed to retrieve weather data' });
        return;
      }
    }
  }

  if (!result) {
    res.status(502).json({ error: 'Failed to retrieve weather data' });
    return;
  }

  // Deterministic: aggregate by day, apply hard gates, rank by severity. When
  // a date of loss is given, prefer temporal proximity to it, breaking ties by
  // severity — so the most-likely storm of record surfaces first.
  const qualifying = Array.from(aggregateByDate(result.events).values()).filter((d) =>
    passesHardGates(d),
  );

  const lossMs = dateOfLoss ? new Date(dateOfLoss).getTime() : null;
  qualifying.sort((a, b) => {
    if (lossMs != null && Number.isFinite(lossMs)) {
      const da = Math.abs(new Date(a.date).getTime() - lossMs);
      const dbb = Math.abs(new Date(b.date).getTime() - lossMs);
      if (da !== dbb) return da - dbb;
    }
    return severityScore(b) - severityScore(a);
  });

  const candidates = qualifying.slice(0, MAX_CANDIDATES).map((day) => ({
    date: day.date,
    time: primaryTime(day),
    type: primaryType(day),
    hailSize: day.hailSize,
    windSpeed: day.windSpeed,
    tornado: day.types.has('tornado'),
    severityScore: Math.round(severityScore(day) * 100) / 100,
    description: day.description,
  }));

  res.json(
    GetWeatherEventsResponse.parse({
      candidates,
      queriedLocation: result.location,
      dateOfLoss,
      cached: servedFromCache,
    }),
  );
});

export default router;
