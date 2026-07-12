// Reverse geocoding helper backed by OpenStreetMap's Nominatim service.
// Best-effort only: failures resolve to `null` rather than throwing, so pin
// creation never fails just because a human-readable address is unavailable.
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('format', 'jsonv2');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RoofTrax/1.0 (field-ops pin tracking)',
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}
