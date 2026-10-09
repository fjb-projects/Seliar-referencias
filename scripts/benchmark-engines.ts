/**
 * Measures candidate search engines on the REAL catalogue.
 *
 *   npm run benchmark       (runs with --expose-gc so heap numbers are meaningful)
 *
 * Reports: index build time, heap delta, per-query latency (p50/p95/max) on a
 * keystroke-by-keystroke workload, gzip size of the library, and relevance on
 * the gold set in tests/gold.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Charset, Document as FlexDocument } from 'flexsearch';
import Fuse from 'fuse.js';
import MiniSearch from 'minisearch';
import type { Reference, ReferenceCatalog } from '../src/lib/types';
import { GOLD, type GoldCase, matchesExpectation } from '../tests/gold';
import { normalizeText, searchTokens, splitTokens } from '../src/lib/normalize';
import { SearchEngine } from '../src/lib/search';

const root = path.resolve(import.meta.dirname, '..');
const catalog: ReferenceCatalog = JSON.parse(fs.readFileSync(path.join(root, 'public/data/references.json'), 'utf8'));
const refs = catalog.references;
const byId = new Map(refs.map((r) => [r.id, r]));

interface Engine {
  name: string;
  libFile?: string;
  build(): void;
  search(q: string): string[];
}

// --- Engines -------------------------------------------------------------------------
function nativeEngine(): Engine {
  let docs: { id: string; name: string; all: string[] }[] = [];
  return {
    name: 'Native array scan',
    build() {
      docs = refs.map((r) => ({
        id: r.id,
        name: normalizeText(r.nombre),
        all: splitTokens([r.nombre, ...r.aliases, r.direccion, r.barrio, r.zona, r.descripcion].filter(Boolean).join(' ')),
      }));
    },
    search(q) {
      const tokens = searchTokens(q);
      if (!tokens.length) return [];
      const scored: [string, number][] = [];
      for (const d of docs) {
        let score = 0;
        let ok = true;
        for (const t of tokens) {
          if (d.all.includes(t)) score += 2;
          else if (d.all.some((w) => w.startsWith(t))) score += 1;
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (d.name === normalizeText(q)) score += 10;
        scored.push([d.id, score]);
      }
      return scored.sort((a, b) => b[1] - a[1]).map((s) => s[0]);
    },
  };
}

function miniSearchEngine(): Engine {
  let ms: MiniSearch;
  const options = {
    fields: ['nombre', 'aliases', 'direccion', 'barrio', 'zona', 'descripcion'],
    storeFields: [],
    processTerm: (t: string) => {
      const n = normalizeText(t);
      return n === '' || ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'por', 'sobre', 'al'].includes(n) ? null : n;
    },
    extractField: (doc: Reference, field: string) => {
      const v = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(v) ? v.join(' ') : ((v as string | undefined) ?? '');
    },
  };
  return {
    name: 'MiniSearch',
    libFile: 'node_modules/minisearch/dist/es/index.js',
    build() {
      ms = new MiniSearch(options);
      ms.addAll(refs);
    },
    search(q) {
      const opts = {
        prefix: true,
        fuzzy: (t: string) => (t.length > 4 ? 0.2 : t.length === 4 ? 0.1 : false),
        boost: { nombre: 5, aliases: 3, direccion: 3, barrio: 2 },
        weights: { fuzzy: 0.3, prefix: 0.6 },
      };
      return ms.search(q, { ...opts, combineWith: 'AND' }).map((x) => x.id as string);
    },
  };
}

function finalEngine(): Engine {
  let engine: SearchEngine;
  return {
    name: 'MiniSearch + tiers (final)',
    libFile: 'node_modules/minisearch/dist/es/index.js',
    build() {
      engine = new SearchEngine(refs);
    },
    search(q) {
      return engine.search(q, 50).hits.map((h) => h.ref.id);
    },
  };
}

function fuseEngine(): Engine {
  let fuse: Fuse<Reference>;
  return {
    name: 'Fuse.js',
    libFile: 'node_modules/fuse.js/dist/fuse.min.mjs',
    build() {
      fuse = new Fuse(refs, {
        keys: [
          { name: 'nombre', weight: 5 },
          { name: 'aliases', weight: 3 },
          { name: 'direccion', weight: 3 },
          { name: 'barrio', weight: 2 },
          { name: 'zona', weight: 1 },
          { name: 'descripcion', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        ignoreDiacritics: true,
      });
    },
    search(q) {
      return fuse.search(q, { limit: 50 }).map((x) => x.item.id);
    },
  };
}

function flexEngine(): Engine {
  let doc: FlexDocument<Record<string, string>>;
  return {
    name: 'FlexSearch',
    libFile: 'node_modules/flexsearch/dist/flexsearch.bundle.min.js',
    build() {
      doc = new FlexDocument({
        encoder: Charset.LatinBalance,
        tokenize: 'forward',
        document: { id: 'id', index: ['nombre', 'aliases', 'direccion', 'barrio', 'descripcion'] },
      });
      for (const r of refs) {
        doc.add({
          id: r.id,
          nombre: r.nombre,
          aliases: r.aliases.join(' '),
          direccion: r.direccion ?? '',
          barrio: r.barrio,
          descripcion: r.descripcion ?? '',
        });
      }
    },
    search(q) {
      const res = doc.search(q, { limit: 50 }) as { field: string; result: string[] }[];
      const seen = new Set<string>();
      for (const f of res) for (const id of f.result) seen.add(id);
      return [...seen];
    },
  };
}

// --- Metrics ---------------------------------------------------------------------------
function gzipKb(file?: string): string {
  if (!file) return '0 (no dependency)';
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return 'n/a';
  return `${(zlib.gzipSync(fs.readFileSync(p)).length / 1024).toFixed(1)} KB`;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function keystrokeQueries(): string[] {
  const names = refs.filter((_, i) => i % 3 === 0).map((r) => r.nombre);
  const out: string[] = [];
  for (const n of names) for (let len = 2; len <= n.length; len += 2) out.push(n.slice(0, len));
  return out;
}

function evaluate(engine: Engine, c: GoldCase): boolean {
  const ids = engine.search(c.query);
  if (c.expect.length === 0) return ids.length === 0;
  const top = ids.slice(0, c.topN).map((id) => byId.get(id)!);
  return c.expect.every((x) => top.some((r) => matchesExpectation(r, x)));
}

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) console.warn('Run with --expose-gc for reliable heap numbers (npm run benchmark does).');

const engines = [nativeEngine(), miniSearchEngine(), fuseEngine(), flexEngine(), finalEngine()];
const queries = keystrokeQueries();
const categories = ['exacta', 'incompleta', 'sin-tildes', 'typo', 'repetida', 'sin-resultados'] as const;

console.log(`Catalogue: ${refs.length} records · keystroke workload: ${queries.length} queries · gold cases: ${GOLD.length}\n`);

const rows: string[][] = [];
for (const engine of engines) {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  engine.build();
  const buildMs = performance.now() - t0;
  gc?.();
  const heapMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;

  for (const q of queries.slice(0, 200)) engine.search(q); // warm-up
  const times: number[] = [];
  for (const q of queries) {
    const s = performance.now();
    engine.search(q);
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);

  const perCat = categories.map((cat) => {
    const cases = GOLD.filter((g) => g.category === cat);
    const ok = cases.filter((g) => evaluate(engine, g)).length;
    return `${ok}/${cases.length}`;
  });
  const total = GOLD.filter((g) => evaluate(engine, g)).length;

  rows.push([
    engine.name,
    gzipKb(engine.libFile),
    `${buildMs.toFixed(1)} ms`,
    `${heapMb.toFixed(2)} MB`,
    `${percentile(times, 50).toFixed(3)}`,
    `${percentile(times, 95).toFixed(3)}`,
    `${times[times.length - 1].toFixed(2)}`,
    ...perCat,
    `${total}/${GOLD.length}`,
  ]);
}

const head = ['Engine', 'gzip', 'Index build', 'Heap Δ', 'p50 ms', 'p95 ms', 'max ms', ...categories, 'Gold total'];
console.log(head.join(' | '));
console.log(head.map(() => '---').join(' | '));
for (const r of rows) console.log(r.join(' | '));
