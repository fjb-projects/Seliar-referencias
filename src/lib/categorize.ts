import {
  bestStreetGrade,
  blockOf,
  gradeStreetName,
  haversineMeters,
  parseCatalogStreet,
  streetNameTokens,
  type CatalogStreet,
  type ParsedQuery,
  type StreetGrade,
} from './address';
import type { GeorefHit, GeorefStreet } from './georef';
import { Tier, type SearchResponse } from './search';
import type { Reference } from './types';

/**
 * Why a result is where it is, best first. Catalog and Georef results share this one hierarchy,
 * and a result never jumps ahead of a better category.
 */
export const Category = {
  /** A record the engine matched with confidence: a place, a tower, a barrio. */
  Reference: 0,
  /** A catalog street on the block of the query number, with a Georef address agreeing nearby. */
  ConfirmedBlock: 1,
  /** A catalog street on the block of the query number. */
  SameBlock: 2,
  /** An address Georef interpolated on the street the operator typed. */
  Interpolated: 3,
  /** A catalog street one or two blocks away from the query number. */
  NeighbourBlock: 4,
  /** A catalog record of the street, farther away or without a block to compare. */
  SameStreet: 5,
  /** Georef knows the street in a locality but resolved no address there. */
  StreetExists: 6,
  /** A street that only resembles the one typed, or an engine hit that is not confident. */
  Similar: 7,
} as const;

export type CategoryId = (typeof Category)[keyof typeof Category];

/** Farthest block, in house numbers, that still counts as a neighbour of the query number. */
export const NEIGHBOUR_BLOCK_DISTANCE = 200;
/** A Georef address this close to a catalog block, in metres, confirms it. */
export const AGREEMENT_METERS = 300;
export const SAME_STREET_CAP = 8;
export const STREET_EXISTS_CAP = 5;
export const SIMILAR_CAP = 5;

/** The locality operators work in: its Georef rows go first and only its hits can contradict the catalog. */
const MAIN_LOCALITY = 'Santa Fe';

/** A catalog street record with its names and blocks already parsed. */
export interface StreetIndexEntry {
  ref: Reference;
  street: CatalogStreet;
}

/** A Georef address next to a catalog row, and how far apart they are. */
interface GeorefEvidence {
  hit: GeorefHit;
  distanceM: number;
}

export type RankedItem =
  | {
      key: string;
      category: CategoryId;
      source: 'catalog';
      ref: Reference;
      /** Null for a row that is there because of the engine, not because of its street name. */
      streetGrade: StreetGrade | null;
      /** House numbers between the query block and the nearest block of the record. */
      blockDistance: number | null;
      /** The Georef address that agrees with this block; it has no row of its own. */
      confirmedBy?: GeorefEvidence;
      /** The Georef address in the main locality that places the same address elsewhere. */
      discrepancy?: GeorefEvidence;
    }
  | { key: string; category: CategoryId; source: 'georef'; kind: 'address'; hit: GeorefHit; streetGrade: StreetGrade }
  | {
      key: string;
      category: CategoryId;
      source: 'georef';
      kind: 'street';
      street: GeorefStreet;
      streetGrade: StreetGrade;
    };

type CatalogItem = Extract<RankedItem, { source: 'catalog' }>;
type AddressItem = Extract<RankedItem, { kind: 'address' }>;
type StreetItem = Extract<RankedItem, { kind: 'street' }>;

export interface RankInput {
  query: ParsedQuery;
  /** Result of `SearchEngine.search` for the same text. */
  engine: SearchResponse;
  streets: StreetIndexEntry[];
  /** Null while Georef has not answered, or when it was not asked. */
  georefAddresses: GeorefHit[] | null;
  georefStreets: GeorefStreet[] | null;
}

export interface RankOutput {
  /** False when the query names no street: the list is empty and the caller shows the engine hits. */
  streetMode: boolean;
  items: RankedItem[];
  /** Index of the row that can be selected without asking the operator, or -1. */
  autoSelect: number;
}

/** Every street record of the catalog, parsed once so each keystroke only has to grade names. */
export function buildStreetIndex(references: Reference[]): StreetIndexEntry[] {
  const index: StreetIndexEntry[] = [];
  for (const ref of references) {
    const street = parseCatalogStreet(ref);
    if (street !== null) index.push({ ref, street });
  }
  return index;
}

