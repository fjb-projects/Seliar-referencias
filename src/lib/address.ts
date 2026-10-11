import { isStopword, splitTokens } from './normalize';
import type { Reference } from './types';

const EARTH_RADIUS_M = 6_371_000;
const BLOCK_SIZE = 100;

/** Words that name the kind of way, not the street itself ("Sobre Pje Neuquen" -> "neuquen"). */
const VIA_WORDS = new Set([
  'sobre',
  'calle',
  'av',
  'avda',
  'avenida',
  'bv',
  'boulevard',
  'pje',
  'pasaje',
  'cjon',
  'callejon',
]);

/** Words that join the two streets of an intersection. */
const CROSS_CONNECTORS = new Set(['y', 'esquina', 'esq']);
const BETWEEN = 'entre';

/** A house number or block: 1 to 5 digits, nothing else. */
const HOUSE_NUMBER = /^\d{1,5}$/;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/;
const SINGLE_LETTER = /^\p{L}$/u;
const MIN_PREFIX_LENGTH = 3;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ParsedQuery {
  /** Normalised tokens of the main street, via-type words and stopwords removed. */
  streetTokens: string[];
  /** House number (altura), or null when the query has none. */
  number: number | null;
  /** Normalised tokens of the crossing street, or null when the query is not an intersection. */
  crossTokens: string[] | null;
}

export interface CatalogStreet {
  /** Popular name tokens first, then each distinct alias. */
  names: string[][];
  /** Hundred the record marks (8500 stands for 8500-8599), or null when the record has no number. */
  block: number | null;
}

export type StreetGrade = 'exact' | 'strong' | 'weak' | 'none';

const GRADE_RANK: Record<StreetGrade, number> = { none: 0, weak: 1, strong: 2, exact: 3 };

/** Floors a house number to its hundred: 8540 -> 8500, 99 -> 0. */
export function blockOf(n: number): number {
  return Math.floor(n / BLOCK_SIZE) * BLOCK_SIZE;
}

/** Great-circle distance in metres between two coordinates. */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isNoise = (token: string) => VIA_WORDS.has(token) || isStopword(token);
const nameTokens = (tokens: string[]) => tokens.filter((t) => !isNoise(t));
/** A token that can name a street by itself: has a letter and is neither a via-type word nor a stopword. */
const isAlphabetic = (token: string) => HAS_LETTER.test(token) && !isNoise(token);

/**
 * Index of the house number: the last 1-5 digit token, provided a street word precedes it
 * ("25 de mayo" has none) and it is not the start of a "<n> de <month>" name.
 */
function houseNumberIndex(tokens: string[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!HOUSE_NUMBER.test(tokens[i])) continue;
    const afterStreetWord = tokens.slice(0, i).some(isAlphabetic);
    return afterStreetWord && tokens[i + 1] !== 'de' ? i : -1;
  }
  return -1;
}

/** Index of the connector that splits an intersection, or -1. Both sides must name a street. */
function connectorIndex(tokens: string[]): number {
  return tokens.findIndex(
    (token, i) =>
      CROSS_CONNECTORS.has(token) && tokens.slice(0, i).some(isAlphabetic) && tokens.slice(i + 1).some(isAlphabetic),
  );
}

/**
 * Splits what the operator typed into street, house number and crossing street.
 * "san martin 2500 esq garay" -> street [san, martin], number 2500, cross [garay].
 */
export function parseAddressQuery(text: string): ParsedQuery {
  let tokens = splitTokens(text);

  // "rivadavia entre mitre y belgrano": the bounding streets do not name the main one.
  // A leading "entre" is kept, it belongs to a name ("Entre Rios").
  const between = tokens.indexOf(BETWEEN);
  if (between > 0 && tokens.slice(0, between).some(isAlphabetic)) tokens = tokens.slice(0, between);

  let crossTokens: string[] | null = null;
  const connector = connectorIndex(tokens);
  if (connector !== -1) {
    crossTokens = nameTokens(tokens.slice(connector + 1));
    tokens = tokens.slice(0, connector);
  }

  const numberAt = houseNumberIndex(tokens);
  const number = numberAt === -1 ? null : Number(tokens[numberAt]);
  const streetTokens = nameTokens(tokens.filter((_, i) => i !== numberAt));
  return { streetTokens, number, crossTokens };
}

