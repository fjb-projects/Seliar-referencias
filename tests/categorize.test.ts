import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAddressQuery } from '../src/lib/address';
import {
  AGREEMENT_METERS,
  buildStreetIndex,
  Category,
  NEIGHBOUR_BLOCK_DISTANCE,
  rankResults,
  SAME_STREET_CAP,
  SIMILAR_CAP,
  STREET_EXISTS_CAP,
  type RankedItem,
  type RankInput,
  type RankOutput,
} from '../src/lib/categorize';
import type { GeorefHit, GeorefStreet } from '../src/lib/georef';
import { SearchEngine, Tier, type SearchResponse } from '../src/lib/search';
import type { Reference } from '../src/lib/types';
import { readReferences } from './helpers';

const CATALOG_PATH = path.resolve(import.meta.dirname, '../public/data/references.json');
const catalogAvailable = fs.existsSync(CATALOG_PATH);

const BASE = { latitude: -31.6, longitude: -60.7 };
const METERS_PER_DEGREE = 111_195;
/** A point the given metres north of BASE. */
const north = (meters: number) => ({ latitude: BASE.latitude + meters / METERS_PER_DEGREE, longitude: BASE.longitude });

function makeRef(nombre: string, overrides: Partial<Reference> = {}): Reference {
  return {
    id: nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    tipo: 'referencia',
    barrio: 'Test',
    nombre,
    aliases: [],
    ...BASE,
    coordRaw: '-31.6,-60.7',
    source: { file: 'test.xlsx', sheet: 'Test', cell: 'A1', row: 1 },
    ...overrides,
  };
}

const calle = (nombre: string, overrides: Partial<Reference> = {}) => makeRef(nombre, { tipo: 'calle', ...overrides });

function hit(street: string, altura: number, overrides: Partial<GeorefHit> = {}): GeorefHit {
  return {
    label: `${street} ${altura}, La Capital, Santa Fe`,
    localidad: 'Santa Fe',
    ...BASE,
    calle: street,
    altura,
    ...overrides,
  };
}

function georefStreet(nombre: string, localidad = 'Santa Fe', alturaMin: number | null = 0, alturaMax: number | null = 9999): GeorefStreet {
  return { nombre, localidad, alturaMin, alturaMax };
}

/** An engine answer holding the given records, each with its tier, in this order. */
function engineOf(hits: [Reference, number][], overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    hits: hits.map(([ref, tier], i) => ({ ref, tier, score: 100 - i })),
    partial: false,
    autoSelect: -1,
    tookMs: 0,
    ...overrides,
  };
}

interface Scenario {
  /** Catalog records the street index is built from. */
  refs?: Reference[];
  engine?: SearchResponse;
  addresses?: GeorefHit[] | null;
  streets?: GeorefStreet[] | null;
}

function inputFor(text: string, scenario: Scenario = {}): RankInput {
  return {
    query: parseAddressQuery(text),
    engine: scenario.engine ?? engineOf([]),
    streets: buildStreetIndex(scenario.refs ?? []),
    georefAddresses: scenario.addresses ?? null,
    georefStreets: scenario.streets ?? null,
  };
}

const rank = (text: string, scenario: Scenario = {}): RankOutput => rankResults(inputFor(text, scenario));

function nameOf(item: RankedItem): string {
  if (item.source === 'catalog') return item.ref.nombre;
  return item.kind === 'address' ? `${item.hit.label} @ ${item.hit.localidad}` : `${item.street.nombre} @ ${item.street.localidad}`;
}

const rows = (output: RankOutput) => output.items.map((item) => [item.category, nameOf(item)]);
const namesIn = (output: RankOutput, category: number) =>
  output.items.filter((item) => item.category === category).map(nameOf);
