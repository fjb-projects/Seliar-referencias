import { isStopword, normalizeText } from './normalize';
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
/** A passage named with a decimal ("Pje 34,50", "Pje 169.5"): the whole number is the street name. */
const DECIMAL_NAME = /^\d+[.,]\d+$/;
/** Zeros closing the fraction of a decimal, the first fractional digit excluded: the "0" of "40.50". */
const TRAILING_FRACTION_ZEROS = /(\.\d+?)0+$/;
/** Runs of letters and digits, kept together across an inner dot or comma so a decimal survives. */
const WORD_CHUNK = /[\p{L}\p{N}]+(?:[.,][\p{L}\p{N}]+)*/gu;
const NOT_WORD = /[^\p{L}\p{N}]+/u;
/** Street text closed by two blocks: "Diez De Andino 6600 / 6700", "Leuman 2100 /2200". */
const DOUBLE_BLOCK = /^(.*?)(\d{1,5})\s*\/\s*(\d{1,5})[^\p{L}\p{N}]*$/su;
/** Text the first number of a double block cannot be glued to: a longer number, a word or a decimal. */
const ENDS_GLUED = /[\p{L}\p{N}.,]$/u;
/** "S/N" (sin numero) is part of a name, its slash separates nothing. */
const SIN_NUMERO = /\bs\s*\/\s*n\b/gi;
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
  /**
   * Hundreds the record marks (8500 stands for 8500-8599), ascending and without repeats.
   * Two for a record written "8300 / 8400", none when the record has no number.
   */
  blocks: number[];
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

/**
 * One spelling per decimal name, so "40,5" and "40,50" are the same passage: a dot, and no zeros
 * closing the fraction beyond its first digit. "34,50" -> "34.5", "12.00" -> "12.0".
 */
function canonicalDecimal(decimal: string): string {
  return decimal.replace(',', '.').replace(TRAILING_FRACTION_ZEROS, '$1');
}

/**
 * Normalised tokens of a street text. Like `splitTokens`, except that a decimal name stays in one
 * piece, in its canonical spelling: "Pje 34,50 8800," -> [pje, 34.5, 8800].
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const chunk of normalizeText(text).match(WORD_CHUNK) ?? []) {
    if (DECIMAL_NAME.test(chunk)) tokens.push(canonicalDecimal(chunk));
    else tokens.push(...chunk.split(NOT_WORD));
  }
  return tokens;
}

const isNoise = (token: string) => VIA_WORDS.has(token) || isStopword(token);
const nameTokens = (tokens: string[]) => tokens.filter((t) => !isNoise(t));
/** A token that can name a street by itself: has a letter and is neither a via-type word nor a stopword. */
const isAlphabetic = (token: string) => HAS_LETTER.test(token) && !isNoise(token);
/** A token that names a street by itself: a word, or the decimal of a passage. */
const namesStreet = (token: string) => isAlphabetic(token) || DECIMAL_NAME.test(token);

/**
 * Whether the tokens before a number already name a street, so the number can be a house number:
 * a word ("comisaria 25"), a decimal name ("38.50 1200"), or a via-type word followed by a name of
 * any kind ("pje 12 3400"). "25 de mayo" and "calle 12" name nothing before their number.
 */
function nameStreetBefore(before: string[]): boolean {
  if (before.some(namesStreet)) return true;
  return before.some((token) => VIA_WORDS.has(token)) && before.some((token) => !isNoise(token));
}

/**
 * Index of the house number: the last 1-5 digit token, provided a street precedes it
 * ("25 de mayo" has none) and it is not the start of a "<n> de <month>" name.
 */
function houseNumberIndex(tokens: string[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!HOUSE_NUMBER.test(tokens[i])) continue;
    return nameStreetBefore(tokens.slice(0, i)) && tokens[i + 1] !== 'de' ? i : -1;
  }
  return -1;
}

/** Index of the connector that splits an intersection, or -1. Both sides must name a street. */
function connectorIndex(tokens: string[]): number {
  return tokens.findIndex(
    (token, i) =>
      CROSS_CONNECTORS.has(token) && tokens.slice(0, i).some(namesStreet) && tokens.slice(i + 1).some(namesStreet),
  );
}

/**
 * Splits what the operator typed into street, house number and crossing street.
 * "san martin 2500 esq garay" -> street [san, martin], number 2500, cross [garay].
 */
