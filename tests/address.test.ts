import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bestStreetGrade,
  blockOf,
  gradeRank,
  gradeStreetName,
  haversineMeters,
  parseAddressQuery,
  parseCatalogStreet,
  streetNameTokens,
  streetQueryText,
  type ParsedQuery,
  type StreetGrade,
} from '../src/lib/address';
import type { Reference } from '../src/lib/types';
import { readReferences } from './helpers';

const CATALOG_PATH = path.resolve(import.meta.dirname, '../public/data/references.json');
const catalogAvailable = fs.existsSync(CATALOG_PATH);

function makeRef(overrides: Partial<Reference>): Reference {
  return {
    id: 'test',
    tipo: 'calle',
    barrio: 'Test',
    nombre: 'Sobre Test 100',
    aliases: [],
    latitude: -31.6,
    longitude: -60.7,
    coordRaw: '-31.6,-60.7',
    source: { file: 'test.xlsx', sheet: 'Test', cell: 'A1', row: 1 },
    ...overrides,
  };
}

const words = (text: string) => text.split(' ').filter(Boolean);

describe('streetNameTokens', () => {
  it.each([
    ['SAN MARTIN', ['san', 'martin']],
    ['AV. GRAL. PAZ', ['paz']],
    ['Sobre Pje Neuquén', ['neuquen']],
    ['PJE 38.50', ['38.5']],
    ['Pje 34,50', ['34.5']],
    ['9 DE JULIO', ['9', 'julio']],
    ['', []],
    ['Calle', []],
  ])('"%s" -> %j', (text, expected) => {
    expect(streetNameTokens(text)).toEqual(expected);
  });

  it('keeps a trailing number as part of the name: it extracts no house number', () => {
    expect(streetNameTokens('San Martin 2500')).toEqual(['san', 'martin', '2500']);
    expect(streetNameTokens('CALLE 12')).toEqual(['12']);
  });

  it('gives an official name the spelling the query parser produces', () => {
    const query = parseAddressQuery('pje 38,5 1200');
    expect(gradeStreetName(query.streetTokens, streetNameTokens('PJE 38.50'))).toBe('exact');
    expect(gradeStreetName(parseAddressQuery('san martin 2500').streetTokens, streetNameTokens('SAN MARTIN'))).toBe(
      'exact',
    );
  });
});

describe('streetQueryText', () => {
  it.each([
    ['San Martín 2500', 'san martin'],
    ['9 de julio 2500', '9 de julio'],
    ['av. freyre 1500', 'av freyre'],
    ['san martin y juan de garay', 'san martin'],
    ['pje 38,50 1200', 'pje 38.5'],
    ['', ''],
    ['   ', ''],
    ['san martin', 'san martin'],
    ['25 de mayo', '25 de mayo'],
    ['Bv. Gálvez 1500 esq. Güemes', 'bv galvez'],
    ['rivadavia entre mitre y belgrano', 'rivadavia'],
    ['Entre Ríos 300', 'entre rios'],
    ['calle 12', 'calle 12'],
    ['sobre  la  rioja', 'sobre la rioja'],
  ])('"%s" -> "%s"', (text, expected) => {
    expect(streetQueryText(text)).toBe(expected);
  });

  it('keeps the words the parsed street tokens drop, and drops the same number', () => {
    const text = 'Av. 9 de Julio 2500';
    expect(streetQueryText(text)).toBe('av 9 de julio');
    expect(parseAddressQuery(text)).toEqual({ streetTokens: ['9', 'julio'], number: 2500, crossTokens: null });
  });
});