const catalogRow = (output: RankOutput, nombre: string) => {
  const found = output.items.find((item) => item.source === 'catalog' && item.ref.nombre === nombre);
  if (!found || found.source !== 'catalog') throw new Error(`no catalog row "${nombre}"`);
  return found;
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe('constants', () => {
  it('exposes the provisional thresholds and caps', () => {
    expect(Category).toEqual({
      Reference: 0,
      ConfirmedBlock: 1,
      SameBlock: 2,
      Interpolated: 3,
      NeighbourBlock: 4,
      SameStreet: 5,
      StreetExists: 6,
      Similar: 7,
    });
    expect(NEIGHBOUR_BLOCK_DISTANCE).toBe(200);
    expect(AGREEMENT_METERS).toBe(300);
    expect([SAME_STREET_CAP, STREET_EXISTS_CAP, SIMILAR_CAP]).toEqual([8, 5, 5]);
  });
});

describe('buildStreetIndex', () => {
  it('keeps every street record with its parsed names and blocks, in catalog order', () => {
    const index = buildStreetIndex([
      makeRef('Comisaria 25'),
      calle('Sobre San Martin 8500', { aliases: ['Gral San Martin'] }),
      makeRef('Torre 3', { tipo: 'torre' }),
      calle('Pje 32,50 8300 / 8400'),
    ]);
    expect(index.map((entry) => [entry.ref.nombre, entry.street])).toEqual([
      ['Sobre San Martin 8500', { names: [['san', 'martin'], ['gral', 'san', 'martin']], blocks: [8500] }],
      ['Pje 32,50 8300 / 8400', { names: [['32.5']], blocks: [8300, 8400] }],
    ]);
  });

  it('is empty for a catalog without streets', () => {
    expect(buildStreetIndex([makeRef('Plaza')])).toEqual([]);
    expect(buildStreetIndex([])).toEqual([]);
  });
});

describe('street mode', () => {
  const refs = [makeRef('Plaza Gran Malvina'), calle('Sobre San Martin 8500'), calle('Sobre Belgrano 1000')];
  const off: RankOutput = { streetMode: false, items: [], autoSelect: -1 };

  it('is off for a place name that names no street, whatever the engine found', () => {
    const engine = engineOf([[refs[0], Tier.ExactName]], { autoSelect: 0 });
    expect(rank('plaza gran malvina', { refs, engine })).toEqual(off);
    expect(rank('plaza gran malvina', { refs, engine, addresses: [], streets: [] })).toEqual(off);
  });

  it('is off when streets only match weakly', () => {
    const output = rank('san', {
      refs,
      addresses: [hit('SAN MARTIN NORTE', 100)],
      streets: [georefStreet('SAN MARTIN'), georefStreet('BELGRANO')],
    });
    expect(output).toEqual(off);
  });

  it('is off for an empty query', () => {
    expect(rank('', { refs, streets: [georefStreet('SAN MARTIN')] })).toEqual(off);
  });

  it('is on when the query has a house number, even with nothing to show', () => {
    expect(rank('zzzz 1234')).toEqual({ streetMode: true, items: [], autoSelect: -1 });
  });

  it('is on for an intersection', () => {
    const output = rank('zzzz y qqqq', { engine: engineOf([[refs[0], Tier.Partial]], { partial: true }) });
    expect(output.streetMode).toBe(true);
    expect(rows(output)).toEqual([[Category.Similar, 'Plaza Gran Malvina']]);
  });

  it('is on when a catalog street grades strong without a number', () => {
    const output = rank('san martin', { refs });
    expect(output.streetMode).toBe(true);
    expect(rows(output)).toEqual([[Category.SameStreet, 'Sobre San Martin 8500']]);
  });

  it('is on when only a Georef street grades strong', () => {
    const output = rank('rivadavia', { refs, streets: [georefStreet('RIVADAVIA')] });
    expect(output.streetMode).toBe(true);
    expect(rows(output)).toEqual([[Category.StreetExists, 'RIVADAVIA @ Santa Fe']]);
  });

  it('is on when only a Georef address grades strong', () => {
    const output = rank('rivadavia', { refs, addresses: [hit('RIVADAVIA', 1500)] });
    expect(output.streetMode).toBe(true);
    expect(output.items.map((item) => item.category)).toEqual([Category.Interpolated]);
  });
});

describe('catalog street rows', () => {
  const refs = [
    calle('Sobre San Martin 8800'),
    calle('Sobre San Martin Norte 8500'),
    calle('Sobre San Martin 8700'),
    calle('Sobre Belgrano 8500'),
    calle('Sobre San Martin'),
    calle('Sobre San Martin 8400'),
    calle('Sobre San Martin 8500'),
  ];

  it('grades the block of each record against the query number', () => {
    const output = rank('san martin 8540', { refs });
    expect(rows(output)).toEqual([
      [Category.SameBlock, 'Sobre San Martin 8500'],
      [Category.NeighbourBlock, 'Sobre San Martin 8400'],
      [Category.NeighbourBlock, 'Sobre San Martin 8700'],
      [Category.SameStreet, 'Sobre San Martin 8800'],
      [Category.SameStreet, 'Sobre San Martin'],
      [Category.Similar, 'Sobre San Martin Norte 8500'],
    ]);
    expect(output.items.map((item) => (item.source === 'catalog' ? item.blockDistance : 'georef'))).toEqual([
      0,
      100,
      200,
      300,
      null,
      0,
    ]);
    expect(output.items.map((item) => item.streetGrade)).toEqual(['exact', 'exact', 'exact', 'exact', 'exact', 'weak']);
  });

  it('puts every record of the street in SameStreet when the query has no number', () => {
    const output = rank('san martin', { refs });
    expect(namesIn(output, Category.SameStreet)).toEqual([
      'Sobre San Martin 8400',
      'Sobre San Martin 8500',
      'Sobre San Martin 8700',
      'Sobre San Martin 8800',
      'Sobre San Martin',
    ]);
    expect(namesIn(output, Category.Similar)).toEqual(['Sobre San Martin Norte 8500']);
    expect(output.items.every((item) => item.source !== 'catalog' || item.blockDistance === null)).toBe(true);
  });

  it('drops a number far from every block down to SameStreet', () => {
    const output = rank('san martin 2500', { refs });
    expect(namesIn(output, Category.SameBlock)).toEqual([]);
    expect(namesIn(output, Category.NeighbourBlock)).toEqual([]);
    expect(namesIn(output, Category.SameStreet)).toEqual([
      'Sobre San Martin 8400',
      'Sobre San Martin 8500',
      'Sobre San Martin 8700',
      'Sobre San Martin 8800',
      'Sobre San Martin',
    ]);
  });

  it('matches through the alias and reports the best grade of both names', () => {
    const output = rank('aguayo 4850', { refs: [calle('Pje Segundo 4800', { aliases: ['F Aguayo'] })] });
    const row = catalogRow(output, 'Pje Segundo 4800');
    expect(row.category).toBe(Category.SameBlock);
    expect(row.streetGrade).toBe('strong');
  });

  it('tolerates a typo in the street name but never in the number', () => {
    const output = rank('san matrin 8540', { refs });
    expect(namesIn(output, Category.SameBlock)).toEqual(['Sobre San Martin 8500']);
    expect(catalogRow(output, 'Sobre San Martin 8500').streetGrade).toBe('strong');
  });

  it('takes the nearest block of a record that covers two', () => {
    const double = [calle('Pje 32,50 8300 / 8400'), calle('Pje 32,50 8200')];
    expect(rows(rank('pje 32.50 8450', { refs: double }))).toEqual([
      [Category.SameBlock, 'Pje 32,50 8300 / 8400'],
      [Category.NeighbourBlock, 'Pje 32,50 8200'],
    ]);
    expect(rows(rank('pje 32.50 8350', { refs: double }))).toEqual([
      [Category.SameBlock, 'Pje 32,50 8300 / 8400'],
      [Category.NeighbourBlock, 'Pje 32,50 8200'],
    ]);
    expect(catalogRow(rank('pje 32.50 8650', { refs: double }), 'Pje 32,50 8300 / 8400')).toMatchObject({
      category: Category.NeighbourBlock,
      blockDistance: 200,
    });
  });

  it('never reads records that are not streets as street rows', () => {
    const output = rank('san martin 8540', { refs: [makeRef('San Martin 8500'), makeRef('San Martin', { tipo: 'barrio' })] });
    expect(output.items).toEqual([]);
  });
});

describe('Georef address rows', () => {
  it('ranks strong hits as Interpolated, weak ones as Similar and drops the rest', () => {
    const output = rank('san martin 2500', {
      addresses: [
        hit('SAN MARTIN NORTE', 2500),
        hit('BELGRANO', 2500),
        hit('SAN MARTIN', 2500),
        hit('GRAL J DE SAN MARTIN', 2500),
        hit('', 2500, { label: 'sin calle' }),
      ],
    });
    expect(rows(output)).toEqual([
      [Category.Interpolated, 'SAN MARTIN 2500, La Capital, Santa Fe @ Santa Fe'],
      [Category.Similar, 'SAN MARTIN NORTE 2500, La Capital, Santa Fe @ Santa Fe'],
      [Category.Similar, 'GRAL J DE SAN MARTIN 2500, La Capital, Santa Fe @ Santa Fe'],
    ]);
    expect(output.items.map((item) => item.streetGrade)).toEqual(['exact', 'weak', 'weak']);
    expect(output.items.every((item) => item.source === 'georef' && item.kind === 'address')).toBe(true);
  });

  it('grades the official name with the catalog tokenizer (decimals, via words)', () => {
    const output = rank('pje 38,5 1200', { addresses: [hit('PJE 38.50', 1200)] });
    expect(output.items.map((item) => [item.category, item.streetGrade])).toEqual([[Category.Interpolated, 'exact']]);
  });

  it('lists Santa Fe first and keeps the input order otherwise', () => {
    const output = rank('san martin 2500', {
      addresses: [
        hit('SAN MARTIN', 2500, { localidad: 'Recreo' }),
        hit('SAN MARTIN', 2500, { localidad: 'Santo Tomé' }),
        hit('SAN MARTIN', 2500, { localidad: 'Santa Fe' }),
        hit('SAN MARTIN', 2500, { localidad: 'Candioti' }),
      ],
    });
    expect(output.items.map((item) => (item.source === 'georef' && item.kind === 'address' ? item.hit.localidad : ''))).toEqual([
      'Santa Fe',
      'Recreo',
      'Santo Tomé',
      'Candioti',
    ]);
  });

  it('shows nothing from Georef while it has not answered', () => {
    const refs = [calle('Sobre San Martin 8500')];
    const output = rank('san martin 8540', { refs, addresses: null, streets: null });
    expect(rows(output)).toEqual([[Category.SameBlock, 'Sobre San Martin 8500']]);
    expect(catalogRow(output, 'Sobre San Martin 8500')).not.toHaveProperty('confirmedBy');
    expect(catalogRow(output, 'Sobre San Martin 8500')).not.toHaveProperty('discrepancy');
  });
});

describe('folding a Georef hit into a SameBlock row', () => {
  const block = calle('Sobre San Martin 8500');

  it('confirms the row and removes the hit when both are within the agreement distance', () => {
    const near = hit('SAN MARTIN', 8540, north(100));
    const output = rank('san martin 8540', { refs: [block], addresses: [near] });
    expect(rows(output)).toEqual([[Category.ConfirmedBlock, 'Sobre San Martin 8500']]);
    const row = catalogRow(output, 'Sobre San Martin 8500');
    expect(row.confirmedBy?.hit).toEqual(near);
    expect(row.confirmedBy?.distanceM).toBeGreaterThan(99);
    expect(row.confirmedBy?.distanceM).toBeLessThan(101);
    expect(row).not.toHaveProperty('discrepancy');
    expect(row.blockDistance).toBe(0);
  });

  it('confirms at the same coordinates with distance zero', () => {
    const output = rank('san martin 8540', { refs: [block], addresses: [hit('SAN MARTIN', 8540)] });
    expect(catalogRow(output, 'Sobre San Martin 8500').confirmedBy?.distanceM).toBe(0);
  });

  it.each([
    [AGREEMENT_METERS - 2, Category.ConfirmedBlock],
    [AGREEMENT_METERS + 2, Category.SameBlock],
  ])('a hit %d m away leaves the row in category %d', (meters, category) => {
    const output = rank('san martin 8540', { refs: [block], addresses: [hit('SAN MARTIN', 8540, north(meters))] });
    expect(catalogRow(output, 'Sobre San Martin 8500').category).toBe(category);
  });

  it('keeps a far hit as its own row and notes the discrepancy when it is in Santa Fe', () => {
    const far = hit('SAN MARTIN', 8540, north(1000));
    const output = rank('san martin 8540', { refs: [block], addresses: [far] });
    expect(rows(output)).toEqual([
      [Category.SameBlock, 'Sobre San Martin 8500'],
      [Category.Interpolated, 'SAN MARTIN 8540, La Capital, Santa Fe @ Santa Fe'],
    ]);
    const row = catalogRow(output, 'Sobre San Martin 8500');
    expect(row).not.toHaveProperty('confirmedBy');
    expect(row.discrepancy?.hit).toEqual(far);
    expect(Math.round(row.discrepancy!.distanceM)).toBe(1000);
  });

  it('notes no discrepancy for a far hit in another locality', () => {
    const output = rank('san martin 8540', {
      refs: [block],
      addresses: [hit('SAN MARTIN', 8540, { ...north(20_000), localidad: 'Santo Tomé' })],
    });
    expect(catalogRow(output, 'Sobre San Martin 8500')).not.toHaveProperty('discrepancy');
    expect(namesIn(output, Category.Interpolated)).toHaveLength(1);
  });

  it('notes the nearest Santa Fe hit as the discrepancy', () => {
    const output = rank('san martin 8540', {
      refs: [block],
      addresses: [
        hit('SAN MARTIN', 8540, { ...north(600), localidad: 'Recreo', label: 'recreo' }),
        hit('SAN MARTIN', 8540, { ...north(3000), label: 'far' }),
        hit('SAN MARTIN', 8540, { ...north(900), label: 'nearer' }),
      ],
    });
    expect(catalogRow(output, 'Sobre San Martin 8500').discrepancy?.hit.label).toBe('nearer');
    expect(namesIn(output, Category.Interpolated)).toEqual(['far @ Santa Fe', 'nearer @ Santa Fe', 'recreo @ Recreo']);
  });

  it('never confirms with a hit of another street or a weak one', () => {
    const output = rank('san martin 8540', {
      refs: [block],
      addresses: [hit('BELGRANO', 8540), hit('SAN MARTIN NORTE', 8540)],
    });
    expect(rows(output)).toEqual([
      [Category.SameBlock, 'Sobre San Martin 8500'],
      [Category.Similar, 'SAN MARTIN NORTE 8540, La Capital, Santa Fe @ Santa Fe'],
    ]);
    expect(catalogRow(output, 'Sobre San Martin 8500')).not.toHaveProperty('discrepancy');
  });

  it('lets one hit confirm only the row nearest to it', () => {
    const fartherFirst = calle('Sobre San Martin 8500', { id: 'farther', barrio: 'B', ...north(200) });
    const nearer = calle('Sobre San Martin 8500', { id: 'nearer', barrio: 'A' });
    const only = hit('SAN MARTIN', 8540, north(50));
    const output = rank('san martin 8540', { refs: [fartherFirst, nearer], addresses: [only] });
    expect(output.items.map((item) => [item.category, item.key])).toEqual([
      [Category.ConfirmedBlock, 'c:nearer'],
      [Category.SameBlock, 'c:farther'],
    ]);
    const left = output.items[1];
    expect(left).not.toHaveProperty('confirmedBy');
    // The only hit agrees with this row too (150 m): it is no discrepancy.
    expect(left).not.toHaveProperty('discrepancy');
  });

  it('gives each row its own hit when there is one for each', () => {
    const south = calle('Sobre San Martin 8500', { id: 'south' });
    const northern = calle('Sobre San Martin 8500', { id: 'north', ...north(250) });
    const output = rank('san martin 8540', {
      refs: [south, northern],
      addresses: [hit('SAN MARTIN', 8540, { ...north(240), label: 'h-north' }), hit('SAN MARTIN', 8540, { ...north(90), label: 'h-south' })],
    });
    expect(output.items.map((item) => item.category)).toEqual([Category.ConfirmedBlock, Category.ConfirmedBlock]);
    // Ordered by confirm distance: 10 m before 90 m.
    expect(output.items.map((item) => (item.source === 'catalog' ? [item.key, item.confirmedBy?.hit.label] : []))).toEqual([
      ['c:north', 'h-north'],
      ['c:south', 'h-south'],
    ]);
  });

  it('never confirms neighbour blocks or same-street rows', () => {
    const output = rank('san martin 8540', {
      refs: [calle('Sobre San Martin 8400'), calle('Sobre San Martin 9900')],
      addresses: [hit('SAN MARTIN', 8540)],
    });
    expect(rows(output)).toEqual([
      [Category.Interpolated, 'SAN MARTIN 8540, La Capital, Santa Fe @ Santa Fe'],
      [Category.NeighbourBlock, 'Sobre San Martin 8400'],
      [Category.SameStreet, 'Sobre San Martin 9900'],
    ]);
  });
});

describe('Georef street rows', () => {
  it('shows a street per locality that has no address evidence', () => {
    const output = rank('san martin 2500', {
      addresses: [hit('SAN MARTIN', 2500, { localidad: 'Santo Tomé' }), hit('SAN MARTIN NORTE', 2500, { localidad: 'Recreo' })],
      streets: [
        georefStreet('SAN MARTIN', 'Santo Tomé'),
        georefStreet('SAN MARTIN', 'Recreo'),
        georefStreet('SAN MARTIN', 'Santa Fe'),
        georefStreet('BELGRANO', 'Santa Fe'),
        georefStreet('SAN MARTIN SUR', 'Candioti'),
      ],
    });
    // Recreo only has a weak address, which is no evidence for the street.
    expect(namesIn(output, Category.StreetExists)).toEqual(['SAN MARTIN @ Santa Fe', 'SAN MARTIN @ Recreo']);
    expect(namesIn(output, Category.Similar)).toEqual([
      'SAN MARTIN NORTE 2500, La Capital, Santa Fe @ Recreo',
      'SAN MARTIN SUR @ Candioti',
    ]);
    expect(output.items.some((item) => nameOf(item).startsWith('BELGRANO'))).toBe(false);
  });

  it('counts a hit folded into a confirmed row as evidence for its locality', () => {
    const output = rank('san martin 8540', {
      refs: [calle('Sobre San Martin 8500')],
      addresses: [hit('SAN MARTIN', 8540)],
      streets: [georefStreet('SAN MARTIN', 'Santa Fe'), georefStreet('SAN MARTIN', 'Recreo')],
    });
    expect(rows(output)).toEqual([
      [Category.ConfirmedBlock, 'Sobre San Martin 8500'],
      [Category.StreetExists, 'SAN MARTIN @ Recreo'],
    ]);
  });

  it('shows the street when the addresses lookup found nothing or has not answered', () => {
    const streets = [georefStreet('RIVADAVIA', 'Santa Fe', 0, 9699)];
    expect(rows(rank('rivadavia 1500', { addresses: [], streets }))).toEqual([[Category.StreetExists, 'RIVADAVIA @ Santa Fe']]);
    expect(rows(rank('rivadavia 1500', { addresses: null, streets }))).toEqual([[Category.StreetExists, 'RIVADAVIA @ Santa Fe']]);
  });

  it.each([
    ['inside the range', 'rivadavia 1500', 0, 9699, false],
    ['at the lower bound', 'rivadavia 100', 100, 900, false],
    ['at the upper bound', 'rivadavia 900', 100, 900, false],
    ['above the range', 'rivadavia 9700', 0, 9699, true],
    ['below the range', 'rivadavia 50', 100, 900, true],
    ['no range data', 'rivadavia 1500', null, null, false],
    ['an unknown lower bound', 'rivadavia 1500', null, 900, false],
    ['an unknown upper bound', 'rivadavia 50', 100, null, false],
    ['no number in the query', 'rivadavia', 100, 900, false],
  ])('drops a locality whose range cannot hold the number: %s', (_label, text, alturaMin, alturaMax, outOfRange) => {
    const output = rank(text, { streets: [georefStreet('RIVADAVIA', 'Santa Fe', alturaMin, alturaMax)] });
    if (outOfRange) {
      expect(output.items).toEqual([]);
      return;
    }
    expect(output.items).toHaveLength(1);
    expect(output.items[0]).toMatchObject({
      category: Category.StreetExists,
      source: 'georef',
      kind: 'street',
      streetGrade: 'exact',
    });
  });

  it('lists Santa Fe first and keeps the input order otherwise', () => {
    const output = rank('rivadavia', {
      streets: [georefStreet('RIVADAVIA', 'Recreo'), georefStreet('RIVADAVIA', 'Santo Tomé'), georefStreet('RIVADAVIA', 'Santa Fe')],
    });
    expect(namesIn(output, Category.StreetExists)).toEqual([
      'RIVADAVIA @ Santa Fe',
      'RIVADAVIA @ Recreo',
      'RIVADAVIA @ Santo Tomé',
    ]);
  });
});

describe('engine hits', () => {
  const plaza = makeRef('Plaza San Martin');
  const club = makeRef('Club San Martin');
  const street = calle('Sobre San Martin 8500');
  const weakStreet = calle('Sobre San Martin Norte 8500');

  it('ranks confident hits as Reference, in engine order, without street data', () => {
    const output = rank('san martin 8540', {
      engine: engineOf([
        [plaza, Tier.AllWords],
        [club, Tier.AllPrefixes],
      ]),
    });
    expect(rows(output)).toEqual([
      [Category.Reference, 'Plaza San Martin'],
      [Category.Reference, 'Club San Martin'],
    ]);
    expect(output.items[0]).toMatchObject({ source: 'catalog', streetGrade: null, blockDistance: null });
  });

  it('ranks fuzzy hits as Similar', () => {
    const output = rank('san martin 8540', {
      engine: engineOf([
        [plaza, Tier.AllPrefixes],
        [club, Tier.Fuzzy],
      ]),
    });
    expect(rows(output)).toEqual([
      [Category.Reference, 'Plaza San Martin'],
      [Category.Similar, 'Club San Martin'],
    ]);
  });

  it('ranks every hit of a partial answer as Similar', () => {
    const output = rank('san martin 8540', {
      engine: engineOf(
        [
          [plaza, Tier.Partial],
          [club, Tier.Partial],
        ],
        { partial: true },
      ),
    });
    expect(output.items.map((item) => item.category)).toEqual([Category.Similar, Category.Similar]);
    // Even a tier that would be confident is not trusted in a partial answer.
    const odd = rank('san martin 8540', { engine: engineOf([[plaza, Tier.ExactName]], { partial: true }) });
    expect(rows(odd)).toEqual([[Category.Similar, 'Plaza San Martin']]);
  });

  it('shows a record once: the street categorisation wins over the engine hit', () => {
    const output = rank('san martin 8540', {
      refs: [street, weakStreet],
      engine: engineOf([
        [street, Tier.NamePrefix],
        [plaza, Tier.AllWords],
        [weakStreet, Tier.AllWords],
      ]),
    });
    expect(rows(output)).toEqual([
      [Category.Reference, 'Plaza San Martin'],
      [Category.SameBlock, 'Sobre San Martin 8500'],
      [Category.Similar, 'Sobre San Martin Norte 8500'],
    ]);
    expect(catalogRow(output, 'Sobre San Martin 8500').streetGrade).toBe('exact');
  });

  it('keeps a street record the query does not name as an ordinary engine hit', () => {
    const other = calle('Sobre Belgrano 8500', { descripcion: 'esquina san martin' });
    const output = rank('san martin 8540', { refs: [other], engine: engineOf([[other, Tier.AllWords]]) });
    expect(output.items).toHaveLength(1);
    expect(output.items[0]).toMatchObject({ category: Category.Reference, streetGrade: null, blockDistance: null });
  });
});

describe('ordering and caps', () => {
  it('orders the list by category', () => {
    const output = rank('san martin 8540', {
      refs: [
        calle('Sobre San Martin 9900'),
        calle('Sobre San Martin 8600'),
        calle('Sobre San Martin 8500', { id: 'unconfirmed', barrio: 'Lejos', ...north(5000) }),
        calle('Sobre San Martin 8500', { id: 'confirmed' }),
        calle('Sobre San Martin Norte 100'),
      ],
      engine: engineOf([[makeRef('Plaza San Martin'), Tier.AllWords]]),
      addresses: [hit('SAN MARTIN', 8540), hit('SAN MARTIN', 8540, { localidad: 'Recreo', ...north(30_000) })],
      streets: [georefStreet('SAN MARTIN', 'Candioti'), georefStreet('SAN MARTIN', 'Recreo')],
    });
    expect(output.items.map((item) => item.category)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(output.items.map((item) => item.key)).toEqual([
      'c:plaza-san-martin',
      'c:confirmed',
      'c:unconfirmed',
      'g:Recreo|SAN MARTIN 8540, La Capital, Santa Fe',
      'c:sobre-san-martin-8600',
      'c:sobre-san-martin-9900',
      's:Candioti|SAN MARTIN',
      'c:sobre-san-martin-norte-100',
    ]);
  });

  it('orders SameBlock rows by name in Spanish collation', () => {
    const alias = { aliases: ['San Martin'] };
    const output = rank('san martin 8540', {
      refs: [calle('Zeta 8500', alias), calle('Ñandu 8500', alias), calle('alfa 8500', alias), calle('Ombu 8500', alias)],
    });
    expect(namesIn(output, Category.SameBlock)).toEqual(['alfa 8500', 'Ñandu 8500', 'Ombu 8500', 'Zeta 8500']);
  });

  it('orders NeighbourBlock rows by distance, then by name', () => {
    const output = rank('san martin 8540', {
      refs: [
        calle('Sobre San Martin 8700'),
        calle('Sobre San Martin 8600'),
        calle('Sobre San Martin 8300'),
        calle('Sobre San Martin 8400'),
      ],
    });
    expect(namesIn(output, Category.NeighbourBlock)).toEqual([
      'Sobre San Martin 8400',
      'Sobre San Martin 8600',
      'Sobre San Martin 8300',
      'Sobre San Martin 8700',
    ]);
  });

  it('orders SameStreet rows by distance to the number, records without a block last', () => {
    const output = rank('san martin 5000', {
      refs: [
        calle('Sobre San Martin'),
        calle('Sobre San Martin 8500'),
        calle('Sobre San Martin 4000'),
        calle('Sobre San Martin 100'),
        calle('Sobre San Martin 6000'),
      ],
    });
    expect(namesIn(output, Category.SameStreet)).toEqual([
      'Sobre San Martin 4000',
      'Sobre San Martin 6000',
      'Sobre San Martin 8500',
      'Sobre San Martin 100',
      'Sobre San Martin',
    ]);
  });

  it('orders SameStreet rows by their lowest block when the query has no number', () => {
    const output = rank('san martin', {
      refs: [
        calle('Sobre San Martin'),
        calle('Sobre San Martin 8500'),
        calle('Sobre San Martin 8300 / 8400'),
        calle('Sobre San Martin 100', { id: 'b', nombre: 'B San Martin 100' }),
        calle('Sobre San Martin 100', { id: 'a', nombre: 'A San Martin 100' }),
      ],
    });
    expect(namesIn(output, Category.SameStreet)).toEqual([
      'A San Martin 100',
      'B San Martin 100',
      'Sobre San Martin 8300 / 8400',
      'Sobre San Martin 8500',
      'Sobre San Martin',
    ]);
  });

  it('orders Similar rows: catalog in engine order, then Georef addresses, then Georef streets', () => {
    const unranked = calle('Sobre San Martin Sur 100');
    const ranked = calle('Sobre San Martin Norte 100');
    const club = makeRef('Club San Martn');
    const output = rank('san martin 8540', {
      refs: [unranked, ranked],
      engine: engineOf([
        [club, Tier.Fuzzy],
        [ranked, Tier.AllWords],
      ]),
      addresses: [hit('SAN MARTIN NORTE', 8540)],
      streets: [georefStreet('SAN MARTIN OESTE')],
    });
    expect(rows(output)).toEqual([
      [Category.Similar, 'Club San Martn'],
      [Category.Similar, 'Sobre San Martin Norte 100'],
      [Category.Similar, 'Sobre San Martin Sur 100'],
      [Category.Similar, 'SAN MARTIN NORTE 8540, La Capital, Santa Fe @ Santa Fe'],
      [Category.Similar, 'SAN MARTIN OESTE @ Santa Fe'],
    ]);
  });

  it('caps SameStreet after ordering and leaves the better categories whole', () => {
    const refs = Array.from({ length: 30 }, (_, i) => calle(`Sobre San Martin ${(29 - i) * 100}`));
    const output = rank('san martin 1050', { refs });
    expect(namesIn(output, Category.SameBlock)).toEqual(['Sobre San Martin 1000']);
    expect(namesIn(output, Category.NeighbourBlock)).toHaveLength(4);
    expect(namesIn(output, Category.SameStreet)).toEqual([
      'Sobre San Martin 1300',
      'Sobre San Martin 700',
      'Sobre San Martin 1400',
      'Sobre San Martin 600',
      'Sobre San Martin 1500',
      'Sobre San Martin 500',
      'Sobre San Martin 1600',
      'Sobre San Martin 400',
    ]);
    expect(namesIn(output, Category.SameStreet)).toHaveLength(SAME_STREET_CAP);
  });

  it('caps StreetExists after ordering', () => {
    const localities = ['Recreo', 'Monte Vera', 'Candioti', 'Angel Gallardo', 'Arroyo Leyes', 'Sauce Viejo', 'Santa Fe'];
    const output = rank('rivadavia', { streets: localities.map((l) => georefStreet('RIVADAVIA', l)) });
    expect(namesIn(output, Category.StreetExists)).toEqual([
      'RIVADAVIA @ Santa Fe',
      'RIVADAVIA @ Recreo',
      'RIVADAVIA @ Monte Vera',
      'RIVADAVIA @ Candioti',
      'RIVADAVIA @ Angel Gallardo',
    ]);
    expect(namesIn(output, Category.StreetExists)).toHaveLength(STREET_EXISTS_CAP);
  });

  it('caps Similar after ordering, catalog rows first', () => {
    const refs = ['Norte', 'Sur', 'Este'].map((side) => calle(`Sobre San Martin ${side} 100`));
    const output = rank('san martin 8540', {
      refs,
      addresses: ['A', 'B', 'C'].map((side) => hit(`SAN MARTIN ${side}${side}`, 8540)),
      streets: [georefStreet('SAN MARTIN OESTE')],
    });
    expect(namesIn(output, Category.Similar)).toEqual([
      'Sobre San Martin Norte 100',
      'Sobre San Martin Sur 100',
      'Sobre San Martin Este 100',
      'SAN MARTIN AA 8540, La Capital, Santa Fe @ Santa Fe',
      'SAN MARTIN BB 8540, La Capital, Santa Fe @ Santa Fe',
    ]);
    expect(output.items).toHaveLength(SIMILAR_CAP);
  });

  it('never caps Reference, block or Interpolated rows', () => {
    const places = Array.from({ length: 12 }, (_, i) => makeRef(`Plaza San Martin ${i}`));
    const blocks = Array.from({ length: 12 }, (_, i) => calle('Sobre San Martin 8500', { id: `block-${String(i).padStart(2, '0')}` }));
    const output = rank('san martin 8540', {
      refs: blocks,
      engine: engineOf(places.map((place) => [place, Tier.AllWords])),
      addresses: Array.from({ length: 12 }, (_, i) => hit('SAN MARTIN', 8540, { ...north(10_000), label: `h${i}` })),
    });
    expect(namesIn(output, Category.Reference)).toHaveLength(12);
    expect(namesIn(output, Category.SameBlock)).toHaveLength(12);
    expect(namesIn(output, Category.Interpolated)).toHaveLength(12);
  });
});

describe('keys', () => {
  it('builds a stable key per source', () => {
    const output = rank('san martin 8540', {
      refs: [calle('Sobre San Martin 8500', { id: 'las-flores-calle-san-martin-8500', ...north(9000) })],
      addresses: [hit('SAN MARTIN', 8540, { label: 'SAN MARTIN 8540, La Capital, Santa Fe', localidad: 'Santo Tomé' })],
      streets: [georefStreet('SAN MARTIN', 'Recreo')],
    });
    expect(output.items.map((item) => item.key)).toEqual([
      'c:las-flores-calle-san-martin-8500',
      'g:Santo Tomé|SAN MARTIN 8540, La Capital, Santa Fe',
      's:Recreo|SAN MARTIN',
    ]);
  });

  it('keeps the first of the rows that share a key', () => {
    const street = calle('Sobre San Martin 8500');
    const plaza = makeRef('Plaza San Martin');
    const output = rank('san martin 8540', {
      refs: [street],
      engine: engineOf([
        [plaza, Tier.AllWords],
        [plaza, Tier.AllPrefixes],
        [street, Tier.NamePrefix],
      ]),
      addresses: [
        hit('SAN MARTIN', 8540, { ...north(5000), altura: 8540 }),
        hit('SAN MARTIN', 8540, { ...north(9000), altura: 8541 }),
        hit('SAN MARTIN', 8540, { ...north(9000), localidad: 'Recreo' }),
      ],
      streets: [georefStreet('SAN MARTIN', 'Candioti', 0, 100), georefStreet('SAN MARTIN', 'Candioti', 0, 9000)],
    });
    const keys = output.items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'c:plaza-san-martin',
      'c:sobre-san-martin-8500',
      'g:Santa Fe|SAN MARTIN 8540, La Capital, Santa Fe',
      'g:Recreo|SAN MARTIN 8540, La Capital, Santa Fe',
      's:Candioti|SAN MARTIN',
    ]);
    const first = output.items[2];
    expect(first.source === 'georef' && first.kind === 'address' && first.hit.altura).toBe(8540);
    // The first Candioti entry (0-100) cannot hold 8540, so the in-range one (0-9000) is the row kept.
    expect(output.items[4]).toMatchObject({ street: { alturaMax: 9000 } });
  });

  it('keeps the same keys when Georef answers later', () => {
    const scenario = { refs: [calle('Sobre San Martin 8500'), calle('Sobre San Martin 8600')] };
    const before = rank('san martin 8540', scenario);
    const after = rank('san martin 8540', { ...scenario, addresses: [hit('SAN MARTIN', 8540)], streets: [georefStreet('SAN MARTIN')] });
    expect(before.items.map((item) => item.key)).toEqual(['c:sobre-san-martin-8500', 'c:sobre-san-martin-8600']);
    expect(after.items.map((item) => item.key)).toEqual(['c:sobre-san-martin-8500', 'c:sobre-san-martin-8600']);
    expect(after.items[0].category).toBe(Category.ConfirmedBlock);
  });
});

