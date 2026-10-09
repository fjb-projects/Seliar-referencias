import type { Reference } from './types';

const MAPS_ORIGIN = 'https://www.google.com';
const MAPS_PATH = '/maps/search/';

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Builds the official Google Maps "search by coordinates" URL:
 * https://developers.google.com/maps/documentation/urls/get-started#search-action
 *
 * Uses only the stored coordinates, with no rounding. Returns null when the
 * coordinates are not usable, so callers can never render a broken link.
 */
export function buildMapsUrl(latitude: number, longitude: number): string | null {
  if (!isValidCoordinate(latitude, longitude)) return null;
  const query = encodeURIComponent(`${latitude},${longitude}`);
  const url = `${MAPS_ORIGIN}${MAPS_PATH}?api=1&query=${query}`;
  return isSafeMapsUrl(url) ? url : null;
}

export function buildMapsUrlFor(ref: Pick<Reference, 'latitude' | 'longitude'>): string | null {
  return buildMapsUrl(ref.latitude, ref.longitude);
}

/** Accepts only an https Google Maps search URL carrying a "lat,lon" query. */
export function isSafeMapsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.origin !== MAPS_ORIGIN || url.pathname !== MAPS_PATH) return false;
  if (url.searchParams.get('api') !== '1') return false;
  const q = url.searchParams.get('query') ?? '';
  return /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(q);
}

/** Attributes every outgoing Maps link must carry. */
export const MAPS_LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const;