describe('blockOf', () => {
  it.each([
    [8540, 8500],
    [8500, 8500],
    [8599, 8500],
    [99, 0],
    [0, 0],
    [10500, 10500],
  ])('%d -> %d', (n, expected) => {
    expect(blockOf(n)).toBe(expected);
  });
});

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    const p = { latitude: -31.63, longitude: -60.7 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('measures one degree of latitude as about 111.2 km', () => {
    const d = haversineMeters({ latitude: -31, longitude: -60.7 }, { latitude: -32, longitude: -60.7 });
    expect(Math.round(d)).toBe(111195);
  });

  it('is symmetric and shrinks longitude degrees away from the equator', () => {
    const a = { latitude: -31.63, longitude: -60.7 };
    const b = { latitude: -31.63, longitude: -60.71 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
    expect(haversineMeters(a, b)).toBeGreaterThan(900);
    expect(haversineMeters(a, b)).toBeLessThan(1000);
  });
});

describe('parseAddressQuery', () => {
  const cases: [string, ParsedQuery][] = [
    ['san martin 2500', { streetTokens: ['san', 'martin'], number: 2500, crossTokens: null }],
    ['San Martín 2500', { streetTokens: ['san', 'martin'], number: 2500, crossTokens: null }],
    ['av. freyre 1500', { streetTokens: ['freyre'], number: 1500, crossTokens: null }],
    ['Avenida Freyre 1500', { streetTokens: ['freyre'], number: 1500, crossTokens: null }],
    ['9 de julio 2500', { streetTokens: ['9', 'julio'], number: 2500, crossTokens: null }],
    ['25 de mayo', { streetTokens: ['25', 'mayo'], number: null, crossTokens: null }],
    ['calle 25 de mayo', { streetTokens: ['25', 'mayo'], number: null, crossTokens: null }],
    ['comisaria 25', { streetTokens: ['comisaria'], number: 25, crossTokens: null }],
    ['san martin', { streetTokens: ['san', 'martin'], number: null, crossTokens: null }],
    ['san martin y juan de garay', { streetTokens: ['san', 'martin'], number: null, crossTokens: ['juan', 'garay'] }],
    ['san martin esquina garay', { streetTokens: ['san', 'martin'], number: null, crossTokens: ['garay'] }],
    ['san martin 2500 esq garay', { streetTokens: ['san', 'martin'], number: 2500, crossTokens: ['garay'] }],
    ['san martin 2500 y garay', { streetTokens: ['san', 'martin'], number: 2500, crossTokens: ['garay'] }],
    ['rivadavia entre mitre y belgrano', { streetTokens: ['rivadavia'], number: null, crossTokens: null }],
    ['rivadavia 1500 entre mitre y belgrano', { streetTokens: ['rivadavia'], number: 1500, crossTokens: null }],
    ['entre rios 2500', { streetTokens: ['entre', 'rios'], number: 2500, crossTokens: null }],
    ['san martin 123456', { streetTokens: ['san', 'martin', '123456'], number: null, crossTokens: null }],
    ['', { streetTokens: [], number: null, crossTokens: null }],
    ['   ', { streetTokens: [], number: null, crossTokens: null }],
    ['2500', { streetTokens: ['2500'], number: null, crossTokens: null }],
    // a decimal passage name is one token, never a house number
    ['pje 38.50 1200', { streetTokens: ['38.5'], number: 1200, crossTokens: null }],
    ['pasaje 34,50 8800', { streetTokens: ['34.5'], number: 8800, crossTokens: null }],
    ['pje 38.50', { streetTokens: ['38.5'], number: null, crossTokens: null }],
    ['38.50', { streetTokens: ['38.5'], number: null, crossTokens: null }],
    ['38,50 1200', { streetTokens: ['38.5'], number: 1200, crossTokens: null }],
    ['pje 169.5 2400', { streetTokens: ['169.5'], number: 2400, crossTokens: null }],
    ['pje publico 98,50 7800', { streetTokens: ['publico', '98.5'], number: 7800, crossTokens: null }],
    ['pje 38.50 y san martin', { streetTokens: ['38.5'], number: null, crossTokens: ['san', 'martin'] }],
    // trailing zeros of the fraction are dropped, one fractional digit is always kept
    ['pje 40,50', { streetTokens: ['40.5'], number: null, crossTokens: null }],
    ['pje 40,5', { streetTokens: ['40.5'], number: null, crossTokens: null }],
    ['pje 173,70', { streetTokens: ['173.7'], number: null, crossTokens: null }],
    ['pje 12.00 300', { streetTokens: ['12.0'], number: 300, crossTokens: null }],
    ['pje 10.05 300', { streetTokens: ['10.05'], number: 300, crossTokens: null }],
    // a via-type word counts as the street word before a house number, when a name is left
    ['pje 12 3400', { streetTokens: ['12'], number: 3400, crossTokens: null }],
    ['calle 12', { streetTokens: ['12'], number: null, crossTokens: null }],
    // punctuation that is not a decimal still splits
    ['san martin 2500, santa fe', { streetTokens: ['san', 'martin', 'santa', 'fe'], number: 2500, crossTokens: null }],
    ['san martin 2500.', { streetTokens: ['san', 'martin'], number: 2500, crossTokens: null }],
  ];

  it.each(cases)('%j', (text, expected) => {
    expect(parseAddressQuery(text)).toEqual(expected);
  });

  it('reads a trailing unit number literally (known limitation)', () => {
    // Known literal reading, pinned so a later change is deliberate: the house number is the LAST
    // 1-5 digit token, so the unit (3) wins and both "2500" and "depto" stay in the street name.
    expect(parseAddressQuery('san martin 2500 depto 3')).toEqual({
      streetTokens: ['san', 'martin', '2500', 'depto'],
      number: 3,
      crossTokens: null,
    });
  });
});

