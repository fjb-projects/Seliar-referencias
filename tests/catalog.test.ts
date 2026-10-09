import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { haversineKm, parseCoordinate } from '../scripts/lib/coords';
import { readCatalog, readReferences } from './helpers';

/**
 * Expected values were read by hand from the workbook cells (not from the
 * importer's output), one per sheet, so these tests catch importer regressions.
 */
const REAL_SAMPLES: { file?: string; sheet: string; nombre: string; barrio?: string; cell: string; coord: string }[] = [
  { sheet: 'Favaloro', nombre: 'Plaza Gran Malvina', cell: 'B16', coord: '-31.566827, -60.70427' },
  { sheet: 'Favaloro', nombre: 'Sobre F Quiroga 3800', cell: 'G5', coord: '-31.566496, -60.699455' },
  { sheet: 'Santa Rita 1', nombre: 'Escuela Santa Rita De Casia', cell: 'B11', coord: '-31.576456, -60.724272' },
  { sheet: 'El Pozo', nombre: 'Plaza Central', cell: 'B38', coord: '-31.636980, -60.658858' },
  { sheet: 'Centenario', nombre: 'Plaza', cell: 'B13', coord: '-31.664764, -60.727562' },
  { sheet: 'Centenario', nombre: 'Manzana 1', cell: 'B3', coord: '-31.664889, -60.729472' },
  { sheet: 'Las Flores II', nombre: 'TORRE 1', cell: 'B4', coord: '-31.592696, -60.717075' },
  { sheet: 'Los Cipreses', nombre: 'Centro de Salud Dorrego', cell: 'B13', coord: '-31.594647, -60.680588' },
  { sheet: 'La florida', nombre: 'Colegio sagrado Corazon', cell: 'B22', coord: '-31.644853, -60.722900' },
  { sheet: 'Monoblokc Iturraspe 4300', nombre: 'Plaza Mandela', cell: 'B16', coord: '-31.626361, -60.72202' },
  { sheet: 'Fonavi Don Bosco', nombre: 'Tecsa', cell: 'B14', coord: '-31.601511, -60.707699' },
  { sheet: '29 de abril', nombre: 'Playon deportivo', cell: 'B11', coord: '-31.579196, -60.684506' },
  { sheet: 'Hipotecario', nombre: 'Botanico', cell: 'B11', coord: '-31.586823, -60.705889' },
  { sheet: 'Esmeralda Este Edificios', nombre: 'Villa Olimpica', cell: 'B11', coord: '-31.592650, -60.685331' },
  { sheet: 'Pje Santa teresita 3100', nombre: 'Spagna Motos', cell: 'B12', coord: '-31.6189738, -60.7055972' },
  { sheet: 'Villa Setubal', nombre: 'UTN', cell: 'B11', coord: '-31.617078, -60.675657' },
  // Second workbook
  { file: 'Torres similares.xlsx', sheet: 'Torres en el puerto', nombre: 'Torre 1', barrio: 'TORRES AMARRAS', cell: 'B4', coord: '-31.653829, -60.699322' },
  { file: 'Torres similares.xlsx', sheet: 'Torres en el puerto', nombre: 'Torre 1', barrio: 'TORRES CORPORE POWER', cell: 'U4', coord: '-31.647191, -60.700068' },
  { file: 'Torres similares.xlsx', sheet: 'Marcial Candiotti 2600', nombre: 'Estacion Shell', cell: 'B17', coord: '-31.645662, -60.698439' },
  { file: 'Torres similares.xlsx', sheet: 'Lavalle 5000', nombre: 'Parque', cell: 'B14', coord: '-31.625462, -60.679766' },
  { file: 'Torres similares.xlsx', sheet: 'Pedro centeno 2100', nombre: 'Torre 2', cell: 'C4', coord: '-31.628817, -60.695760' },
];

describe('catalogue: real samples from 15 different sheets', () => {
  const refs = readReferences();

  it.each(REAL_SAMPLES)('$sheet · $nombre keeps its exact coordinate and cell', (s) => {
    const ref = refs.find(
      (r) =>
        r.source.sheet === s.sheet &&
        r.nombre === s.nombre &&
        (s.barrio === undefined || r.barrio === s.barrio) &&
        (s.file === undefined || r.source.file === s.file),
    );
    expect(ref, `${s.sheet} / ${s.nombre} missing`).toBeDefined();
    expect(ref!.coordRaw).toBe(s.coord);
    expect(ref!.source.cell).toBe(s.cell);
    const parsed = parseCoordinate(s.coord);
    expect(parsed.ok && ref!.latitude).toBe(parsed.ok && parsed.latitude);
    expect(parsed.ok && ref!.longitude).toBe(parsed.ok && parsed.longitude);
  });

  it('covers at least 10 distinct sheets across both workbooks', () => {
    expect(new Set(REAL_SAMPLES.map((s) => s.sheet)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(refs.map((r) => r.source.file)).size).toBe(2);
  });
});

describe('catalogue: invariants', () => {
  const catalog = readCatalog();
  const refs = catalog.references;

  it('declares a consistent count and unique ids', () => {
    expect(catalog.count).toBe(refs.length);
    expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
  });

  it('keeps every coordinate identical to its original text', () => {
    for (const r of refs) {
      const p = parseCoordinate(r.coordRaw);
      expect(p.ok, r.id).toBe(true);
      if (p.ok) {
        expect(r.latitude, r.id).toBe(p.latitude);
        expect(r.longitude, r.id).toBe(p.longitude);
      }
    }
  });

  it('has traceability to sheet, cell and row for every record', () => {
    for (const r of refs) {
      expect(r.source.file, r.id).toMatch(/.xlsx$/);
      expect(r.source.sheet, r.id).toBeTruthy();
      expect(r.source.cell, r.id).toMatch(/^[A-Z]+\d+$/);
      expect(r.source.row, r.id).toBeGreaterThan(0);
      expect(r.source.cell.endsWith(String(r.source.row)), r.id).toBe(true);
      expect(r.barrio.trim(), r.id).not.toBe('');
      expect(r.nombre.trim(), r.id).not.toBe('');
    }
  });

  it('has no coordinate far from the study area (no silent swaps)', () => {
    for (const r of refs) {
      expect(haversineKm(-31.5865, -60.7118, r.latitude, r.longitude), r.id).toBeLessThan(25);
    }
  });
});

describe('invalid records report', () => {
  const report = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '../reports/invalid-records.json'), 'utf8'),
  ) as { descartados: { reason: string; sheet: string; nombre?: string }[]; celdasSinClasificar: unknown[] };

  it('explains every discarded record and keeps unclassified cells', () => {
    expect(report.descartados.length).toBeGreaterThan(0);
    for (const d of report.descartados) expect(d.reason).toBeTruthy();
    expect(report.celdasSinClasificar.length).toBeGreaterThan(0);
  });

  it('never lists a discarded record as searchable', () => {
    const refs = readReferences();
    for (const d of report.descartados) {
      if (!d.nombre) continue;
      expect(refs.some((r) => r.source.sheet === d.sheet && r.nombre === d.nombre && d.reason === 'sin_coordenadas')).toBe(false);
    }
  });

  it('documents text found in coordinate cells instead of geocoding it', () => {
    const text = report.descartados.filter((d) => d.reason === 'coordenada_no_numerica');
    expect(text.length).toBeGreaterThan(0);
    expect(text.every((d) => 'textoEnCampoCoordenada' in d)).toBe(true);
  });
});