describe('auto-select', () => {
  const comisaria = makeRef('Comisaria 25');
  const other = makeRef('Comisaria 25 de Mayo');
  const block = calle('Sobre San Martin 8500');

  it('follows the engine pick when no block row competes', () => {
    const output = rank('comisaria 25', {
      refs: [block],
      engine: engineOf(
        [
          [comisaria, Tier.ExactName],
          [other, Tier.AllWords],
        ],
        { autoSelect: 0 },
      ),
      addresses: [hit('COMISARIA', 25)],
    });
    expect(output.autoSelect).toBe(0);
    expect(output.items[0]).toMatchObject({ category: Category.Reference, key: 'c:comisaria-25' });
  });

  it('selects nothing when the engine selects nothing', () => {
    const output = rank('comisaria 25', {
      engine: engineOf([
        [comisaria, Tier.ExactName],
        [other, Tier.ExactName],
      ]),
    });
    expect(output.autoSelect).toBe(-1);
  });

  it('does not follow the engine pick when it is not a Reference row', () => {
    // The engine picked the street record, which is shown as a SameStreet row.
    const lone = rank('san martin', { refs: [block], engine: engineOf([[block, Tier.NamePrefix]], { autoSelect: 0 }) });
    expect(rows(lone)).toEqual([[Category.SameStreet, 'Sobre San Martin 8500']]);
    expect(lone.autoSelect).toBe(-1);
    // An engine answer whose pick is not confident is not followed either.
    const fuzzy = rank('comisaria 25', { engine: engineOf([[comisaria, Tier.Fuzzy]], { autoSelect: 0 }) });
    expect(fuzzy.autoSelect).toBe(-1);
    const empty = rank('comisaria 25', { engine: engineOf([], { autoSelect: 0 }) });
    expect(empty.autoSelect).toBe(-1);
  });

  it('selects the only SameBlock row when no Reference competes', () => {
    const output = rank('san martin 8540', {
      refs: [block, calle('Sobre San Martin 8600')],
      engine: engineOf([[block, Tier.NamePrefix]], { autoSelect: 0 }),
      addresses: [hit('SAN MARTIN', 8540, north(4000))],
    });
    expect(output.items[output.autoSelect]).toMatchObject({ category: Category.SameBlock, key: 'c:sobre-san-martin-8500' });
    expect(output.autoSelect).toBe(0);
  });

  it('selects the only ConfirmedBlock row when no Reference competes', () => {
    const output = rank('san martin 8540', { refs: [block], addresses: [hit('SAN MARTIN', 8540)] });
    expect(output.autoSelect).toBe(0);
    expect(output.items[0].category).toBe(Category.ConfirmedBlock);
  });

  it('selects the block row at its real index', () => {
    const output = rank('san martin 8540', {
      refs: [block],
      engine: engineOf([[makeRef('Club San Martn'), Tier.Fuzzy]]),
    });
    expect(rows(output)).toEqual([
      [Category.SameBlock, 'Sobre San Martin 8500'],
      [Category.Similar, 'Club San Martn'],
    ]);
    expect(output.autoSelect).toBe(0);
  });

  it('selects nothing when a Reference row rivals the block row', () => {
    const plaza = makeRef('Plaza San Martin 8540');
    const output = rank('san martin 8540', {
      refs: [block],
      engine: engineOf([[plaza, Tier.AllWords]], { autoSelect: 0 }),
    });
    expect(rows(output)).toEqual([
      [Category.Reference, 'Plaza San Martin 8540'],
      [Category.SameBlock, 'Sobre San Martin 8500'],
    ]);
    expect(output.autoSelect).toBe(-1);
  });

  it('selects nothing when two block rows compete', () => {
    const twin = calle('Sobre San Martin 8500', { id: 'twin', ...north(5000) });
    expect(rank('san martin 8540', { refs: [block, twin] }).autoSelect).toBe(-1);
    // One confirmed and one unconfirmed are still two candidates.
    const output = rank('san martin 8540', { refs: [block, twin], addresses: [hit('SAN MARTIN', 8540)] });
    expect(output.items.map((item) => item.category)).toEqual([Category.ConfirmedBlock, Category.SameBlock]);
    expect(output.autoSelect).toBe(-1);
  });

  it('never selects a Georef row, even when it is the only one', () => {
    expect(rank('san martin 2500', { addresses: [hit('SAN MARTIN', 2500)] }).autoSelect).toBe(-1);
    expect(rank('rivadavia 1500', { streets: [georefStreet('RIVADAVIA')] }).autoSelect).toBe(-1);
    const withNeighbours = rank('san martin 2500', {
      refs: [calle('Sobre San Martin 2600')],
      addresses: [hit('SAN MARTIN', 2500)],
    });
    expect(withNeighbours.items.map((item) => item.category)).toEqual([Category.Interpolated, Category.NeighbourBlock]);
    expect(withNeighbours.autoSelect).toBe(-1);
  });
});

