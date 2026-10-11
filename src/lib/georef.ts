const GEOREF_URL = 'https://apis.datos.gob.ar/georef/api/direcciones';
const PROVINCIA_SANTA_FE = '82';
const MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_MS = 1500;

/** Censal localities (all in La Capital, Santa Fe) the Georef lookup is restricted to: id -> name. */
export const GEOREF_LOCALIDADES: Readonly<Record<string, string>> = {
  '82063170': 'Santa Fe',
  '82063140': 'Recreo',
  '82063100': 'Monte Vera',
  '82063060': 'Candioti',
  '82063010': 'Angel Gallardo',
  '82063160': 'San José del Rincón',
  '82063030': 'Arroyo Leyes',
  '82063180': 'Santo Tomé',
  '82063190': 'Sauce Viejo',
};

/** An approximate address returned by Georef. Never a verified reference. */
export interface GeorefHit {
  label: string;
  localidad: string;
  latitude: number;
  longitude: number;
}

const HAS_NUMBER = /\d/;
const INTERSECTION = /\S+\s+y\s+\S+/i;

/**
 * Heuristic: true when the query looks like a street address, i.e. it contains
 * a number (altura) or two words joined by " y " (intersection). Plain place
 * names such as "comisaria" are not addresses.
 */
export function looksLikeAddress(query: string): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  return HAS_NUMBER.test(text) || INTERSECTION.test(text);
}

function toHit(raw: unknown): GeorefHit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as {
    nomenclatura?: unknown;
    localidad_censal?: { nombre?: unknown } | null;
    ubicacion?: { lat?: unknown; lon?: unknown } | null;
  };
  const lat = entry.ubicacion?.lat;
  const lon = entry.ubicacion?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (typeof entry.nomenclatura !== 'string') return null;
  const nombre = entry.localidad_censal?.nombre;
  return {
    label: entry.nomenclatura,
    localidad: typeof nombre === 'string' ? nombre : '',
    latitude: lat,
    longitude: lon,
  };
}

/**
 * Looks an address up in the Georef API, restricted to the allowed localities.
 * Never throws: network errors, non-2xx responses, malformed JSON, timeouts and
 * aborts (by the caller's signal or the timeout) all resolve to an empty array.
 */
export async function searchGeoref(
  text: string,
  signal?: AbortSignal,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<GeorefHit[]> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return [];
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  try {
    const url = new URL(GEOREF_URL);
    url.searchParams.set('direccion', text);
    url.searchParams.set('provincia', PROVINCIA_SANTA_FE);
    url.searchParams.set('localidad_censal', Object.keys(GEOREF_LOCALIDADES).join(','));
    url.searchParams.set('max', String(MAX_RESULTS));

    const response = await fetchImpl(url.toString(), { signal: controller.signal });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const list = (body as { direcciones?: unknown } | null)?.direcciones;
    if (!Array.isArray(list)) return [];
    return list.map(toHit).filter((hit): hit is GeorefHit => hit !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
