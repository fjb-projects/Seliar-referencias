/** Sheet titles are often typed in capitals ("BARRIO FAVALORO"); show them in a readable case. */
export function displayBarrio(barrio: string): string {
  const letters = barrio.replace(/[^\p{L}]/gu, '');
  if (letters === '' || letters !== letters.toUpperCase()) return barrio.trim();
  const small = new Set(['de', 'del', 'la', 'el', 'y', 'en']);
  return barrio
    .trim()
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const TIPO_LABEL: Record<string, string> = {
  barrio: 'Barrio',
  referencia: 'Referencia',
  calle: 'Calle',
  torre: 'Torre',
  monoblock: 'Monoblock',
  manzana: 'Manzana',
  casa: 'Casas',
  otro: 'Otro',
};

/** What the operator reads for each category of a ranked result, by category id. */
export const CATEGORY_LABEL: Record<number, string> = {
  0: 'Referencia',
  1: 'Cuadra confirmada',
  2: 'Misma cuadra',
  3: 'Dirección interpolada',
  4: 'Cuadra vecina',
  5: 'Misma calle',
  6: 'La calle existe',
  7: 'Parecido',
};

/** How far a ranked result can be trusted: a catalog record, a Georef estimate, or a mere resemblance. */
export type CategoryTrust = 'verified' | 'georef' | 'similar';

const GEOREF_CATEGORIES = new Set([3, 6]);
const SIMILAR_CATEGORY = 7;
const CONFIRMED_CATEGORY = 1;

export function categoryTrust(category: number): CategoryTrust {
  if (category === SIMILAR_CATEGORY) return 'similar';
  return GEOREF_CATEGORIES.has(category) ? 'georef' : 'verified';
}

/** Where a ranked result comes from. A confirmed block is a catalog record Georef agrees with. */
export function sourceLabel(source: 'catalog' | 'georef', category: number): string {
  if (source === 'georef') return 'Georef';
  return category === CONFIRMED_CATEGORY ? 'Catálogo + Georef' : 'Catálogo';
}

/** Text to look a street up by name when no coordinates are known: its name plus the typed house number. */
export function streetSearchText(nombre: string, number: number | null): string {
  return number === null ? nombre : `${nombre} ${number}`;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude}, ${longitude}`;
}
