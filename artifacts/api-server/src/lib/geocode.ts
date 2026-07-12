interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
}

interface NominatimReverseResponse {
  display_name?: string;
  address?: NominatimAddress;
}

// Formats a Nominatim address into "1111 Street Name, City, State, Zipcode" —
// deliberately dropping county and country, which Nominatim's `display_name`
// otherwise includes.
function formatAddress(address: NominatimAddress): string | null {
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  const city = address.city ?? address.town ?? address.village ?? address.hamlet;

  const parts = [street, city, address.state, address.postcode].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(', ') : null;
}

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
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RoofTrax/1.0 (field-ops pin tracking)',
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as NominatimReverseResponse;
    if (!data.address) return data.display_name ?? null;

    return formatAddress(data.address) ?? data.display_name ?? null;
  } catch {
    return null;
  }
}
