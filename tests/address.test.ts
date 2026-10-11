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
  ];

  it.each(cases)('%j', (text, expected) => {
    expect(parseAddressQuery(text)).toEqual(expected);
  });
});

describe('parseCatalogStreet', () => {
  const cases: [string, Partial<Reference>, { names: string[][]; block: number | null }][] = [
    [
      'popular name plus identical alias',
      { nombre: 'Sobre San Martin 8500', aliases: ['San Martin'] },
      { names: [['san', 'martin']], block: 8500 },
    ],
    ['mixed-case "sobre" and via type', { nombre: 'SoBre Pje Neuquen 3100' }, { names: [['neuquen']], block: 3100 }],
    ['trailing punctuation', { nombre: 'Sobre M Rodriguez 6500,' }, { names: [['m', 'rodriguez']], block: 6500 }],
    [
      'initials plus full-name alias',
      { nombre: 'Sobre R S Peña 10500', aliases: ['Roque Saenz Peña'] },
      {
        names: [
          ['r', 's', 'pena'],
          ['roque', 'saenz', 'pena'],
        ],
        block: 10500,
      },
    ],
    [
      'alias carrying its own number',
      { nombre: 'Sobre Cjon Roca 2300', aliases: ['Cjon Roca 2300'] },
      { names: [['roca']], block: 2300 },
    ],
    [
      'alias that differs from the popular name',
      { nombre: 'Sobre Pje Segundo 4800', aliases: ['F Aguayo'] },
      { names: [['segundo'], ['f', 'aguayo']], block: 4800 },
    ],
    [
      'direccion wins over nombre',
      { nombre: 'Sobre Algo 100', direccion: 'Ayacucho 5840' },
      { names: [['ayacucho']], block: 5800 },
    ],
    ['numbered street name', { nombre: 'Sobre 9 de Julio 2500' }, { names: [['9', 'julio']], block: 2500 }],
    ['street without number', { nombre: 'Falcon', aliases: ['Falcon'] }, { names: [['falcon']], block: null }],
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
      if (parsed.block === null) withoutBlock.push(ref.nombre);
    }

    expect(unnamed).toEqual([]);
    const ratio = (streets.length - withoutBlock.length) / streets.length;
    expect(ratio, `streets without block: ${withoutBlock.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
  });
});