describe('parseCatalogStreet', () => {
  const cases: [string, Partial<Reference>, { names: string[][]; blocks: number[] }][] = [
    [
      'popular name plus identical alias',
      { nombre: 'Sobre San Martin 8500', aliases: ['San Martin'] },
      { names: [['san', 'martin']], blocks: [8500] },
    ],
    ['mixed-case "sobre" and via type', { nombre: 'SoBre Pje Neuquen 3100' }, { names: [['neuquen']], blocks: [3100] }],
    ['trailing punctuation', { nombre: 'Sobre M Rodriguez 6500,' }, { names: [['m', 'rodriguez']], blocks: [6500] }],
    [
      'initials plus full-name alias',
      { nombre: 'Sobre R S Peña 10500', aliases: ['Roque Saenz Peña'] },
      {
        names: [
          ['r', 's', 'pena'],
          ['roque', 'saenz', 'pena'],
        ],
        blocks: [10500],
      },
    ],
    [
      'alias carrying its own number',
      { nombre: 'Sobre Cjon Roca 2300', aliases: ['Cjon Roca 2300'] },
      { names: [['roca']], blocks: [2300] },
    ],
    [
      'alias that differs from the popular name',
      { nombre: 'Sobre Pje Segundo 4800', aliases: ['F Aguayo'] },
      { names: [['segundo'], ['f', 'aguayo']], blocks: [4800] },
    ],
    [
      'direccion wins over nombre',
      { nombre: 'Sobre Algo 100', direccion: 'Ayacucho 5840' },
      { names: [['ayacucho']], blocks: [5800] },
    ],
    ['numbered street name', { nombre: 'Sobre 9 de Julio 2500' }, { names: [['9', 'julio']], blocks: [2500] }],
    ['street without number', { nombre: 'Falcon', aliases: ['Falcon'] }, { names: [['falcon']], blocks: [] }],
    ['decimal name with comma', { nombre: 'Pje 34,50 8800', aliases: ['c'] }, { names: [['34.5'], ['c']], blocks: [8800] }],
    [
      'decimal name with dot, same alias',
      { nombre: 'Sobre Pje 169.5 2400', direccion: 'Pje 169.5 2400', aliases: ['Pje 169.5'] },
      { names: [['169.5']], blocks: [2400] },
    ],
    ['decimal name without block', { nombre: 'Pje 173,70' }, { names: [['173.7']], blocks: [] }],
    [
      'decimal alias with dot',
      { nombre: 'Pasaje 98,50 7800', aliases: ['Pje Publico 98.50'] },
      { names: [['98.5'], ['publico', '98.5']], blocks: [7800] },
    ],
    [
      'comma name and dot alias are the same name',
      { nombre: 'Sobre Pje 38,50 8800', aliases: ['Pje 38.50'] },
      { names: [['38.5']], blocks: [8800] },
    ],
    [
      'names that differ only by decimal precision are one name',
      { nombre: 'Sobre Pje 40,50 8800', aliases: ['Pje 40,5'] },
      { names: [['40.5']], blocks: [8800] },
    ],
    [
      'short main name, padded alias',
      { nombre: 'Pje 40,5 8800', aliases: ['Pje 40.500', 'Pje Publico 40,50'] },
      { names: [['40.5'], ['publico', '40.5']], blocks: [8800] },
    ],
    [
      'bare decimal name with trailing comma',
      { nombre: '88,95 8700,', aliases: ['Pje s/n 88,95'] },
      { names: [['88.95'], ['s', 'n', '88.95']], blocks: [8700] },
    ],
    ['decimal name with double block', { nombre: 'Pje 32,50 8300 / 8400' }, { names: [['32.5']], blocks: [8300, 8400] }],
    ['double block', { nombre: 'Diez De Andino 6600 / 6700' }, { names: [['diez', 'andino']], blocks: [6600, 6700] }],
    ['double block, uneven spacing', { nombre: 'Leuman 2100 /2200' }, { names: [['leuman']], blocks: [2100, 2200] }],
    ['double block, no spacing', { nombre: 'Millan Medina 4200/4300' }, { names: [['millan', 'medina']], blocks: [4200, 4300] }],
    ['double block, descending', { nombre: 'Roca 6700 / 6600' }, { names: [['roca']], blocks: [6600, 6700] }],
    ['double block in the same hundred', { nombre: 'Roca 6610 / 6690' }, { names: [['roca']], blocks: [6600] }],
    [
      'alias with a double block',
      { nombre: 'Sobre Roca 6600 / 6700', aliases: ['Julio A Roca 6600 / 6700'] },
      { names: [['roca'], ['julio', 'a', 'roca']], blocks: [6600, 6700] },
    ],
    [
      'slash alias is two names',
      { nombre: 'L Leiva 9600', aliases: ['Luciano Leiva / Bernardo de irigoyen'] },
      {
        names: [
          ['l', 'leiva'],
          ['luciano', 'leiva'],
          ['bernardo', 'irigoyen'],
        ],
        blocks: [9600],
      },
    ],
    ['"S/N" is not a name split', { nombre: 'Pje S/N 5800', aliases: ['Pje s/n'] }, { names: [['s', 'n']], blocks: [5800] }],
  ];

  it.each(cases)('%s', (_label, overrides, expected) => {
    expect(parseCatalogStreet(makeRef(overrides))).toEqual(expected);
  });

  it('returns null for a record that is not a street', () => {
    expect(parseCatalogStreet(makeRef({ tipo: 'referencia', nombre: 'Comisaria 25' }))).toBeNull();
  });
});