export function parseAddressQuery(text: string): ParsedQuery {
  let tokens = tokenize(text);

  // "rivadavia entre mitre y belgrano": the bounding streets do not name the main one.
  // A leading "entre" is kept, it belongs to a name ("Entre Rios").
  const between = tokens.indexOf(BETWEEN);
  if (between > 0 && tokens.slice(0, between).some(namesStreet)) tokens = tokens.slice(0, between);

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

/** Blocks of the given numbers, ascending and without repeats. */
function blocksOf(numbers: string[]): number[] {
  return [...new Set(numbers.map((n) => blockOf(Number(n))))].sort((a, b) => a - b);
}

/**
 * Splits "Cjon Roca 2300," into its name tokens and the block its trailing number falls in,
 * or the two blocks of "Roca 2300 / 2400". A decimal is a name, never a block.
 */
function splitStreetText(text: string): { name: string[]; blocks: number[] } {
  // A number is a block only when a name is left without it ("Calle 12" keeps its 12).
  const double = DOUBLE_BLOCK.exec(text);
  if (double && !ENDS_GLUED.test(double[1])) {
    const name = nameTokens(tokenize(double[1]));
    if (name.length > 0) return { name, blocks: blocksOf([double[2], double[3]]) };
  }

  const tokens = tokenize(text);
  const last = tokens[tokens.length - 1];
  const head = nameTokens(tokens.slice(0, -1));
  if (last !== undefined && HOUSE_NUMBER.test(last) && head.length > 0) {
    return { name: head, blocks: blocksOf([last]) };
  }
  return { name: nameTokens(tokens), blocks: [] };
}

/**
 * Names an alias carries: "Luciano Leiva / Bernardo de Irigoyen" is two streets when every side
 * of the slash has a letter. A slash between numbers is a double block and "S/N" is a name.
 */
function aliasNames(alias: string): string[][] {
  const parts = alias.replace(SIN_NUMERO, 's n').split('/');
  const texts = parts.length > 1 && parts.every((part) => HAS_LETTER.test(part)) ? parts : [alias];
  return texts.map((part) => splitStreetText(part).name);
}

/**
 * Reads a catalog street record ("Sobre San Martin 8500") as street names plus blocks.
 * Returns null for any record that is not a street.
 */
export function parseCatalogStreet(ref: Reference): CatalogStreet | null {
  if (ref.tipo !== 'calle') return null;
  const main = splitStreetText(ref.direccion ?? ref.nombre);

  const names: string[][] = [];
  const seen = new Set<string>();
  for (const name of [main.name, ...ref.aliases.flatMap(aliasNames)]) {
    const key = name.join(' ');
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names, blocks: main.blocks };
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
 *   An initial only assists: at least one query token of two or more characters, or a number,
 *   has to pair by itself, so "r" names no street and neither does "roque" against "r".
 * - `weak`: every query token pairs, but the candidate has other tokens left, or the last query
 *   token is only a prefix of its pair.
 * - `none`: some query token has no pair, no full word of the query pairs, or the query is empty.
 */
export function gradeStreetName(query: string[], candidate: string[]): StreetGrade {
  if (query.length === 0 || candidate.length === 0) return 'none';
  // Letters alone name nothing, not even a candidate written with the same letters.
  if (query.every((token) => SINGLE_LETTER.test(token))) return 'none';
  if (query.length === candidate.length && query.every((t, i) => t === candidate[i])) return 'exact';
  if (query.length > candidate.length) return 'none';

  const last = query.length - 1;
  const used = new Array<boolean>(candidate.length).fill(false);
  let best: StreetGrade = 'none';

  // Token lists are a handful of words, so every pairing can be tried.
  const assign = (index: number, usedPrefix: boolean, anchored: boolean): void => {
    if (best === 'strong') return;
    if (index === query.length) {
      if (!anchored) return;
      const leftover = candidate.some((token, j) => !used[j] && !SINGLE_LETTER.test(token));
      best = usedPrefix || leftover ? 'weak' : 'strong';
      return;
    }
    for (let j = 0; j < candidate.length; j++) {
      if (used[j]) continue;
      const match = matchToken(query[index], candidate[j], index === last);
      if (match === null) continue;
      used[j] = true;
      // A full word of the query paired by the normal rules, not through an initial on either side.
      const anchors = match !== 'initial' && !SINGLE_LETTER.test(query[index]);
      assign(index + 1, usedPrefix || match === 'prefix', anchored || anchors);
      used[j] = false;
    }
  };
  assign(0, false, false);
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