describe('purity', () => {
  const scenario = (): Scenario => {
    const block = calle('Sobre San Martin 8500');
    return {
      refs: [calle('Sobre San Martin 9900'), block, calle('Sobre San Martin 8400'), calle('Sobre San Martin Norte 100')],
      engine: engineOf(
        [
          [makeRef('Plaza San Martin'), Tier.AllWords],
          [block, Tier.NamePrefix],
          [makeRef('Club San Martn'), Tier.Fuzzy],
        ],
        { autoSelect: 0 },
      ),
      addresses: [hit('SAN MARTIN', 8540, { localidad: 'Recreo', ...north(9000) }), hit('SAN MARTIN', 8540), hit('SAN MARTIN SUR', 1)],
      streets: [georefStreet('SAN MARTIN', 'Candioti'), georefStreet('SAN MARTIN', 'Santa Fe'), georefStreet('SAN MARTIN SUR')],
    };
  };

  it('never mutates its input', () => {
    const input = inputFor('san martin 8540', scenario());
    const before = JSON.stringify(input);
    deepFreeze(input);
    const output = rankResults(input);
    expect(output.items.length).toBeGreaterThan(5);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns the same answer for the same input', () => {
    const input = inputFor('san martin 8540', scenario());
    expect(rankResults(input)).toEqual(rankResults(input));
    expect(rankResults(inputFor('san martin 8540', scenario()))).toEqual(rankResults(input));
  });

  it('hands out the records and hits it was given, not copies', () => {
    const input = inputFor('san martin 8540', scenario());
    const output = rankResults(input);
    const confirmed = output.items.find((item) => item.category === Category.ConfirmedBlock);
    expect(confirmed?.source === 'catalog' && confirmed.ref).toBe(input.streets[1].ref);
    expect(confirmed?.source === 'catalog' && confirmed.confirmedBy?.hit).toBe(input.georefAddresses![1]);
  });
});