describe('gradeStreetName', () => {
  const cases: [string, string, StreetGrade][] = [
    // exact
    ['san martin', 'san martin', 'exact'],
    ['r s pena', 'r s pena', 'exact'],
    // typos within tolerance
    ['san matrin', 'san martin', 'strong'],
    ['rivadavai', 'rivadavia', 'strong'],
    ['belgarno', 'belgrano', 'strong'],
    ['rivadvia', 'rivadavia', 'strong'],
    // token order does not matter
    ['martin san', 'san martin', 'strong'],
    // too many edits for the token length
    ['mirte', 'matheu', 'none'],
    ['san maxxin', 'san martin', 'none'],
    // short tokens are exact only
    ['ros', 'roa', 'none'],
    ['sam martin', 'san martin', 'none'],
    // digits are exact only
    ['9 julio', '8 julio', 'none'],
    ['9 julio', '9 julio', 'exact'],
    ['1500', '1600', 'none'],
    // decimal names are exact only
    ['34.5', '34.5', 'exact'],
    ['34.5', '36.5', 'none'],
    ['34.5', '34', 'none'],
    ['publico 98.5', '98.5', 'none'],
    ['98.5', 'publico 98.5', 'tail'],
    // initials: match either way, never exact
    ['roque saenz pena', 'r s pena', 'strong'],
    ['r s pena', 'roque saenz pena', 'strong'],
    ['rodriguez', 'm rodriguez', 'strong'],
    ['saenz pena', 'r s pena', 'strong'],
    ['m rodriguez', 'p rodriguez', 'none'],
    ['m rodriguez', 'monsenor rodriguez', 'strong'],
    // an initial only assists: some full-word query token must match by the normal rules
    ['r', 'rivadavia', 'none'],
    ['r s', 'roque saenz pena', 'none'],
    ['s', 'san martin', 'none'],
    ['r', 'r', 'none'],
    ['s n', 's n', 'none'],
    ['roque', 'r', 'none'],
    ['roque s', 'r saenz', 'none'],
    ['r pena', 'roque pena', 'strong'],
    ['9', '9 julio', 'weak'],
    // extra candidate tokens before the ones typed: the end of the name
    ['san martin', 'zorrilla san martin', 'tail'],
    ['san martin', 'jose san martin', 'tail'],
    ['martin', 'san martin', 'tail'],
    ['grierson', 'cecilia grierson', 'tail'],
    ['belgrano', 'crucero belgrano', 'tail'],
    ['cecilia grierson', 'cecilia grierson', 'exact'],
    ['julio', '9 julio', 'tail'],
    // a typo within tolerance still names the end (the shorter token sets the budget)
    ['griersno', 'cecilia grierson', 'tail'],
    ['san matrin', 'zorrilla san martin', 'tail'],
    ['grieros', 'cecilia grierson', 'none'],
    ['8 julio', 'avenida 9 julio', 'none'],
    // a prefix is as-you-type text, it does not name the end of the street
    ['griers', 'cecilia grierson', 'weak'],
    ['san mart', 'zorrilla san martin', 'weak'],
    ['gr', 'cecilia grierson', 'none'],
    // extra candidate tokens after or between the ones typed, or another order
    ['san', 'san martin', 'weak'],
    ['san martin', 'san martin norte', 'weak'],
    ['cecilia', 'cecilia grierson', 'weak'],
    ['zorrilla martin', 'zorrilla san martin', 'weak'],
    ['martin san', 'zorrilla san martin', 'weak'],
    // an initial only assists the end of a name too
    ['s martin', 'zorrilla san martin', 'tail'],
    ['m', 'san martin', 'none'],
    ['s m', 'jose san martin', 'none'],
    // only initials before the tokens typed: still the whole name
    ['san martin', 'j san martin', 'strong'],
    // last query token as a prefix
    ['san mart', 'san martin', 'weak'],
    ['riv', 'rivadavia', 'weak'],
    ['ri', 'rivadavia', 'none'],
    ['mart san', 'san martin', 'none'],
    // query tokens left unmatched
    ['san martin norte', 'san martin', 'none'],
    ['mitre', 'belgrano', 'none'],
    ['', 'san martin', 'none'],
    ['san martin', '', 'none'],
  ];

  it.each(cases)('%j vs %j -> %s', (query, candidate, expected) => {
    expect(gradeStreetName(words(query), words(candidate))).toBe(expected);
  });
});

