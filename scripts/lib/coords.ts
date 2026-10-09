export type CoordResult =
  | { ok: true; latitude: number; longitude: number; raw: string }
  | { ok: false; reason: 'vacia' | 'no_numerica' | 'formato_no_reconocido' | 'fuera_de_rango' };

const DOT = /^(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)$/;
const COMMA_DECIMAL = /^(-?\d{1,3},\d+)\s*;\s*(-?\d{1,3},\d+)$/;

/**
 * Parses a "lat, lon" text. Never guesses: anything that is not a clearly
 * formatted pair is rejected with a reason so it can be reviewed by a human.
 */
export function parseCoordinate(input: string): CoordResult {
  const raw = input.replace(/ /g, ' ').trim();
  if (raw === '') return { ok: false, reason: 'vacia' };
  if (!/\d/.test(raw)) return { ok: false, reason: 'no_numerica' };

  let m = DOT.exec(raw);
  let a: string;
  let b: string;
  if (m) {
    [, a, b] = m;
  } else if ((m = COMMA_DECIMAL.exec(raw))) {
    a = m[1].replace(',', '.');
    b = m[2].replace(',', '.');
  } else {
    // Mixed text and digits (an address such as "Mendoza 3949") lands here.
    return { ok: false, reason: /^[-\d.,;\s]+$/.test(raw) ? 'formato_no_reconocido' : 'no_numerica' };
  }

  const latitude = Number(a);
  const longitude = Number(b);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, reason: 'formato_no_reconocido' };
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { ok: false, reason: 'fuera_de_rango' };
  }
  return { ok: true, latitude, longitude, raw };
}

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
