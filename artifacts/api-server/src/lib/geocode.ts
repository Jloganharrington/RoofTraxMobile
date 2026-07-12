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

interface NominatimSearchResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: NominatimAddress;
}

export interface GeocodeSearchResult {
  address: string;
  latitude: number;
  longitude: number;
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

// Forward geocoding helper backed by Nominatim's /search endpoint, used to
// let a rep look up a specific address instead of only working off their
// current GPS position. Best-effort only: failures resolve to an empty
// array rather than throwing.
export async function searchAddress(query: string): Promise<GeocodeSearchResult[]> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RoofTrax/1.0 (field-ops pin tracking)',
      },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as NominatimSearchResult[];

    return data
      .map((result) => {
        const latitude = Number(result.lat);
        const longitude = Number(result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        const address =
          (result.address && formatAddress(result.address)) || result.display_name;

        return { address, latitude, longitude };
      })
      .filter((result): result is GeocodeSearchResult => result !== null);
  } catch {
    return [];
  }
}