const catalogKey = (ref: Reference) => `c:${ref.id}`;
const addressKey = (hit: GeorefHit) => `g:${hit.localidad}|${hit.label}`;
const streetKey = (street: GeorefStreet) => `s:${street.localidad}|${street.nombre}`;

/** The street the operator typed, as opposed to one that merely resembles it. */
const namesTheStreet = (grade: StreetGrade) => grade === 'strong' || grade === 'exact';

/** The first value of each key, in the order given. */
function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

/** Ascending, with null (nothing to compare) after every number. */
function compareNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const byName = (a: CatalogItem, b: CatalogItem) =>
  a.ref.nombre.localeCompare(b.ref.nombre, 'es') || a.ref.id.localeCompare(b.ref.id);

/** The rows of the main locality first; the order given is kept inside each group. */
function mainLocalityFirst<T>(rows: T[], localityOf: (row: T) => string): T[] {
  return [
    ...rows.filter((row) => localityOf(row) === MAIN_LOCALITY),
    ...rows.filter((row) => localityOf(row) !== MAIN_LOCALITY),
  ];
}

/** House numbers between the block of the query number and the nearest block of a record. */
function blockDistanceTo(blocks: number[], number: number | null): number | null {
  if (number === null || blocks.length === 0) return null;
  const target = blockOf(number);
  return Math.min(...blocks.map((block) => Math.abs(block - target)));
}

function streetCategory(grade: StreetGrade, blockDistance: number | null): CategoryId {
  if (!namesTheStreet(grade)) return Category.Similar;
  if (blockDistance === 0) return Category.SameBlock;
  if (blockDistance !== null && blockDistance <= NEIGHBOUR_BLOCK_DISTANCE) return Category.NeighbourBlock;
  return Category.SameStreet;
}

/** One row per catalog street whose name the query matches, weakly or better. */
function catalogStreetRows(query: ParsedQuery, streets: StreetIndexEntry[]): CatalogItem[] {
  const rows: CatalogItem[] = [];
  for (const { ref, street } of uniqueBy(streets, (entry) => entry.ref.id)) {
    const streetGrade = bestStreetGrade(query.streetTokens, street.names);
    if (streetGrade === 'none') continue;
    const blockDistance = blockDistanceTo(street.blocks, query.number);
    rows.push({
      key: catalogKey(ref),
      category: streetCategory(streetGrade, blockDistance),
      source: 'catalog',
      ref,
      streetGrade,
      blockDistance,
    });
  }
  return rows;
}

/** One row per Georef address on a street the query matches, weakly or better. */
function georefAddressRows(query: ParsedQuery, hits: GeorefHit[]): AddressItem[] {
  const rows: AddressItem[] = [];
  for (const hit of uniqueBy(hits, addressKey)) {
    const streetGrade = gradeStreetName(query.streetTokens, streetNameTokens(hit.calle));
    if (streetGrade === 'none') continue;
    const category = namesTheStreet(streetGrade) ? Category.Interpolated : Category.Similar;
    rows.push({ key: addressKey(hit), category, source: 'georef', kind: 'address', hit, streetGrade });
  }
  return rows;
}

function isOutOfRange(number: number | null, street: GeorefStreet): boolean {
  if (number === null || street.alturaMin === null || street.alturaMax === null) return false;
  return number < street.alturaMin || number > street.alturaMax;
}

/**
 * One row per Georef street the query matches. A street that names the one typed is only shown
 * for a locality without address evidence: where Georef resolved the address, the address row
 * already says the street exists there.
 */
function georefStreetRows(query: ParsedQuery, streets: GeorefStreet[], evidence: Set<string>): StreetItem[] {
  const rows: StreetItem[] = [];
  // A locality whose numbering cannot contain the typed height is not a candidate at all. Filtered
  // before de-duplicating, so an in-range entry survives an out-of-range one with the same key.
  const inRange = streets.filter((street) => !isOutOfRange(query.number, street));
  for (const street of uniqueBy(inRange, streetKey)) {
    const streetGrade = gradeStreetName(query.streetTokens, streetNameTokens(street.nombre));
    if (streetGrade === 'none') continue;
    const exists = namesTheStreet(streetGrade);
    if (exists && evidence.has(street.localidad)) continue;
    rows.push({
      key: streetKey(street),
      category: exists ? Category.StreetExists : Category.Similar,
      source: 'georef',
      kind: 'street',
      street,
      streetGrade,
    });
  }
  return rows;
}

