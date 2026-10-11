const GEOREF_API = 'https://apis.datos.gob.ar/georef/api';
const GEOREF_URL = `${GEOREF_API}/direcciones`;
const GEOREF_STREETS_URL = `${GEOREF_API}/calles`;
const PROVINCIA_SANTA_FE = '82';
const MAX_RESULTS = 5;
const MAX_STREETS = 20;
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
  /** Official street name (`calle.nombre`), e.g. "SAN MARTIN"; empty when the API omits it. */
  calle: string;
  /** House number Georef resolved (`altura.valor`); null when missing or non-numeric. */
  altura: number | null;
}

/** A street known to Georef in one locality, with the house-number range it covers. */
export interface GeorefStreet {
  nombre: string;
  localidad: string;
  /** Lowest house number of the street; null when Georef has no range data. */
  alturaMin: number | null;
  /** Highest house number of the street; null when Georef has no range data. */
  alturaMax: number | null;
}

/** Options shared by the Georef lookups. */
interface GeorefRequestOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const HAS_NUMBER = /\d/;
const INTERSECTION = /\S+\s+y\s+\S+/i;
const DIGITS_ONLY = /^\d+$/;

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reads a house number the API may send as a number or as a string of digits.
 * `Number()` would also take "0x10", "1e3" or "12.5", none of which is a house number.
 */
function toAltura(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return DIGITS_ONLY.test(text) ? Number(text) : null;
}

function toHit(raw: unknown): GeorefHit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as {
    nomenclatura?: unknown;
    calle?: { nombre?: unknown } | null;
    altura?: { valor?: unknown } | null;
    localidad_censal?: { nombre?: unknown } | null;
    ubicacion?: { lat?: unknown; lon?: unknown } | null;
  };
  const lat = entry.ubicacion?.lat;
  const lon = entry.ubicacion?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (typeof entry.nomenclatura !== 'string') return null;
  const nombre = entry.localidad_censal?.nombre;
  const calle = entry.calle?.nombre;
  return {
    label: entry.nomenclatura,
    localidad: typeof nombre === 'string' ? nombre : '',
    latitude: lat,
    longitude: lon,
    calle: typeof calle === 'string' ? calle : '',
    altura: toAltura(entry.altura?.valor),
  };
}

type StreetSides = { derecha?: unknown; izquierda?: unknown } | null | undefined;

/** The finite house numbers of one end of a street (its right and left sides). */
function finiteSides(sides: StreetSides): number[] {
  return [sides?.derecha, sides?.izquierda].filter(isFiniteNumber);
}

function toStreet(raw: unknown): GeorefStreet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as {
    nombre?: unknown;
    localidad_censal?: { nombre?: unknown } | null;
    altura?: { inicio?: StreetSides; fin?: StreetSides } | null;
  };
  if (typeof entry.nombre !== 'string') return null;
  const localidad = entry.localidad_censal?.nombre;
  // Both bounds read all four side values: a street digitised backwards has its start above its end.
  const sides = [...finiteSides(entry.altura?.inicio), ...finiteSides(entry.altura?.fin)];
  let alturaMin = sides.length > 0 ? Math.min(...sides) : null;
  let alturaMax = sides.length > 0 ? Math.max(...sides) : null;
  // The API reports 0 on both ends when it has no range data for the street.
  if (alturaMin === 0 && alturaMax === 0) {
    alturaMin = null;
    alturaMax = null;
  }
  return {
    nombre: entry.nombre,
    localidad: typeof localidad === 'string' ? localidad : '',
    alturaMin,
    alturaMax,
  };
}

/**
 * GETs a Georef endpoint with the fixed province/locality filters and returns
 * the parsed JSON body. Never throws: an already-aborted signal (no request is
 * made), network errors, non-2xx responses, malformed JSON, timeouts and aborts
 * (by the caller's signal or the timeout) all resolve to `undefined`.
 */
async function requestGeoref(
  endpoint: string,
  params: Record<string, string>,
  signal: AbortSignal | undefined,
  opts: GeorefRequestOptions,
): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return undefined;
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  try {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('provincia', PROVINCIA_SANTA_FE);
    url.searchParams.set('localidad_censal', Object.keys(GEOREF_LOCALIDADES).join(','));

    const response = await fetchImpl(url.toString(), { signal: controller.signal });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    return body;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Maps the array stored under `key` in a response body, skipping the entries `map` rejects. */
function mapList<T>(body: unknown, key: string, map: (raw: unknown) => T | null): T[] {
  if (typeof body !== 'object' || body === null) return [];
  const list = (body as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.map(map).filter((item): item is T => item !== null);
}

/**
 * Looks an address up in the Georef API, restricted to the allowed localities.
 * Never throws: network errors, non-2xx responses, malformed JSON, timeouts and
 * aborts (by the caller's signal or the timeout) all resolve to an empty array.
 */
export async function searchGeoref(
  text: string,
  signal?: AbortSignal,
  opts: GeorefRequestOptions = {},
): Promise<GeorefHit[]> {
  const body = await requestGeoref(GEOREF_URL, { direccion: text, max: String(MAX_RESULTS) }, signal, opts);
  return mapList(body, 'direcciones', toHit);
}

/**
 * Looks a street name up in the Georef API (`/calles`), restricted to the
 * allowed localities; one entry per locality the street exists in, with its
 * house-number range. An empty name resolves to an empty array without a
 * request. Never throws: same contract as `searchGeoref`.
 */
export async function searchGeorefStreets(
  name: string,
  signal?: AbortSignal,
  opts: GeorefRequestOptions = {},
): Promise<GeorefStreet[]> {
  if (name.trim() === '') return [];
  const body = await requestGeoref(GEOREF_STREETS_URL, { nombre: name, max: String(MAX_STREETS) }, signal, opts);
  return mapList(body, 'calles', toStreet);
}