/** Splits "Cjon Roca 2300," into its name tokens and the block its trailing number falls in. */
function splitStreetText(text: string): { name: string[]; block: number | null } {
  const tokens = splitTokens(text);
  const last = tokens[tokens.length - 1];
  const head = nameTokens(tokens.slice(0, -1));
  // The trailing number is a block only when a name is left without it ("Calle 12" keeps its 12).
  if (last !== undefined && HOUSE_NUMBER.test(last) && head.length > 0) {
    return { name: head, block: blockOf(Number(last)) };
  }
  return { name: nameTokens(tokens), block: null };
}

/**
 * Reads a catalog street record ("Sobre San Martin 8500") as street names plus block.
 * Returns null for any record that is not a street.
 */
export function parseCatalogStreet(ref: Reference): CatalogStreet | null {
  if (ref.tipo !== 'calle') return null;
  const main = splitStreetText(ref.direccion ?? ref.nombre);

  const names: string[][] = [];
  const seen = new Set<string>();
  for (const name of [main.name, ...ref.aliases.map((alias) => splitStreetText(alias).name)]) {
    const key = name.join(' ');
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names, block: main.block };
}

/** Optimal string alignment distance: insert, delete, substitute or swap two adjacent letters, one edit each. */
function editDistance(a: string, b: string): number {
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, beforePrevious[j - 2] + 1);
      }
      current.push(best);
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

/** Typo budget for a token of this length: short words are too easy to turn into another street. */
function tolerance(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

type TokenMatch = 'full' | 'initial' | 'prefix' | null;

/** How a query token matches a candidate token. `allowPrefix` is set for the last query token only. */
function matchToken(query: string, candidate: string, allowPrefix: boolean): TokenMatch {
  if (query === candidate) return 'full';
  // Digits are never tolerant: "9 de julio" is not "8 de julio".
  if (HAS_DIGIT.test(query) || HAS_DIGIT.test(candidate)) return null;
  if (SINGLE_LETTER.test(query)) return candidate.startsWith(query) ? 'initial' : null;
  if (SINGLE_LETTER.test(candidate)) return query.startsWith(candidate) ? 'initial' : null;
  // The shorter token sets the budget, so a 3-letter name never absorbs a typo.
  const budget = tolerance(Math.min(query.length, candidate.length));
  if (budget > 0 && editDistance(query, candidate) <= budget) return 'full';
  if (allowPrefix && query.length >= MIN_PREFIX_LENGTH && candidate.startsWith(query)) return 'prefix';
  return null;
}

/**
 * Grades how well the street the operator typed names a candidate street. Both are normalised
 * token lists without via-type words or stopwords.
 *
 * - `exact`: same token sequence.
 * - `strong`: every query token pairs with a distinct candidate token (typos within tolerance,
 *   initials allowed) and the candidate has nothing left but single-letter initials.
 * - `weak`: every query token pairs, but the candidate has other tokens left, or the last query
 *   token is only a prefix of its pair.
 * - `none`: some query token has no pair, or the query is empty.
 */
export function gradeStreetName(query: string[], candidate: string[]): StreetGrade {
  if (query.length === 0 || candidate.length === 0) return 'none';
  if (query.length === candidate.length && query.every((t, i) => t === candidate[i])) return 'exact';
  if (query.length > candidate.length) return 'none';

  const last = query.length - 1;
  const used = new Array<boolean>(candidate.length).fill(false);
  let best: StreetGrade = 'none';

  // Token lists are a handful of words, so every pairing can be tried.
  const assign = (index: number, usedPrefix: boolean): void => {
    if (best === 'strong') return;
    if (index === query.length) {
      const leftover = candidate.some((token, j) => !used[j] && !SINGLE_LETTER.test(token));
      best = usedPrefix || leftover ? 'weak' : 'strong';
      return;
    }
    for (let j = 0; j < candidate.length; j++) {
      if (used[j]) continue;
      const match = matchToken(query[index], candidate[j], index === last);
      if (match === null) continue;
      used[j] = true;
      assign(index + 1, usedPrefix || match === 'prefix');
      used[j] = false;
    }
  };
  assign(0, false);
  return best;
}

/** Sort key for grades: exact = 3, strong = 2, weak = 1, none = 0. */
export function gradeRank(grade: StreetGrade): number {
  return GRADE_RANK[grade];
}

/** Best grade of the query against any of the names of a street (popular name and aliases). */
export function bestStreetGrade(query: string[], names: string[][]): StreetGrade {
  let best: StreetGrade = 'none';
  for (const name of names) {
    const grade = gradeStreetName(query, name);
    if (gradeRank(grade) > gradeRank(best)) best = grade;
  }
  return best;
}
