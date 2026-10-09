import MiniSearch, { type Query } from 'minisearch';
import { isStopword, normalizeText, searchTokens, splitTokens } from './normalize';
import type { RefTipo, Reference } from './types';

/**
 * Relevance tiers, best first. A result never jumps ahead of a better tier,
 * no matter how well MiniSearch scored it, so a sloppy fuzzy hit cannot
 * displace an exact reference.
 */
export const Tier = {
  /** Name (or alias) equals the query. */
  ExactName: 0,
  /** Name (or alias) starts with the query, last word may be a prefix. */
  NamePrefix: 1,
  /** Every query word appears as a whole word somewhere in the record. */
  AllWords: 2,
  /** Every query word is a whole word or a prefix of one. */
  AllPrefixes: 3,
  /** Needs typo tolerance for at least one word. */
  Fuzzy: 4,
  /** Only some of the query words matched (fallback when nothing matches them all). */
  Partial: 5,
} as const;

export interface SearchHit {
  ref: Reference;
  tier: number;
  score: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** True when the hits only match part of the query. */
  partial: boolean;
  /**
   * Index of the hit that can be selected without asking the operator, or -1.
   * Only an unambiguous, non-fuzzy best match qualifies: "never auto-select an ambiguous location".
   */
  autoSelect: number;
  tookMs: number;
}

const TIPO_TERMS: Record<RefTipo, string> = {
  barrio: 'barrio',
  referencia: '',
  calle: 'calle',
  torre: 'torre edificio',
  // The workbook spells it "Monoblokc"; operators will type "monoblock".
  monoblock: 'monoblock monoblokc edificio',
  manzana: 'manzana',
  casa: 'casa casas',
  otro: '',
};

const TIPO_PRIORITY: Record<RefTipo, number> = {
  referencia: 0,
  torre: 1,
  monoblock: 1,
  manzana: 2,
  casa: 2,
  calle: 3,
  otro: 4,
  barrio: 5,
};

interface Indexed {
  ref: Reference;
  /** Token sequences of the name and each alias (stopwords removed). */
  names: string[][];
  primary: Set<string>;
  secondary: Set<string>;
}

const FIELDS = ['nombre', 'aliases', 'direccion', 'barrio', 'zona', 'descripcion', 'tipoTexto'] as const;
type Field = (typeof FIELDS)[number];

function fieldText(ref: Reference, field: Field): string {
  switch (field) {
    case 'aliases':
      return ref.aliases.join(' ');
    case 'tipoTexto':
      return TIPO_TERMS[ref.tipo];
    default:
      return ref[field] ?? '';
  }
}

const withoutStopwords = (text: string) => splitTokens(text).filter((t) => !isStopword(t));

/** Adjacent-letter swaps ("rtia" -> "rita"); edit distance counts a swap as two edits. */
function swaps(term: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < term.length - 1; i++) {
    if (term[i] === term[i + 1]) continue;
    out.push(term.slice(0, i) + term[i + 1] + term[i] + term.slice(i + 2));
  }
  return out;
}

export class SearchEngine {
  private readonly mini: MiniSearch<Reference>;
  private readonly byId = new Map<string, Indexed>();
  private readonly vocabulary = new Set<string>();

  constructor(references: Reference[]) {
    this.mini = new MiniSearch<Reference>({
      fields: [...FIELDS],
      idField: 'id',
      processTerm: (term) => {
        const n = normalizeText(term);
        return n === '' || isStopword(n) ? null : n;
      },
      extractField: (doc, field) => fieldText(doc, field as Field),
    });

    for (const ref of references) {
      const names = [ref.nombre, ...ref.aliases].map(withoutStopwords).filter((t) => t.length > 0);
      const primary = new Set(withoutStopwords([ref.nombre, ...ref.aliases, ref.direccion ?? ''].join(' ')));
      const secondary = new Set(
        withoutStopwords([ref.barrio, ref.zona ?? '', ref.descripcion ?? '', TIPO_TERMS[ref.tipo]].join(' ')),
      );
      this.byId.set(ref.id, { ref, names, primary, secondary });
      for (const t of primary) this.vocabulary.add(t);
      for (const t of secondary) this.vocabulary.add(t);
    }
    this.mini.addAll(references);
  }

  get size(): number {
    return this.byId.size;
  }

  search(query: string, limit = 10): SearchResponse {
    const started = performance.now();
    const tokens = searchTokens(query);
    const done = (all: SearchHit[], partial: boolean): SearchResponse => ({
      hits: all.slice(0, limit),
      partial,
      // Ambiguity is judged on every match, not only on the visible page.
      autoSelect: this.autoSelect(all, partial),
      tookMs: performance.now() - started,
    });
    if (tokens.length === 0 || normalizeText(query).length < 2) return done([], false);

    const options = {
      prefix: true,
      fuzzy: (term: string) => (term.length < 4 ? false : term.length <= 6 ? 1 : 2),
      boost: { nombre: 5, aliases: 3, direccion: 3, barrio: 2, tipoTexto: 1 },
      weights: { fuzzy: 0.3, prefix: 0.6 },
    };
    const perToken: Query[] = tokens.map((t) => {
      const variants = t.length >= 4 ? swaps(t).filter((v) => this.vocabulary.has(v)) : [];
      return variants.length ? { combineWith: 'OR', queries: [t, ...variants] } : t;
    });

    let partial = false;
    let raw = this.mini.search({ combineWith: 'AND', queries: perToken }, options);
    if (raw.length === 0 && tokens.length > 1) {
      raw = this.mini.search({ combineWith: 'OR', queries: perToken }, options);
      partial = true;
    }

    const hits: SearchHit[] = [];
    for (const r of raw) {
      const indexed = this.byId.get(r.id as string)!;
      hits.push({ ref: indexed.ref, score: r.score, tier: partial ? Tier.Partial : this.tierOf(indexed, tokens) });
    }
    hits.sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        TIPO_PRIORITY[a.ref.tipo] - TIPO_PRIORITY[b.ref.tipo] ||
        a.ref.nombre.localeCompare(b.ref.nombre, 'es') ||
        a.ref.id.localeCompare(b.ref.id),
    );
    return done(hits, partial);
  }

  private tierOf(doc: Indexed, q: string[]): number {
    const last = q.length - 1;
    for (const seq of doc.names) {
      if (seq.length === q.length && seq.every((t, i) => t === q[i])) return Tier.ExactName;
    }
    for (const seq of doc.names) {
      if (seq.length >= q.length && q.every((t, i) => (i === last ? seq[i].startsWith(t) : seq[i] === t))) {
        return Tier.NamePrefix;
      }
    }
    const has = (t: string) => doc.primary.has(t) || doc.secondary.has(t);
    if (q.every(has)) return Tier.AllWords;
    const hasPrefix = (t: string) =>
      has(t) || [...doc.primary, ...doc.secondary].some((w) => w.startsWith(t));
    if (q.every(hasPrefix)) return Tier.AllPrefixes;
    return Tier.Fuzzy;
  }

  private autoSelect(hits: SearchHit[], partial: boolean): number {
    if (partial || hits.length === 0) return -1;
    const best = hits[0].tier;
    if (best > Tier.AllPrefixes) return -1;
    // The top hit must stand alone: no other hit of its tier, and no sibling whose name merely
    // starts with the query ("Comisaria" next to "Comisaria 25" and "Comisaria 3ro").
    const rivals = hits.filter((h) => h.tier <= Math.max(best, Tier.NamePrefix)).length;
    return rivals === 1 ? 0 : -1;
  }
}
