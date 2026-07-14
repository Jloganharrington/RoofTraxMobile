import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GPS_TOLERANCE_METERS,
  evaluateGpsTolerance,
  haversineMeters,
} from '../geoTolerance';

describe('geoTolerance', () => {
  const lat = 39.7392;
  const lng = -104.9903; // Denver, CO

  it('reports ~0 distance and passes for identical points', () => {
    const r = evaluateGpsTolerance(lat, lng, lat, lng);
    expect(r.distanceMeters).toBe(0);
    expect(r.pass).toBe(true);
    expect(r.toleranceMeters).toBe(DEFAULT_GPS_TOLERANCE_METERS);
  });

  it('passes when the device is within tolerance', () => {
    // ~40m north (0.00036 deg lat ≈ 40m).
    const r = evaluateGpsTolerance(lat + 0.00036, lng, lat, lng);
    expect(r.distanceMeters).toBeGreaterThan(30);
    expect(r.distanceMeters).toBeLessThan(50);
    expect(r.pass).toBe(true);
  });

  it('fails when the device is beyond tolerance', () => {
    // ~1km north.
    const r = evaluateGpsTolerance(lat + 0.009, lng, lat, lng);
    expect(r.distanceMeters).toBeGreaterThan(900);
    expect(r.pass).toBe(false);
  });

  it('passes exactly at the tolerance boundary (override not required)', () => {
    // Choose a custom tolerance equal to the measured distance.
    const measured = haversineMeters(lat + 0.00036, lng, lat, lng);
    const r = evaluateGpsTolerance(lat + 0.00036, lng, lat, lng, measured);
    expect(r.pass).toBe(true);
  });

  it('honors a custom tolerance (fail becomes pass when widened)', () => {
    const strict = evaluateGpsTolerance(lat + 0.009, lng, lat, lng, 100);
    const loose = evaluateGpsTolerance(lat + 0.009, lng, lat, lng, 5000);
    expect(strict.pass).toBe(false);
    expect(loose.pass).toBe(true);
  });

  it('haversine is symmetric', () => {
    const a = haversineMeters(lat, lng, lat + 0.01, lng + 0.01);
    const b = haversineMeters(lat + 0.01, lng + 0.01, lat, lng);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});