/**
 * Folds each interpolated address into the SameBlock row it agrees with, which becomes a
 * ConfirmedBlock. Pairs are taken closest first, so an address confirms only the row nearest to
 * it and a row is confirmed by the nearest address still free. Returns the addresses left over.
 */
function foldConfirmations(sameBlock: CatalogItem[], interpolated: AddressItem[]): AddressItem[] {
  const pairs: { row: CatalogItem; address: AddressItem; distanceM: number }[] = [];
  for (const row of sameBlock) {
    for (const address of interpolated) {
      const distanceM = haversineMeters(row.ref, address.hit);
      if (distanceM <= AGREEMENT_METERS) pairs.push({ row, address, distanceM });
    }
  }
  pairs.sort((a, b) => a.distanceM - b.distanceM);

  const folded = new Set<AddressItem>();
  for (const { row, address, distanceM } of pairs) {
    if (row.category === Category.ConfirmedBlock || folded.has(address)) continue;
    row.category = Category.ConfirmedBlock;
    row.confirmedBy = { hit: address.hit, distanceM };
    folded.add(address);
  }
  return interpolated.filter((address) => !folded.has(address));
}

/** Notes, on each row still unconfirmed, the nearest address the main locality places elsewhere. */
function noteDiscrepancies(sameBlock: CatalogItem[], remaining: AddressItem[]): void {
  const rivals = remaining.filter((address) => address.hit.localidad === MAIN_LOCALITY);
  for (const row of sameBlock) {
    if (row.category !== Category.SameBlock) continue;
    let nearest: GeorefEvidence | null = null;
    for (const { hit } of rivals) {
      const distanceM = haversineMeters(row.ref, hit);
      if (nearest === null || distanceM < nearest.distanceM) nearest = { hit, distanceM };
    }
    if (nearest !== null) row.discrepancy = nearest;
  }
}

/** Engine hits that are not already shown as a street row: confident ones are references. */
function engineRows(engine: SearchResponse, streetRowIds: Set<string>): CatalogItem[] {
  const rows: CatalogItem[] = [];
  for (const hit of uniqueBy(engine.hits, (h) => h.ref.id)) {
    if (streetRowIds.has(hit.ref.id)) continue;
    const confident = !engine.partial && hit.tier <= Tier.AllPrefixes;
    rows.push({
      key: catalogKey(hit.ref),
      category: confident ? Category.Reference : Category.Similar,
      source: 'catalog',
      ref: hit.ref,
      streetGrade: null,
      blockDistance: null,
    });
  }
  return rows;
}

/** Catalog rows the engine ranked, in its order; then the ones it did not return, in the order given. */
function inEngineOrder(rows: CatalogItem[], engine: SearchResponse): CatalogItem[] {
  const position = new Map<string, number>();
  engine.hits.forEach((hit, index) => {
    if (!position.has(hit.ref.id)) position.set(hit.ref.id, index);
  });
  const rankOf = (row: CatalogItem) => position.get(row.ref.id) ?? null;
  return [...rows].sort((a, b) => compareNullsLast(rankOf(a), rankOf(b)));
}

/** Lowest block of each record, for a street listed without a number to measure against. */
function lowestBlocks(streets: StreetIndexEntry[]): Map<string, number> {
  const lowest = new Map<string, number>();
  for (const { ref, street } of streets) {
    if (street.blocks.length > 0 && !lowest.has(ref.id)) lowest.set(ref.id, Math.min(...street.blocks));
  }
  return lowest;
}

/**
 * The row Enter picks without asking: the engine's own unambiguous reference when no block row
 * competes, or the single block row when no reference competes. Never a Georef row.
 */
