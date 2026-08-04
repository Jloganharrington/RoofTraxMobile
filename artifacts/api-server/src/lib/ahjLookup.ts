/**
 * AHJ (Authority Having Jurisdiction) lookup.
 *
 * When the FIPSA is signed, this runs non-blocking to determine which
 * municipality/county governs the inspection address, then checks whether
 * that jurisdiction has an AHJ Pack in the company's library.
 *
 * The result is written back to inspections.ahj_check. A packPresent = false
 * result surfaces as a warning flag in the Lead Profile UI.
 */

import { ai } from '@workspace/integrations-gemini-ai';
import { db, inspectionsTable, ahjPacksTable } from '@workspace/db';
import { and, eq, ilike } from 'drizzle-orm';

const MODEL = 'gemini-3.1-pro-preview';

// ── Gemini AHJ research ───────────────────────────────────────────────────────

interface AhjLookupResult {
  jurisdiction: string;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

async function lookupAhjForAddress(address: string): Promise<AhjLookupResult> {
  const prompt = `You are a building code compliance expert. Identify the Authority Having Jurisdiction (AHJ) for a property.

The AHJ is the local government entity — a city, incorporated town, municipality, county, or township — that has the legal authority to issue building permits and enforce the adopted construction code for the property.

Property address: ${address}

Search for this address and determine the correct AHJ. Use the official government name (e.g. "Fairfax County", "City of Richmond", "Prince William County", "Town of Herndon").

Respond ONLY with a JSON object in this exact shape — no markdown fences, no extra text:
{
  "jurisdiction": "<official AHJ name>",
  "confidence": "high" | "medium" | "low",
  "summary": "<1-2 sentences explaining why this entity is the AHJ for this address>"
}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
      maxOutputTokens: 8192,
    },
  });

  const raw = response.text ?? '';
  // Strip any accidental markdown code fences
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/m, '')
    .trim();

  let parsed: AhjLookupResult;
  try {
    parsed = JSON.parse(cleaned) as AhjLookupResult;
  } catch {
    throw new Error(`AHJ lookup: could not parse Gemini response as JSON. Raw: ${raw.slice(0, 300)}`);
  }

  if (!parsed.jurisdiction || typeof parsed.jurisdiction !== 'string') {
    throw new Error('AHJ lookup: response missing jurisdiction field');
  }

  return {
    jurisdiction: parsed.jurisdiction.trim(),
    confidence: (['high', 'medium', 'low'] as const).includes(parsed.confidence)
      ? parsed.confidence
      : 'low',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}

// ── Pack library check ────────────────────────────────────────────────────────

async function checkPackPresent(jurisdiction: string, companyId: string): Promise<boolean> {
  // Case-insensitive exact match. If the library uses slightly different
  // capitalisation or phrasing a future fuzzy pass can widen this; for now
  // an exact ILIKE is the safest gate to avoid false positives.
  const [row] = await db
    .select({ id: ahjPacksTable.id })
    .from(ahjPacksTable)
    .where(
      and(
        eq(ahjPacksTable.companyId, companyId),
        ilike(ahjPacksTable.jurisdiction, jurisdiction),
      ),
    )
    .limit(1);

  return !!row;
}

// ── Public entry point ────────────────────────────────────────────────────────

type PinoLog = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

/**
 * Fire-and-forget AHJ check. Writes the result (or skips on error) to
 * inspections.ahj_check. Never throws — all failures are logged and swallowed
 * so the caller's 201 response is never at risk.
 */
export async function runAhjCheck(
  inspectionId: string,
  address: string,
  companyId: string,
  log?: PinoLog,
): Promise<void> {
  try {
    log?.info({ inspectionId, address }, 'AHJ check: starting');

    const { jurisdiction, confidence, summary } = await lookupAhjForAddress(address);
    const packPresent = await checkPackPresent(jurisdiction, companyId);

    await db
      .update(inspectionsTable)
      .set({
        ahjCheck: {
          jurisdiction,
          packPresent,
          checkedAt: new Date().toISOString(),
          model: MODEL,
          confidence,
          summary,
        },
      })
      .where(eq(inspectionsTable.id, inspectionId));

    log?.info(
      { inspectionId, jurisdiction, packPresent, confidence },
      `AHJ check: complete — ${packPresent ? 'pack found' : 'NO pack in library'}`,
    );
  } catch (err) {
    log?.warn({ inspectionId, err }, 'AHJ check: failed — skipping (non-blocking)');
  }
}
