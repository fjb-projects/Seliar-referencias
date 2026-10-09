/**
 * Relevance gold set. Every expectation points at a REAL record of the workbook
 * (sheet + name as written in the source), never at invented data.
 */
export type GoldCategory = 'exacta' | 'incompleta' | 'sin-tildes' | 'typo' | 'repetida' | 'sin-resultados';

export interface GoldExpectation {
  sheet: string;
  nombre: string;
  /** Needed when a sheet holds several complexes whose items share a name ("Torre 2"). */
  barrio?: string;
}

export interface GoldCase {
  category: GoldCategory;
  query: string;
  /** Every expectation must appear within the first `topN` results. Empty list = must return nothing. */
  expect: GoldExpectation[];
  topN: number;
}

const e = (sheet: string, nombre: string, barrio?: string): GoldExpectation => ({ sheet, nombre, barrio });

export const matchesExpectation = (
  ref: { barrio: string; nombre: string; source: { sheet: string } },
  want: GoldExpectation,
): boolean =>
  ref.source.sheet === want.sheet && ref.nombre === want.nombre && (want.barrio === undefined || ref.barrio === want.barrio);

export const GOLD: GoldCase[] = [
  // Exact names
  { category: 'exacta', query: 'Escuela Santa Rita De Casia', expect: [e('Santa Rita 1', 'Escuela Santa Rita De Casia')], topN: 1 },
  { category: 'exacta', query: 'Plaza Gran Malvina', expect: [e('Favaloro', 'Plaza Gran Malvina')], topN: 1 },
  { category: 'exacta', query: 'Complejo La Ola Santafecinas', expect: [e('Favaloro', 'Complejo La Ola Santafecinas')], topN: 1 },
  { category: 'exacta', query: 'Escuela Educacion Manual Vergara', expect: [e('El Pozo', 'Escuela Educacion Manual Vergara')], topN: 1 },
  { category: 'exacta', query: 'Colegio sagrado Corazon', expect: [e('La florida', 'Colegio sagrado Corazon')], topN: 1 },
  { category: 'exacta', query: 'Centro de Salud Dorrego', expect: [e('Los Cipreses', 'Centro de Salud Dorrego')], topN: 1 },
  { category: 'exacta', query: 'Escuela Juan de Garay', expect: [e('Las Flores 3', 'Escuela Juan de Garay')], topN: 1 },
  { category: 'exacta', query: 'Av Peñaloza 7700', expect: [e('Las Flores II', 'Av Peñaloza 7700')], topN: 1 },
  // Incomplete / prefixes while typing
  { category: 'incompleta', query: 'gran malvina', expect: [e('Favaloro', 'Plaza Gran Malvina')], topN: 3 },
  { category: 'incompleta', query: 'manual vergara', expect: [e('El Pozo', 'Escuela Educacion Manual Vergara')], topN: 3 },
  { category: 'incompleta', query: 'ola santafecinas', expect: [e('Favaloro', 'Complejo La Ola Santafecinas')], topN: 3 },
  { category: 'incompleta', query: 'sagrado corazon', expect: [e('La florida', 'Colegio sagrado Corazon')], topN: 3 },
  { category: 'incompleta', query: 'parroquia rita', expect: [e('Santa Rita 1', 'Parroquia Santa Rita')], topN: 3 },
  { category: 'incompleta', query: 'salud dorrego', expect: [e('Los Cipreses', 'Centro de Salud Dorrego')], topN: 3 },
  {
    category: 'incompleta',
    query: 'villa olim',
    expect: [e('Esmeralda Este Edificios', 'Villa Olimpica'), e('Los Cipreses', 'Complejo Villa Olimpica')],
    topN: 5,
  },
  // Without accents
  { category: 'sin-tildes', query: 'av penaloza 7700', expect: [e('Las Flores II', 'Av Peñaloza 7700')], topN: 1 },
  { category: 'sin-tildes', query: 'penaloza 8700', expect: [e('El Vergel', 'Peñaloza 8700')], topN: 3 },
  // Typos
  { category: 'typo', query: 'Parroquia Santa Rtia', expect: [e('Santa Rita 1', 'Parroquia Santa Rita')], topN: 3 },
  { category: 'typo', query: 'centro de salud dorego', expect: [e('Los Cipreses', 'Centro de Salud Dorrego')], topN: 3 },
  { category: 'typo', query: 'plaza gran malvnia', expect: [e('Favaloro', 'Plaza Gran Malvina')], topN: 3 },
  { category: 'typo', query: 'escula juan de garay', expect: [e('Las Flores 3', 'Escuela Juan de Garay')], topN: 3 },
  { category: 'typo', query: 'colegio sagrado corazn', expect: [e('La florida', 'Colegio sagrado Corazon')], topN: 3 },
  // Same name in different barrios: all of them must be offered as alternatives
  { category: 'repetida', query: 'utn', expect: [e('Pte Peron', 'UTN'), e('Villa Setubal', 'UTN')], topN: 5 },
  {
    category: 'repetida',
    query: 'antena alta',
    expect: [
      e('Container y quinchitos', 'Antena Alta al sur'),
      e('Los Cipreses', 'Antena Alta al norte'),
      e('Nueva Esperanza Este', 'Antena Alta Sarmiento 8700'),
    ],
    topN: 5,
  },
  {
    category: 'repetida',
    query: 'comisaria',
    expect: [e('Centenario', 'Comisaria'), e('El Pozo', 'Comisaria 25'), e('Las Flores II', 'Comisaria 3ro')],
    topN: 5,
  },
  { category: 'repetida', query: 'torre 1 el pozo', expect: [e('El Pozo', 'Torre 1')], topN: 1 },
  { category: 'repetida', query: 'zavalla 10300', expect: [e('Favaloro', 'Sobre Zavalla 10300')], topN: 3 },
  // Second workbook (Torres similares.xlsx): same engine, same rules
  { category: 'exacta', query: 'Estacion Shell', expect: [e('Marcial Candiotti 2600', 'Estacion Shell')], topN: 1 },
  { category: 'exacta', query: 'Pollos San Andres', expect: [e('Marcial Candiotti 2600', 'Pollos San Andres')], topN: 1 },
  { category: 'exacta', query: 'garden inn torre 2', expect: [e('Torres en el puerto', 'Torre 2', 'TORRES GARDEN INN')], topN: 1 },
  { category: 'incompleta', query: 'corpore power', expect: [e('Torres en el puerto', 'Torre 1', 'TORRES CORPORE POWER'), e('Torres en el puerto', 'Torre 2', 'TORRES CORPORE POWER')], topN: 5 },
  { category: 'incompleta', query: 'pedro cente', expect: [e('Pedro centeno 2100', 'Torre 1'), e('Pedro centeno 2100', 'Torre 2')], topN: 5 },
  { category: 'sin-tildes', query: 'rosaura schweizer', expect: [e('Torres en el puerto', 'Torre', 'TORRE RIO ARRIBA')], topN: 3 },
  { category: 'typo', query: 'estacon shell', expect: [e('Marcial Candiotti 2600', 'Estacion Shell')], topN: 3 },
  { category: 'repetida', query: 'lavalle torre 1', expect: [e('Lavalle 5000', 'Torre 1')], topN: 1 },
  { category: 'repetida', query: 'amarras center torre 4', expect: [e('Torres en el puerto', 'Torre 4', 'TORRES AMARRAS CENTER')], topN: 1 },
  // No match
  { category: 'sin-resultados', query: 'zzzzqx', expect: [], topN: 0 },
  { category: 'sin-resultados', query: 'xqwvkj 9999', expect: [], topN: 0 },
];