describe.skipIf(!catalogAvailable)('real catalog (no network)', () => {
  const references = catalogAvailable ? readReferences() : [];
  const engine = new SearchEngine(references);
  const streets = buildStreetIndex(references);

  const real = (text: string, georef: { addresses?: GeorefHit[] | null; streets?: GeorefStreet[] | null } = {}) =>
    rankResults({
      query: parseAddressQuery(text),
      engine: engine.search(text),
      streets,
      georefAddresses: georef.addresses ?? null,
      georefStreets: georef.streets ?? null,
    });

  it('indexes every street record of the catalog', () => {
    expect(streets).toHaveLength(references.filter((ref) => ref.tipo === 'calle').length);
    expect(streets.length).toBeGreaterThan(600);
  });

  it('"san martin 2500" does not offer "Sobre San Martin 8500" as a match', () => {
    const output = real('san martin 2500');
    expect(output.streetMode).toBe(true);
    const row = output.items.find((item) => item.source === 'catalog' && item.ref.nombre === 'Sobre San Martin 8500');
    if (row) expect(row.category).toBe(Category.SameStreet);
    expect(output.items.filter((item) => item.category <= Category.NeighbourBlock)).toEqual([]);
    expect(output.autoSelect).toBe(-1);
  });

  it('"san martin 2500" shows the Georef rows above the far blocks of the street', () => {
    const output = real('san martin 2500', {
      addresses: [hit('SAN MARTIN', 2500, { latitude: -31.6486, longitude: -60.7087 })],
      streets: [georefStreet('SAN MARTIN', 'Santa Fe', 1400, 9099), georefStreet('SAN MARTIN', 'Santo Tomé', 1000, 3999)],
    });
    expect(output.items[0]).toMatchObject({ category: Category.Interpolated, source: 'georef' });
    expect(namesIn(output, Category.StreetExists)).toEqual(['SAN MARTIN @ Santo Tomé']);
    expect(output.autoSelect).toBe(-1);
  });

  it('"san martin 8540" puts "Sobre San Martin 8500" in its block, confirmed once Georef agrees', () => {
    const alone = real('san martin 8540');
    const row = catalogRow(alone, 'Sobre San Martin 8500');
    expect(row.category).toBe(Category.SameBlock);
    expect(row.blockDistance).toBe(0);
    expect(namesIn(alone, Category.NeighbourBlock)).toContain('Sobre San Martin 8600');
    expect(alone.items[alone.autoSelect]).toBe(row);

    const agreeing = hit('SAN MARTIN', 8540, { latitude: row.ref.latitude, longitude: row.ref.longitude });
    const confirmed = catalogRow(real('san martin 8540', { addresses: [agreeing] }), 'Sobre San Martin 8500');
    expect(confirmed.category).toBe(Category.ConfirmedBlock);
    expect(confirmed.confirmedBy).toEqual({ hit: agreeing, distanceM: 0 });
    expect(confirmed.key).toBe(row.key);
  });

  it('"comisaria 25" keeps its reference on top and auto-selected', () => {
    const output = real('comisaria 25');
    expect(output.items[0]).toMatchObject({ category: Category.Reference, source: 'catalog' });
    expect(nameOf(output.items[0])).toBe('Comisaria 25');
    expect(output.autoSelect).toBe(0);
    expect(engine.search('comisaria 25').autoSelect).toBe(0);
  });

  it('"torre 3" keeps the towers on top', () => {
    const output = real('torre 3');
    expect(output.items[0].category).toBe(Category.Reference);
    expect(nameOf(output.items[0])).toBe('Torre 3');
    // Several towers share the name: nothing is picked, as today.
    expect(output.autoSelect).toBe(engine.search('torre 3').autoSelect);
  });

  it('"pje 32.50 8350" finds the double-block record of the decimal passage', () => {
    const output = real('pje 32.50 8350');
    const row = catalogRow(output, 'Pje 32,50 8300 / 8400');
    expect(row.category).toBe(Category.SameBlock);
    expect(row.streetGrade).toBe('exact');
    expect(catalogRow(output, 'Pje 32,50 8200').category).toBe(Category.NeighbourBlock);
  });

  it('a plain place name stays outside street mode', () => {
    for (const text of ['Plaza Gran Malvina', 'utn', 'comisaria', 'centro de salud dorrego']) {
      expect(real(text), text).toEqual({ streetMode: false, items: [], autoSelect: -1 });
    }
  });

  it('answers a keystroke in a few milliseconds', () => {
    const started = performance.now();
    for (let i = 0; i < 50; i++) real('san martin 8540', { addresses: [hit('SAN MARTIN', 8540)], streets: [georefStreet('SAN MARTIN')] });
    expect((performance.now() - started) / 50).toBeLessThan(30);
  });
});
