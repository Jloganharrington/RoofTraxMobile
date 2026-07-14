// Deterministic weather engine (B5). Extracted verbatim from RoofTrax Pro's
// weather route — retrieval normalization, per-day aggregation, hard-gate
// eligibility, and severity ranking. The AI (Anthropic) hail-scoring seam is
// intentionally NOT ported. These are pure functions with no I/O so they can
// be unit-tested for parity against the Pro implementation.

export type WeatherEventType = 'hail' | 'wind' | 'tornado';

export interface NormalizedWeatherEvent {
  type: WeatherEventType;
  date: string;
  size: number | null;
  distance: number | null;
  magnitude: number | null;
  description: string | null;
}

export interface RawVisualCrossingResponse {
  resolvedAddress?: string;
  days?: Array<{
    datetime?: string;
    events?: Array<{
      type?: string;
      datetime?: string;
      size?: unknown;
      distance?: unknown;
      magnitude?: unknown;
      speed?: unknown;
      windspeed?: unknown;
      description?: string;
    }>;
  }>;
}

export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function classifyType(rawType: unknown): WeatherEventType | 'other' {
  const t = String(rawType ?? '').toLowerCase();
  if (t.includes('hail')) return 'hail';
  if (t.includes('tornado')) return 'tornado';
  if (t.includes('wind')) return 'wind';
  return 'other';
}

export function normalizeEvents(raw: RawVisualCrossingResponse): NormalizedWeatherEvent[] {
  const events: NormalizedWeatherEvent[] = [];

  for (const day of raw.days ?? []) {
    for (const ev of day.events ?? []) {
      const type = classifyType(ev.type);
      if (type === 'other') continue;

      const date = (ev.datetime ?? day.datetime ?? '').slice(0, 10);
      events.push({
        type,
        date,
        size: numOrNull(ev.size),
        distance: numOrNull(ev.distance),
        magnitude: numOrNull(ev.magnitude ?? ev.speed ?? ev.windspeed),
        description: ev.description ?? null,
      });
    }
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}

export interface AggregatedDay {
  date: string;
  hailSize: number | null;
  windSpeed: number | null;
  distance: number | null;
  types: Set<WeatherEventType>;
  description: string | null;
}

export function aggregateByDate(events: NormalizedWeatherEvent[]): Map<string, AggregatedDay> {
  const byDate = new Map<string, AggregatedDay>();

  for (const ev of events) {
    let day = byDate.get(ev.date);
    if (!day) {
      day = {
        date: ev.date,
        hailSize: null,
        windSpeed: null,
        distance: null,
        types: new Set(),
        description: null,
      };
      byDate.set(ev.date, day);
    }

    day.types.add(ev.type);

    if (ev.type === 'hail' && ev.size != null) {
      day.hailSize = day.hailSize == null ? ev.size : Math.max(day.hailSize, ev.size);
    }
    if ((ev.type === 'wind' || ev.type === 'tornado') && ev.magnitude != null) {
      day.windSpeed = day.windSpeed == null ? ev.magnitude : Math.max(day.windSpeed, ev.magnitude);
    }
    if (ev.distance != null) {
      day.distance = day.distance == null ? ev.distance : Math.min(day.distance, ev.distance);
    }
    if (ev.description) {
      day.description = day.description ? `${day.description}\n\n${ev.description}` : ev.description;
    }
  }

  for (const day of byDate.values()) {
    if (!day.description) continue;
    const parts = day.description.split('\n\n');
    day.description = Array.from(new Set(parts)).join('\n\n');
  }

  return byDate;
}

const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

// Recency (within 2 years) AND (hail > 1.0" OR wind > 60mph OR tornado).
// `now` is injectable so the recency gate is deterministic under test.
export function passesHardGates(day: AggregatedDay, now: number = Date.now()): boolean {
  const dayMs = new Date(day.date).getTime();
  if (now - dayMs > TWO_YEARS_MS) return false;

  const hasQualifyingHail = day.hailSize != null && day.hailSize > 1.0;
  const hasQualifyingWind = day.windSpeed != null && day.windSpeed > 60;
  const hasTornado = day.types.has('tornado');

  return hasQualifyingHail || hasQualifyingWind || hasTornado;
}

export function severityScore(day: AggregatedDay): number {
  const hail = day.hailSize ?? 0;
  const wind = day.windSpeed ?? 0;
  const distance = day.distance ?? Infinity;
  return hail * 30 + wind * 0.5 + Math.max(0, 25 - distance);
}

export function primaryType(day: AggregatedDay): WeatherEventType {
  if (day.types.has('tornado')) return 'tornado';
  if (day.types.has('hail')) return 'hail';
  return 'wind';
}
