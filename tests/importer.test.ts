import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type PipelineResult, runPipeline } from '../scripts/lib/pipeline';
import { displayBarrio } from '../src/lib/format';
import { readCatalog, readSources } from './helpers';

const sources = readSources();
const available = sources.every((s) => fs.existsSync(s.path));

describe.skipIf(!available)('end-to-end import of every source workbook', () => {
  let results: PipelineResult[];

  beforeAll(async () => {
    results = [];
    for (const s of sources) results.push(await runPipeline(s));
  }, 180_000);

  it('reproduces the committed catalogue exactly (ids, coordinates, order)', () => {
    const regenerated = results.flatMap((r) => r.references);
    const committed = readCatalog().references;
    expect(regenerated.map((r) => [r.id, r.coordRaw, r.source.file, r.source.cell])).toEqual(
      committed.map((r) => [r.id, r.coordRaw, r.source.file, r.source.cell]),
    );
  });

  it('declares every source in the catalogue with its own count', () => {
    const catalog = readCatalog();
    expect(catalog.sources.map((s) => s.id)).toEqual(sources.map((s) => s.id));
    for (const s of catalog.sources) {
      expect(s.count).toBe(catalog.references.filter((r) => r.source.file === s.file).length);
    }
    expect(catalog.sources.reduce((a, s) => a + s.count, 0)).toBe(catalog.count);
  });

  it('keeps ids unique across sources and prefixed with their source id', () => {
    const all = results.flatMap((r) => r.references);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    for (const r of results) for (const ref of r.references) expect(ref.id.startsWith(`${r.sourceId}-`)).toBe(true);
  });

  it('accounts for every candidate of every source: searchable + discarded', () => {
    for (const r of results) {
      const discarded = r.invalid.filter((i) => i.reason !== 'bloque_huerfano_duplicado').length;
      expect(r.references.length + discarded, r.sourceId).toBe(r.candidateCount);
    }
  });

  it('applies the same rules to both workbooks: every record is traceable to its file', () => {
    for (const r of results) {
      for (const ref of r.references) expect(ref.source.file, ref.id).toBe(r.sourceFile);
      for (const i of r.invalid) expect(i.fuente, i.reason).toBe(r.sourceId);
    }
  });

  it('omits sheets without geographic structure and reports them', () => {
    const fonavis = results.find((r) => r.sourceId === 'fonavis')!;
    expect(fonavis.sheets.filter((s) => !s.parse).map((s) => s.data.name)).toEqual(['Hoja4']);
    const torres = results.find((r) => r.sourceId === 'torres')!;
    const skipped = torres.sheets.filter((s) => !s.parse).map((s) => s.data.name);
    expect(skipped).toContain('Parque Federal');
    expect(skipped).not.toContain('Torres en el puerto');
  });

  it('quarantines the 860k-row stray block of "Santa Rita 1" instead of importing it', () => {
    const fonavis = results.find((r) => r.sourceId === 'fonavis')!;
    const stray = fonavis.invalid.filter((i) => i.reason === 'bloque_huerfano_duplicado');
    expect(stray.length).toBeGreaterThan(0);
    expect(stray.every((i) => i.sheet === 'Santa Rita 1')).toBe(true);
    expect(fonavis.references.filter((r) => r.source.sheet === 'Santa Rita 1').every((r) => r.source.row < 300)).toBe(true);
  });

  it('splits "Torres en el puerto" into its eight complexes instead of one barrio', () => {
    const torres = results.find((r) => r.sourceId === 'torres')!;
    const barrios = new Set(torres.references.filter((r) => r.source.sheet === 'Torres en el puerto').map((r) => r.barrio));
    expect([...barrios].sort()).toEqual([
      'EDIFICIO PERTOFINO',
      'TORRE FISRT TOWER',
      'TORRE RIO ARRIBA',
      'TORRES AMARRAS',
      'TORRES AMARRAS CENTER',
      'TORRES CORPORE POWER',
      'TORRES GARDEN INN',
    ]);
  });

  it('flags, but keeps, a reference far from the rest of its own sheet', () => {
    const torres = results.find((r) => r.sourceId === 'torres')!;
    const w = torres.warnings.find((x) => x.nombre === 'Edificio con antena alta');
    expect(w?.sheet).toBe('Juan dell Campillo 1300');
    expect(w?.km).toBeGreaterThan(5);
    expect(torres.references.some((r) => r.nombre === 'Edificio con antena alta')).toBe(true);
  });

  it('finds coordinates shared across sheets and sources (copy-paste suspects)', () => {
    const all = results.flatMap((r) => r.references);
    const same = all.filter((r) => r.coordRaw === '-31.636702, -60.657909');
    expect(same.map((r) => r.source.sheet).sort()).toEqual(['El Pozo', 'Juan dell Campillo 1300', 'Parque Sur']);
    expect(new Set(same.map((r) => r.source.file)).size).toBe(2);
  });
});

describe('displayBarrio', () => {
  it('title-cases shouting titles and leaves mixed case alone', () => {
    expect(displayBarrio('BARRIO FAVALORO')).toBe('Barrio Favaloro');
    expect(displayBarrio('MONOBLOCK ITURRASPE 4300 / 4400')).toBe('Monoblock Iturraspe 4300 / 4400');
    expect(displayBarrio('Fonavi Centenario')).toBe('Fonavi Centenario');
    expect(displayBarrio('BARRIO NUEVA ESÈRANZA ESTE')).toBe('Barrio Nueva Esèranza Este');
  });
});
