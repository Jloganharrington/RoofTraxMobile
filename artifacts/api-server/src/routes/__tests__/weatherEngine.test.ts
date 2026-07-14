import { describe, expect, it } from 'vitest';

import {
  aggregateByDate,
  classifyType,
  normalizeEvents,
  numOrNull,
  passesHardGates,
  primaryType,
  severityScore,
  type RawVisualCrossingResponse,
} from '../../lib/weatherEngine';

// Parity tests for the deterministic weather engine extracted from RoofTrax
// Pro. These lock the retrieval normalization + gating + severity math so a
// known location/date behaves exactly as the Pro implementation did.

const raw: RawVisualCrossingResponse = {
  resolvedAddress: 'Denver, CO, USA',
  days: [
    {
      datetime: '2025-06-01',
      events: [
        { type: 'Hail', datetime: '2025-06-01', size: 1.5, distance: 3 },
        { type: 'Hail', datetime: '2025-06-01', size: 2.0, distance: 5, description: 'Large hail' },
        { type: 'Thunderstorm Wind', datetime: '2025-06-01', speed: 70, distance: 2 },
      ],
    },
    {
      datetime: '2025-06-02',
      events: [{ type: 'Wind', datetime: '2025-06-02', windspeed: 40, distance: 10 }],
    },
    {
      datetime: '2025-06-03',
      events: [{ type: 'Tornado', datetime: '2025-06-03', magnitude: 3, distance: 8 }],
    },
    {
      datetime: '2025-06-04',
      events: [{ type: 'Rain', datetime: '2025-06-04' }],
    },
  ],
};

describe('weatherEngine helpers', () => {
  it('numOrNull coerces and rejects non-finite', () => {
    expect(numOrNull(3)).toBe(3);
    expect(numOrNull('2.5')).toBe(2.5);
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull('abc')).toBeNull();
  });

  it('classifyType maps provider strings', () => {
    expect(classifyType('Hail')).toBe('hail');
    expect(classifyType('Thunderstorm Wind')).toBe('wind');
    expect(classifyType('Tornado')).toBe('tornado');
    expect(classifyType('Rain')).toBe('other');
  });
});

describe('normalizeEvents', () => {
  it('drops non-severe types and sorts most-recent first', () => {
    const events = normalizeEvents(raw);
    // Rain (2025-06-04) is dropped; 5 severe events remain
    // (2 hail + 1 wind on 06-01, 1 wind on 06-02, 1 tornado on 06-03).
    expect(events).toHaveLength(5);
    expect(events[0].date).toBe('2025-06-03'); // tornado, most recent
    expect(events.every((e) => e.type !== ('other' as never))).toBe(true);
  });

  it('pulls wind magnitude from speed/windspeed fields', () => {
    const events = normalizeEvents(raw);
    const wind0602 = events.find((e) => e.date === '2025-06-02');
    expect(wind0602?.magnitude).toBe(40);
    const wind0601 = events.find((e) => e.date === '2025-06-01' && e.type === 'wind');
    expect(wind0601?.magnitude).toBe(70);
  });
});

describe('aggregateByDate', () => {
  it('takes max hail, max wind, min distance per day', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    const d = byDate.get('2025-06-01')!;
    expect(d.hailSize).toBe(2.0); // max of 1.5, 2.0
    expect(d.windSpeed).toBe(70);
    expect(d.distance).toBe(2); // min of 3, 5, 2
    expect(d.types.has('hail')).toBe(true);
    expect(d.types.has('wind')).toBe(true);
  });
});

describe('passesHardGates', () => {
  const now = new Date('2025-07-01').getTime();

  it('qualifies a recent big-hail day', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    expect(passesHardGates(byDate.get('2025-06-01')!, now)).toBe(true);
  });

  it('rejects a sub-threshold wind-only day', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    expect(passesHardGates(byDate.get('2025-06-02')!, now)).toBe(false); // 40mph < 60
  });

  it('qualifies any tornado day', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    expect(passesHardGates(byDate.get('2025-06-03')!, now)).toBe(true);
  });

  it('rejects events older than 2 years', () => {
    const old = aggregateByDate(
      normalizeEvents({
        days: [{ datetime: '2020-06-01', events: [{ type: 'Hail', size: 3, distance: 1 }] }],
      }),
    );
    expect(passesHardGates(old.get('2020-06-01')!, now)).toBe(false);
  });
});

describe('severityScore + primaryType', () => {
  it('scores hail*30 + wind*0.5 + proximity bonus', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    const d = byDate.get('2025-06-01')!;
    // hail 2.0*30=60, wind 70*0.5=35, distance 2 -> max(0,25-2)=23 => 118
    expect(severityScore(d)).toBe(118);
  });

  it('ranks tornado as the primary type when present', () => {
    const byDate = aggregateByDate(normalizeEvents(raw));
    expect(primaryType(byDate.get('2025-06-03')!)).toBe('tornado');
    expect(primaryType(byDate.get('2025-06-01')!)).toBe('hail');
  });
});
