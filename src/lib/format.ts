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

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude}, ${longitude}`;
}
