/**
 * Reproducible Excel -> JSON import. Every workbook goes through the same
 * parser and the same validations, and all of them end up in one catalogue.
 *
 *   npm run import                         imports every source of data-sources.json
 *   npm run import -- a.xlsx b.xlsx        imports exactly these files (ids derived from file names)
 *
 * Writes:
 *   public/data/references.json          searchable catalogue (all sources)
 *   reports/invalid-records.json         discarded items, warnings, unclassified cells
 *   reports/transformation-summary.md    statistics
 *   reports/excel-audit.md               overview + findings across sources
 *   reports/audit-<source>.md            one detailed audit per source
 *
 * Workbooks are only ever read.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ReferenceCatalog } from '../src/lib/types';
import { runPipeline, slug, type SourceInput } from './lib/pipeline';
import { buildAudit, buildInvalidJson, buildOverview, buildSummary, combine } from './lib/report';

const root = path.resolve(import.meta.dirname, '..');

function resolveSources(): SourceInput[] {
  const args = process.argv.slice(2);
  let entries: { id?: string; file: string }[];
  let base = process.cwd();
  if (args.length > 0) {
    entries = args.map((file) => ({ file }));
  } else if (process.env.EXCEL_SOURCE) {
    entries = process.env.EXCEL_SOURCE.split(path.delimiter).map((file) => ({ file }));
  } else {
    const manifest = path.join(root, 'data-sources.json');
    if (!fs.existsSync(manifest)) {
      console.error('Usage: npm run import -- "<file.xlsx>" ["<other.xlsx>" ...]  (or create data-sources.json)');
      process.exit(1);
    }
    entries = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { sources: { id?: string; file: string }[] }).sources;
    base = root;
  }

  const sources: SourceInput[] = entries.map((e) => {
    const file = path.resolve(base, e.file);
    const name = path.basename(file);
    return { id: slug(e.id ?? name.replace(/\.xlsx$/i, '')), path: file, file: name };
  });

  const ids = new Set<string>();
  for (const s of sources) {
    if (!fs.existsSync(s.path)) {
      console.error(`File not found: ${s.path}`);
      process.exit(1);
    }
    if (ids.has(s.id)) {
      console.error(`Duplicated source id "${s.id}": give each source a distinct id in data-sources.json`);
      process.exit(1);
    }
    ids.add(s.id);
  }
  return sources;
}

const sources = resolveSources();
const outData = path.join(root, 'public', 'data');
const outReports = path.join(root, 'reports');
fs.mkdirSync(outData, { recursive: true });
fs.mkdirSync(outReports, { recursive: true });

const t0 = performance.now();
const results = [];
for (const source of sources) {
  console.log(`Reading ${source.file} ...`);
  results.push(await runPipeline(source));
}
const combined = combine(results);
const generatedAt = new Date().toISOString();

// Ids must be unique across sources; the source id prefix guarantees it, this proves it.
const seen = new Set<string>();
for (const r of combined.references) {
  if (seen.has(r.id)) throw new Error(`Duplicated reference id across sources: ${r.id}`);
  seen.add(r.id);
}

const catalog: ReferenceCatalog = {
  version: 1,
  generatedAt,
  sources: results.map((r) => ({ id: r.sourceId, file: r.sourceFile, count: r.references.length })),
  count: combined.references.length,
  references: combined.references,
};
fs.writeFileSync(path.join(outData, 'references.json'), JSON.stringify(catalog));
fs.writeFileSync(path.join(outReports, 'invalid-records.json'), JSON.stringify(buildInvalidJson(combined), null, 2));
fs.writeFileSync(path.join(outReports, 'transformation-summary.md'), buildSummary(combined, generatedAt));
fs.writeFileSync(path.join(outReports, 'excel-audit.md'), buildOverview(combined, generatedAt));
for (const r of results) fs.writeFileSync(path.join(outReports, `audit-${r.sourceId}.md`), buildAudit(r, generatedAt));

for (const r of results) {
  const discarded = r.invalid.filter((i) => i.reason !== 'bloque_huerfano_duplicado').length;
  console.log(
    `[${r.sourceId}] sheets ${r.sheets.length} (${r.sheets.filter((s) => s.parse).length} processed) · candidates ${r.candidateCount} · searchable ${r.references.length} · discarded ${discarded} · warnings ${r.warnings.length} · unclassified cells ${r.orphanCells.length}`,
  );
}
console.log(`TOTAL searchable: ${combined.references.length} · elapsed ${((performance.now() - t0) / 1000).toFixed(1)} s`);
