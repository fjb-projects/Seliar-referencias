import type { Reference } from './types';

const MAPS_ORIGIN = 'https://www.google.com';
const SEARCH_PATH = '/maps/search/';
const DIRECTIONS_PATH = '/maps/dir/';
const COORDINATE_PAIR = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

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
  const url = `${MAPS_ORIGIN}${SEARCH_PATH}?api=1&query=${query}`;
  return isSafeMapsUrl(url) ? url : null;
}

export function buildMapsUrlFor(ref: Pick<Reference, 'latitude' | 'longitude'>): string | null {
  return buildMapsUrl(ref.latitude, ref.longitude);
}

/**
 * Builds the official Google Maps "directions" URL with only a destination:
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 *
 * Without an origin, Google Maps starts from the device's location, so each
 * person who opens the link gets the route from where they are.
 */
export function buildDirectionsUrl(latitude: number, longitude: number): string | null {
  if (!isValidCoordinate(latitude, longitude)) return null;
  const destination = encodeURIComponent(`${latitude},${longitude}`);
  const url = `${MAPS_ORIGIN}${DIRECTIONS_PATH}?api=1&destination=${destination}`;
  return isSafeMapsUrl(url) ? url : null;
}

export function buildDirectionsUrlFor(ref: Pick<Reference, 'latitude' | 'longitude'>): string | null {
  return buildDirectionsUrl(ref.latitude, ref.longitude);
}

/** Accepts only an https Google Maps search or directions URL whose target is a "lat,lon" pair. */
export function isSafeMapsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.origin !== MAPS_ORIGIN) return false;
  if (url.searchParams.get('api') !== '1') return false;
  if (url.pathname === SEARCH_PATH) return COORDINATE_PAIR.test(url.searchParams.get('query') ?? '');
  if (url.pathname === DIRECTIONS_PATH) return COORDINATE_PAIR.test(url.searchParams.get('destination') ?? '');
  return false;
}

/** C0 and C1 control characters; a function rather than a regex, which oxlint flags as no-control-regex. */
const hasControlChars = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
const LOOSE_COORDINATE_PAIR = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;
const MAX_TEXT_LENGTH = 200;
const MAX_QUERY_LENGTH = 300;

/**
 * Builds a Google Maps text-search URL, used as a fallback when the address
 * could not be resolved to coordinates. The query is scoped to Santa Fe,
 * Argentina. Returns null for empty, oversized or control-character text.
 */
export function buildMapsTextUrl(text: string, localidad?: string): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH || hasControlChars(trimmed)) return null;
  const place = localidad?.trim();
  if (place && hasControlChars(place)) return null;
  const query = encodeURIComponent([trimmed, place, 'Santa Fe', 'Argentina'].filter(Boolean).join(', '));
  const url = `${MAPS_ORIGIN}${SEARCH_PATH}?api=1&query=${query}`;
  return isSafeMapsTextUrl(url) ? url : null;
}

/** Accepts only an https Google Maps search URL with a plain text query (coordinate links belong to isSafeMapsUrl). */
export function isSafeMapsTextUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.origin !== MAPS_ORIGIN || url.pathname !== SEARCH_PATH) return false;
  if (url.searchParams.get('api') !== '1') return false;
  const query = url.searchParams.get('query') ?? '';
  if (!query.trim() || query.length > MAX_QUERY_LENGTH) return false;
  if (hasControlChars(query)) return false;
  return !LOOSE_COORDINATE_PAIR.test(query);
}

/** Attributes every outgoing Maps link must carry. */
export const MAPS_LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const;