describe('decimal names across query and catalog', () => {
  const catalog = parseCatalogStreet(makeRef({ nombre: 'Pje 34,50 8800' }))!;

  it.each<[string, StreetGrade]>([
    ['34,50', 'exact'],
    ['34.50', 'exact'],
    ['34,5', 'exact'],
    ['pje 34.500', 'exact'],
    ['pje 34,50 8800', 'exact'],
    ['pasaje 34.50', 'exact'],
    ['36,50', 'none'],
    ['34', 'none'],
  ])('query %j against "Pje 34,50 8800" -> %s', (query, expected) => {
    expect(bestStreetGrade(parseAddressQuery(query).streetTokens, catalog.names)).toBe(expected);
  });

  it('grades a comma query against a dot candidate as exact', () => {
    expect(gradeStreetName(parseAddressQuery('34,50').streetTokens, ['34.5'])).toBe('exact');
  });
});

describe('titles', () => {
  const TITLES = [
    'dr', 'dra', 'gral', 'general', 'cnel', 'coronel', 'pte', 'presidente', 'ing', 'ingeniero', 'mons', 'monseñor',
    'pbro', 'fray', 'tte', 'teniente', 'sgto', 'sargento', 'cap', 'capitan', 'almte', 'almirante', 'brig', 'brigadier',
    'prof', 'profesor', 'don', 'doña',
  ];

  it.each(TITLES)('drops "%s" from a street name', (title) => {
    expect(streetNameTokens(`${title} Lopez`)).toEqual(['lopez']);
    expect(streetNameTokens(`${title.toUpperCase()}. LOPEZ`)).toEqual(['lopez']);
    expect(parseAddressQuery(`${title} lopez 1200`)).toEqual({ streetTokens: ['lopez'], number: 1200, crossTokens: null });
  });

  it.each([
    ['DRA CECILIA GRIERSON', ['cecilia', 'grierson']],
    ['AV. PTE. PERON', ['peron']],
    ['BRIG GRAL ESTANISLAO LOPEZ', ['estanislao', 'lopez']],
    ['Monseñor Zazpe', ['zazpe']],
    ['Capitán Bermúdez', ['bermudez']],
    ['Doña Petrona', ['petrona']],
    ['Juan Domingo Peron Pte', ['juan', 'domingo', 'peron']],
    // words that only look like a title are kept
    ['Santa Fe', ['santa', 'fe']],
    ['Generoso Donato', ['generoso', 'donato']],
  ])('"%s" -> %j', (text, expected) => {
    expect(streetNameTokens(text)).toEqual(expected);
  });

  it.each([
    ['Coronel', ['coronel']],
    ['General', ['general']],
    ['Av. General', ['general']],
    ['Sobre Calle Coronel', ['coronel']],
    ['Tte Gral', ['tte', 'gral']],
    // via-type words and stopwords are dropped even then
    ['Calle', []],
    ['de la', []],
  ])('keeps the titles of "%s", a name made of nothing else -> %j', (text, expected) => {
    expect(streetNameTokens(text)).toEqual(expected);
  });

  it('keeps a street called by a title matchable, with its block', () => {
    expect(parseCatalogStreet(makeRef({ nombre: 'Sobre Coronel 4500' }))).toEqual({ names: [['coronel']], blocks: [4500] });
    expect(parseAddressQuery('coronel 4550')).toEqual({ streetTokens: ['coronel'], number: 4550, crossTokens: null });
    expect(parseAddressQuery('general')).toEqual({ streetTokens: ['general'], number: null, crossTokens: null });
  });

  it('drops titles from the catalog name and from every alias', () => {
    expect(parseCatalogStreet(makeRef({ nombre: 'Sobre Gral Paz 6500', aliases: ['Av. General Paz', 'Jose Maria Paz'] }))).toEqual({
      names: [['paz'], ['jose', 'maria', 'paz']],
      blocks: [6500],
    });
    expect(parseCatalogStreet(makeRef({ nombre: 'Dr Zavalla 2300 / 2400', aliases: ['Don Bosco / Pbro Menvielle'] }))).toEqual({
      names: [['zavalla'], ['bosco'], ['menvielle']],
      blocks: [2300, 2400],
    });
  });

  it('drops titles from both streets of an intersection', () => {
    expect(parseAddressQuery('gral lopez 2500 esq dr zavalla')).toEqual({
      streetTokens: ['lopez'],
      number: 2500,
      crossTokens: ['zavalla'],
    });
  });

  it('keeps titles in the text sent to the street lookup', () => {
    expect(streetQueryText('Dra. Cecilia Grierson 500')).toBe('dra cecilia grierson');
    expect(streetQueryText('gral lopez 2500 esq dr zavalla')).toBe('gral lopez');
    expect(streetQueryText('coronel')).toBe('coronel');
  });

  it.each<[string, string, StreetGrade]>([
    ['grierson', 'DRA CECILIA GRIERSON', 'tail'],
    ['cecilia grierson', 'DRA CECILIA GRIERSON', 'exact'],
    ['dra cecilia grierson', 'DRA CECILIA GRIERSON', 'exact'],
    ['dr grierson', 'DRA CECILIA GRIERSON', 'tail'],
    ['griers', 'DRA CECILIA GRIERSON', 'weak'],
    ['cecilia', 'DRA CECILIA GRIERSON', 'weak'],
    ['gral paz', 'AV GENERAL PAZ', 'exact'],
    ['paz', 'AV GRAL JOSE MARIA PAZ', 'tail'],
    ['san martin', 'GRAL JOSE DE SAN MARTIN', 'tail'],
    ['san martin', 'ZORRILLA DE SAN MARTIN', 'tail'],
    ['san martin', 'GRAL J DE SAN MARTIN', 'strong'],
    ['san martin', 'GRAL SAN MARTIN', 'exact'],
    ['coronel', 'CORONEL', 'exact'],
    ['coronel', 'CORONEL DORREGO', 'none'],
  ])('typed %j against the official name %j -> %s', (typed, official, expected) => {
    expect(gradeStreetName(parseAddressQuery(typed).streetTokens, streetNameTokens(official))).toBe(expected);
  });
});

