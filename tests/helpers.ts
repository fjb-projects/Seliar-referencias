import fs from 'node:fs';
import path from 'node:path';
import type { Cell } from '../scripts/lib/workbook';
import type { Reference, ReferenceCatalog } from '../src/lib/types';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Builds the cell list the parser consumes from a { "A1": "text" } map. */
export function cellsFrom(map: Record<string, string>): Cell[] {
  return Object.entries(map).map(([address, text]) => {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(address)!;
    const col = [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return { text, row: Number(digits), col, address };
  });
}

export function readCatalog(): ReferenceCatalog {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/references.json'), 'utf8')) as ReferenceCatalog;
}

export function readReferences(): Reference[] {
  return readCatalog().references;
}

export interface TestSource {
  id: string;
  path: string;
  file: string;
}

/** Sources declared in data-sources.json, resolved like the importer does. */
export function readSources(): TestSource[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-sources.json'), 'utf8')) as {
    sources: { id: string; file: string }[];
  };
  return manifest.sources.map((s) => ({ id: s.id, path: path.resolve(ROOT, s.file), file: path.basename(s.file) }));
}
