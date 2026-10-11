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
    ['pje 38.50 1200', { streetTokens: ['38.50'], number: 1200, crossTokens: null }],
    ['pasaje 34,50 8800', { streetTokens: ['34.50'], number: 8800, crossTokens: null }],
    ['pje 38.50', { streetTokens: ['38.50'], number: null, crossTokens: null }],
    ['38.50', { streetTokens: ['38.50'], number: null, crossTokens: null }],
    ['38,50 1200', { streetTokens: ['38.50'], number: 1200, crossTokens: null }],
    ['pje 169.5 2400', { streetTokens: ['169.5'], number: 2400, crossTokens: null }],
    ['pje publico 98,50 7800', { streetTokens: ['publico', '98.50'], number: 7800, crossTokens: null }],
    ['pje 38.50 y san martin', { streetTokens: ['38.50'], number: null, crossTokens: ['san', 'martin'] }],
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
    ['decimal name with comma', { nombre: 'Pje 34,50 8800', aliases: ['c'] }, { names: [['34.50'], ['c']], blocks: [8800] }],
    [
      'decimal name with dot, same alias',
      { nombre: 'Sobre Pje 169.5 2400', direccion: 'Pje 169.5 2400', aliases: ['Pje 169.5'] },
      { names: [['169.5']], blocks: [2400] },
    ],
    ['decimal name without block', { nombre: 'Pje 173,70' }, { names: [['173.70']], blocks: [] }],
    [
      'decimal alias with dot',
      { nombre: 'Pasaje 98,50 7800', aliases: ['Pje Publico 98.50'] },
      { names: [['98.50'], ['publico', '98.50']], blocks: [7800] },
    ],
    [
      'comma name and dot alias are the same name',
      { nombre: 'Sobre Pje 38,50 8800', aliases: ['Pje 38.50'] },
      { names: [['38.50']], blocks: [8800] },
    ],
    [
      'bare decimal name with trailing comma',
      { nombre: '88,95 8700,', aliases: ['Pje s/n 88,95'] },
      { names: [['88.95'], ['s', 'n', '88.95']], blocks: [8700] },
    ],
    ['decimal name with double block', { nombre: 'Pje 32,50 8300 / 8400' }, { names: [['32.50']], blocks: [8300, 8400] }],
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
    ['34.50', '34.50', 'exact'],
    ['34.50', '36.50', 'none'],
    ['34.50', '34.5', 'none'],
    ['34.50', '34', 'none'],
    ['publico 98.50', '98.50', 'none'],
    ['98.50', 'publico 98.50', 'weak'],
    // initials: match either way, never exact
    ['roque saenz pena', 'r s pena', 'strong'],
    ['r s pena', 'roque saenz pena', 'strong'],
    ['rodriguez', 'm rodriguez', 'strong'],
    ['saenz pena', 'r s pena', 'strong'],
    ['m rodriguez', 'p rodriguez', 'none'],
    // extra candidate tokens
    ['san martin', 'zorrilla san martin', 'weak'],
    ['martin', 'san martin', 'weak'],
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
    ['pje 34,50 8800', 'exact'],
    ['pasaje 34.50', 'exact'],
    ['36,50', 'none'],
    ['34', 'none'],
  ])('query %j against "Pje 34,50 8800" -> %s', (query, expected) => {
    expect(bestStreetGrade(parseAddressQuery(query).streetTokens, catalog.names)).toBe(expected);
  });

  it('grades a comma query against a dot candidate as exact', () => {
    expect(gradeStreetName(parseAddressQuery('34,50').streetTokens, ['34.50'])).toBe('exact');
  });
});

describe('bestStreetGrade and gradeRank', () => {
  it('orders the grades', () => {
    expect((['none', 'weak', 'strong', 'exact'] as const).map(gradeRank)).toEqual([0, 1, 2, 3]);
  });

  it.each<[string, string[], StreetGrade]>([
    ['aguayo', ['segundo', 'f aguayo'], 'strong'],
    ['segundo', ['segundo', 'f aguayo'], 'exact'],
    ['san martin', ['zorrilla san martin', 'san matrin'], 'strong'],
    ['mitre', ['segundo', 'f aguayo'], 'none'],
    ['mitre', [], 'none'],
  ])('%j across %j -> %s', (query, names, expected) => {
    expect(bestStreetGrade(words(query), names.map(words))).toBe(expected);
  });
});

describe.skipIf(!catalogAvailable)('real catalog streets', () => {
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
    const decimalPattern = /\d+[.,]\d+/g;
    const decimalsIn = (text: string) => (text.match(decimalPattern) ?? []).map((d) => d.replace(',', '.'));
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