describe('bestStreetGrade and gradeRank', () => {
  it('orders the grades', () => {
    expect((['none', 'weak', 'tail', 'strong', 'exact'] as const).map(gradeRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each<[string, string[], StreetGrade]>([
    ['aguayo', ['segundo', 'f aguayo'], 'strong'],
    ['segundo', ['segundo', 'f aguayo'], 'exact'],
    ['san martin', ['zorrilla san martin', 'san matrin'], 'strong'],
    ['mitre', ['segundo', 'f aguayo'], 'none'],
    ['mitre', [], 'none'],
    ['san martin', ['san martin norte', 'zorrilla san martin'], 'tail'],
    ['san martin', ['zorrilla san martin', 'j san martin'], 'strong'],
    ['san martin', ['zorrilla san martin', 'san martin'], 'exact'],
  ])('%j across %j -> %s', (query, names, expected) => {
    expect(bestStreetGrade(words(query), names.map(words))).toBe(expected);
  });
});

describe.skipIf(!catalogAvailable)('real catalog streets', () => {
  const decimalPattern = /\d+[.,]\d+/g;
  /** Independent statement of the rule: dot separator, no trailing zeros, one fractional digit kept. */
  const canonicalDecimal = (decimal: string) => {
    const [whole, fraction] = decimal.replace(',', '.').split('.');
    return `${whole}.${fraction.replace(/0+$/, '') || '0'}`;
  };

  it('writes every decimal name in its canonical form, in names and aliases alike', () => {
    const textsOf = (ref: Reference) => [ref.direccion ?? ref.nombre, ...ref.aliases];
    const decimalStreets = readReferences().filter(
      (ref) => ref.tipo === 'calle' && textsOf(ref).some((text) => text.match(decimalPattern)),
    );
    expect(decimalStreets.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const ref of decimalStreets) {
      const parsed = parseCatalogStreet(ref)!;
      const label = textsOf(ref).join(' | ');
      for (const text of textsOf(ref)) {
        for (const raw of text.match(decimalPattern) ?? []) {
          const canonical = canonicalDecimal(raw);
          if (!parsed.names.some((name) => name.includes(canonical))) problems.push(`${label}: no name holds ${canonical}`);
        }
      }
      for (const token of parsed.names.flat()) {
        if (/^\d+\.\d+$/.test(token) && token !== canonicalDecimal(token)) problems.push(`${label}: ${token} is not canonical`);
      }
      const keys = parsed.names.map((name) => name.join(' '));
      if (new Set(keys).size !== keys.length) problems.push(`${label}: repeated name`);
    }
    expect(problems).toEqual([]);
  });

  it('parses every street record, at least 95% of them with a block', () => {
    const streets = readReferences().filter((ref) => ref.tipo === 'calle');
    expect(streets.length).toBeGreaterThan(0);

    const unnamed: string[] = [];
    const withoutBlock: string[] = [];
    for (const ref of streets) {
      const parsed = parseCatalogStreet(ref);
      if (!parsed || parsed.names.length === 0 || parsed.names.some((name) => name.length === 0)) {
        unnamed.push(ref.nombre);
        continue;
      }
      if (parsed.blocks.length === 0) withoutBlock.push(ref.nombre);
    }

    expect(unnamed).toEqual([]);
    const ratio = (streets.length - withoutBlock.length) / streets.length;
    expect(ratio, `streets without block: ${withoutBlock.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
  });

  it('reads every decimal passage name whole and never takes a block from it', () => {
    const decimalsIn = (text: string) => (text.match(decimalPattern) ?? []).map(canonicalDecimal);
    const decimalStreets = readReferences().filter(
      (ref) => ref.tipo === 'calle' && decimalsIn(`${ref.nombre} ${ref.direccion ?? ''}`).length > 0,
    );
    expect(decimalStreets.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const ref of decimalStreets) {
      const parsed = parseCatalogStreet(ref)!;
      const text = ref.direccion ?? ref.nombre;
      for (const decimal of decimalsIn(text)) {
        if (!parsed.names.some((name) => name.includes(decimal))) problems.push(`${text}: no name holds ${decimal}`);
      }
      // Blocks may only come from the whole numbers left once the decimals are taken out.
      const wholeNumbers = text.replace(decimalPattern, ' ').match(/\d+/g) ?? [];
      const allowed = new Set(wholeNumbers.map((n) => blockOf(Number(n))));
      if (parsed.blocks.length !== allowed.size || parsed.blocks.some((block) => !allowed.has(block))) {
        problems.push(`${text}: blocks [${parsed.blocks.join(', ')}]`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps every street record named once titles are ignored', () => {
    const TITLE =
      /^(dr|dra|gral|general|cnel|coronel|pte|presidente|ing|ingeniero|mons|monsenor|pbro|fray|tte|teniente|sgto|sargento|cap|capitan|almte|almirante|brig|brigadier|prof|profesor|don|dona)$/;
    const plain = (text: string) =>
      text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const streets = readReferences().filter((ref) => ref.tipo === 'calle');

    const withTitle: string[] = [];
    const unnamed: string[] = [];
    for (const ref of streets) {
      const parsed = parseCatalogStreet(ref)!;
      if (parsed.names.length === 0 || parsed.names.some((name) => name.length === 0)) unnamed.push(ref.nombre);
      const texts = [ref.direccion ?? ref.nombre, ...ref.aliases];
      if (texts.some((text) => plain(text).some((word) => TITLE.test(word)))) {
        withTitle.push(`${texts.join(' | ')} -> ${parsed.names.map((name) => name.join(' ')).join(' | ')}`);
      }
    }
    // Reported, not asserted: the count belongs to the data, which the owner edits.
    console.info(`[T6] street records holding a title word: ${withTitle.length} of ${streets.length}`);
    for (const line of withTitle.slice(0, 10)) console.info(`[T6]   ${line}`);

    expect(unnamed).toEqual([]);
  });

  it('gives two sorted blocks to every "N / M" record', () => {
    const doubles = readReferences().filter(
      (ref) => ref.tipo === 'calle' && /\d{1,5}\s*\/\s*\d{1,5}\s*$/.test(ref.direccion ?? ref.nombre),
    );
    expect(doubles.length).toBeGreaterThan(0);
    for (const ref of doubles) {
      const parsed = parseCatalogStreet(ref)!;
      expect(parsed.blocks, ref.nombre).toHaveLength(2);
      expect(parsed.blocks[0], ref.nombre).toBeLessThan(parsed.blocks[1]);
    }
  });
});
