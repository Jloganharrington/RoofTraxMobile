// Arrival GPS-vs-geocode tolerance check (B6 / S1). Pure geometry, no I/O, so
// both the mobile arrival flow and the server can share one source of truth
// and it stays trivially unit-testable. The arrival flow geocodes the claim
// address, reads the device GPS, and compares the two: within tolerance is a
// pass; beyond it the inspector must override with an attestation.

export const DEFAULT_GPS_TOLERANCE_METERS = 100;

export interface GpsToleranceResult {
  distanceMeters: number;
  toleranceMeters: number;
  pass: boolean;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle (haversine) distance in meters between two lat/long points.
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Evaluate whether the device position is close enough to the geocoded
// address. `pass` is true when the distance is within (<=) tolerance.
export function evaluateGpsTolerance(
  deviceLat: number,
  deviceLng: number,
  geocodedLat: number,
  geocodedLng: number,
  toleranceMeters: number = DEFAULT_GPS_TOLERANCE_METERS,
): GpsToleranceResult {
  const distanceMeters = haversineMeters(deviceLat, deviceLng, geocodedLat, geocodedLng);
  const rounded = Math.round(distanceMeters * 100) / 100;
  return {
    distanceMeters: rounded,
    toleranceMeters,
    pass: rounded <= toleranceMeters,
  };
}