function autoSelectIndex(items: RankedItem[], engine: SearchResponse): number {
  const isBlockRow = (item: RankedItem) =>
    item.category === Category.ConfirmedBlock || item.category === Category.SameBlock;
  const blockRows = items.filter(isBlockRow);

  if (blockRows.length === 0) {
    const picked = engine.autoSelect >= 0 ? engine.hits[engine.autoSelect] : undefined;
    if (picked === undefined) return -1;
    return items.findIndex(
      (item) => item.source === 'catalog' && item.category === Category.Reference && item.ref.id === picked.ref.id,
    );
  }
  const hasReference = items.some((item) => item.category === Category.Reference);
  return !hasReference && blockRows.length === 1 ? items.indexOf(blockRows[0]) : -1;
}

/**
 * Ranks everything known about a street query (engine hits, catalog streets, Georef addresses
 * and Georef streets) in one list. Pure: the same input gives the same output and nothing given
 * is modified, so it can run again whenever a Georef answer arrives.
 */
export function rankResults(input: RankInput): RankOutput {
  const { query, engine } = input;
  const streetRows = catalogStreetRows(query, input.streets);
  const addressRows = georefAddressRows(query, input.georefAddresses ?? []);
  const interpolated = addressRows.filter((row) => row.category === Category.Interpolated);
  // Evidence that Georef resolved the address in a locality, whether or not it ends up folded.
  const evidence = new Set(interpolated.map((row) => row.hit.localidad));
  const georefStreets = georefStreetRows(query, input.georefStreets ?? [], evidence);

  // Some source knows the street typed. A Georef street hidden by address evidence needs no check
  // of its own: that evidence is an interpolated row.
  const namesAStreet =
    streetRows.some((row) => row.category !== Category.Similar) ||
    interpolated.length > 0 ||
    georefStreets.some((row) => row.category === Category.StreetExists);
  if (query.number === null && query.crossTokens === null && !namesAStreet) {
    return { streetMode: false, items: [], autoSelect: -1 };
  }

  const sameBlock = streetRows.filter((row) => row.category === Category.SameBlock);
  const remaining = foldConfirmations(sameBlock, interpolated);
  noteDiscrepancies(sameBlock, remaining);

  const fromEngine = engineRows(engine, new Set(streetRows.map((row) => row.ref.id)));
  const catalogRows = [...streetRows, ...fromEngine];
  const inCategory = (category: CategoryId) => catalogRows.filter((row) => row.category === category);
  const byBlockDistance = (a: CatalogItem, b: CatalogItem) => compareNullsLast(a.blockDistance, b.blockDistance);

  const lowest = query.number === null ? lowestBlocks(input.streets) : null;
  const bySameStreetOrder = (a: CatalogItem, b: CatalogItem) =>
    lowest === null
      ? byBlockDistance(a, b)
      : compareNullsLast(lowest.get(a.ref.id) ?? null, lowest.get(b.ref.id) ?? null);

  const items: RankedItem[] = [
    // Only engine rows are references, and they are already in engine order.
    ...inCategory(Category.Reference),
    ...inCategory(Category.ConfirmedBlock).sort(
      (a, b) => (a.confirmedBy?.distanceM ?? 0) - (b.confirmedBy?.distanceM ?? 0) || byName(a, b),
    ),
    ...inCategory(Category.SameBlock).sort(byName),
    ...mainLocalityFirst(remaining, (row) => row.hit.localidad),
    ...inCategory(Category.NeighbourBlock).sort((a, b) => byBlockDistance(a, b) || byName(a, b)),
    ...inCategory(Category.SameStreet)
      .sort((a, b) => bySameStreetOrder(a, b) || byName(a, b))
      .slice(0, SAME_STREET_CAP),
    ...mainLocalityFirst(
      georefStreets.filter((row) => row.category === Category.StreetExists),
      (row) => row.street.localidad,
    ).slice(0, STREET_EXISTS_CAP),
    ...[
      ...inEngineOrder(inCategory(Category.Similar), engine),
      ...addressRows.filter((row) => row.category === Category.Similar),
      ...georefStreets.filter((row) => row.category === Category.Similar),
    ].slice(0, SIMILAR_CAP),
  ];

  return { streetMode: true, items, autoSelect: autoSelectIndex(items, engine) };
}
