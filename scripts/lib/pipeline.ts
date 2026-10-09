import type { Reference } from '../../src/lib/types';
import { haversineKm, parseCoordinate } from './coords';
import { type Candidate, norm, parseSheet, type SheetParse } from './parseSheet';
import { readWorkbook, type SheetData, type StrayBlock } from './workbook';
import type { Cell } from './workbook';

/** A point farther than this from the median of all points is held back for review. */
export const OUTLIER_KM = 25;
/** A point farther than this from the median of its own sheet is flagged (but kept). */
export const FAR_FROM_SHEET_KM = 2;

export type InvalidReason =
  | 'sin_coordenadas'
  | 'coordenada_no_numerica'
  | 'coordenadas_conflictivas'
  | 'coordenada_fuera_de_zona'
  | 'duplicado_exacto'
  | 'bloque_huerfano_duplicado';

export interface InvalidRecord {
  reason: InvalidReason;
  explanation: string;
  /** Id of the data source (workbook) the record comes from. */
  fuente: string;
  sheet: string;
  barrio?: string;
  tipo?: string;
  nombre?: string;
  direccion?: string;
  /** Text found where a coordinate was expected. */
  textoEnCampoCoordenada?: string;
  coordRaw?: string;
  detalles?: Record<string, string>;
  source?: { file: string; sheet: string; cell: string; row: number };
  extra?: Record<string, unknown>;
}

/** Records that stay searchable but deserve a human look. */
export interface Warning {
  reason: 'lejos_del_resto_de_la_hoja';
  explanation: string;
  fuente: string;
  sheet: string;
  barrio: string;
  nombre: string;
  coordRaw: string;
  cell: string;
  km: number;
}

export interface SheetReport {
  data: SheetData;
  parse: SheetParse | null;
  skippedReason?: string;
  valid: number;
  invalid: number;
}

export interface SourceInput {
  /** Short stable identifier, used as id prefix (e.g. "fonavis"). */
  id: string;
  /** Path of the .xlsx file. */
  path: string;
  /** File name shown in reports. */
  file: string;
}

export interface SharedCoordinateGroup {
  coord: string;
  refs: { id: string; fuente: string; sheet: string; barrio: string; nombre: string; direccion?: string }[];
}

export interface RepeatedNameGroup {
  nombre: string;
  refs: { id: string; barrio: string; tipo: string; direccion?: string }[];
}

export interface PipelineResult {
  sourceId: string;
  sourceFile: string;
  sheets: SheetReport[];
  references: Reference[];
  invalid: InvalidRecord[];
  warnings: Warning[];
  orphanCells: { fuente: string; sheet: string; cell: string; text: string }[];
  strayBlocks: { sheet: string; block: StrayBlock }[];
  candidateCount: number;
  geo: { medianLat: number; medianLon: number; outliers: number };
  /** Same coordinates, different names (potentially ambiguous). */
  sharedCoordinates: SharedCoordinateGroup[];
  /** Same normalised name in more than one barrio. */
  repeatedNames: RepeatedNameGroup[];
}

export function slug(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/** Collapses repeated markers ("c c C" -> "c") keeping distinct ones in order of appearance. */
export function uniqueMarca(marca: string | undefined): string | undefined {
  if (!marca) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of marca.split(' ')) {
    if (!seen.has(token.toLowerCase())) {
      seen.add(token.toLowerCase());
      out.push(token);
    }
  }
  return out.join(' ');
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ambiguity reports over any set of references (one source or all of them together). */
export function analyzeAmbiguity(references: Reference[]): {
  sharedCoordinates: SharedCoordinateGroup[];
  repeatedNames: RepeatedNameGroup[];
} {
  const byCoord = new Map<string, Reference[]>();
  for (const r of references) {
    const k = `${r.latitude},${r.longitude}`;
    byCoord.set(k, [...(byCoord.get(k) ?? []), r]);
  }
  const sharedCoordinates = [...byCoord.entries()]
    .filter(([, rs]) => rs.length > 1 && (new Set(rs.map((r) => norm(r.nombre))).size > 1 || new Set(rs.map((r) => `${r.source.file}|${r.source.sheet}`)).size > 1))
    .map(([coord, rs]) => ({
      coord,
      refs: rs.map((r) => ({
        id: r.id,
        fuente: r.source.file,
        sheet: r.source.sheet,
        barrio: r.barrio,
        nombre: r.nombre,
        direccion: r.direccion,
      })),
    }));

  const byName = new Map<string, Reference[]>();
  for (const r of references) {
    const k = norm(r.nombre);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const repeatedNames = [...byName.entries()]
    .filter(([, rs]) => new Set(rs.map((r) => r.barrio)).size > 1)
    .map(([nombre, rs]) => ({
      nombre,
      refs: rs.map((r) => ({ id: r.id, barrio: r.barrio, tipo: r.tipo, direccion: r.direccion })),
    }));
  return { sharedCoordinates, repeatedNames };
}

interface Geocoded {
  cand: Candidate;
  parse: SheetParse;
  barrio: string;
  latitude: number;
  longitude: number;
  coordRaw: string;
}

export async function runPipeline(input: SourceInput | string, sourceLabel?: string): Promise<PipelineResult> {
  const source: SourceInput =
    typeof input === 'string'
      ? { id: slug(sourceLabel ?? input.replace(/^.*[\\/]/, '').replace(/\.xlsx$/i, '')), path: input, file: sourceLabel ?? input.replace(/^.*[\\/]/, '') }
      : input;
  const fuente = source.id;
  const sheetsData = await readWorkbook(source.path);
  const invalid: InvalidRecord[] = [];
  const orphanCells: PipelineResult['orphanCells'] = [];
  const strayBlocks: PipelineResult['strayBlocks'] = [];
  const reports: SheetReport[] = [];
  const geocoded: Geocoded[] = [];
  let candidateCount = 0;

  for (const data of sheetsData) {
    for (const block of data.strayBlocks) strayBlocks.push({ sheet: data.name, block });

    const parse = parseSheet(data.name, data.cells);
    const hasStructure =
      parse.anchors.calles + parse.anchors.referencias + parse.anchors.info + parse.anchors.grids + parse.anchors.tablas > 0;
    if (!hasStructure || parse.candidates.length === 0) {
      reports.push({
        data,
        parse: null,
        skippedReason: 'Sin estructura geográfica reconocible (no hay bloques de coordenadas)',
        valid: 0,
        invalid: 0,
      });
      continue;
    }

    let validCount = 0;
    let invalidCount = 0;
    for (const cand of parse.candidates) {
      candidateCount++;
      const barrio = cand.barrio ?? parse.titulo;
      const base = {
        fuente,
        sheet: data.name,
        barrio,
        tipo: cand.tipo,
        nombre: cand.nombre,
        direccion: cand.direccion,
        detalles: Object.keys(cand.detalles).length ? cand.detalles : undefined,
        source: { file: source.file, sheet: data.name, cell: cand.cell, row: cand.row },
      };
      const parsed = cand.coordTexts.map((t) => parseCoordinate(t)).filter((p) => p.ok);
      const distinct = new Set(parsed.map((p) => `${p.latitude},${p.longitude}`));
      if (distinct.size === 0) {
        invalidCount++;
        invalid.push(
          cand.slotText
            ? {
                ...base,
                reason: 'coordenada_no_numerica',
                explanation:
                  'El campo de coordenadas contiene texto (dirección o nombre) en lugar de latitud/longitud. No se geocodifica.',
                textoEnCampoCoordenada: cand.slotText,
              }
            : {
                ...base,
                reason: 'sin_coordenadas',
                explanation: 'El ítem existe pero no tiene coordenadas cargadas.',
              },
        );
        continue;
      }
      if (distinct.size > 1) {
        invalidCount++;
        invalid.push({
          ...base,
          reason: 'coordenadas_conflictivas',
          explanation: 'El ítem tiene más de una coordenada distinta; se requiere revisión manual.',
          extra: { coordenadas: cand.coordTexts },
        });
        continue;
      }
      const p = parsed[0];
      if (!p.ok) continue;
      geocoded.push({ cand, parse, barrio, latitude: p.latitude, longitude: p.longitude, coordRaw: p.raw });
      validCount++;
    }
    for (const o of parse.orphans) orphanCells.push({ fuente, sheet: data.name, cell: o.address, text: o.text });
    reports.push({ data, parse, valid: validCount, invalid: invalidCount });
  }

  // --- Geographic sanity: distance from the source median --------------------
  const medianLat = median(geocoded.map((g) => g.latitude));
  const medianLon = median(geocoded.map((g) => g.longitude));
  const kept: Geocoded[] = [];
  let outliers = 0;
  for (const g of geocoded) {
    const km = haversineKm(medianLat, medianLon, g.latitude, g.longitude);
    if (km > OUTLIER_KM) {
      outliers++;
      const swappedKm = haversineKm(medianLat, medianLon, g.longitude, g.latitude);
      invalid.push({
        reason: 'coordenada_fuera_de_zona',
        explanation: `La coordenada está a ${km.toFixed(0)} km de la mediana del conjunto (límite ${OUTLIER_KM} km).${
          swappedKm <= OUTLIER_KM ? ' Con latitud y longitud invertidas caería dentro de la zona: posible inversión (no corregida).' : ''
        }`,
        fuente,
        sheet: g.parse.sheet,
        barrio: g.barrio,
        tipo: g.cand.tipo,
        nombre: g.cand.nombre,
        coordRaw: g.coordRaw,
        source: { file: source.file, sheet: g.parse.sheet, cell: g.cand.cell, row: g.cand.row },
      });
      continue;
    }
    kept.push(g);
  }

  // --- Build references, drop exact duplicates, assign ids -------------------
  const references: Reference[] = [];
  const usedIds = new Map<string, number>();
  const seenKeys = new Map<string, string>();
  for (const g of kept) {
    const { cand, parse } = g;
    const dupKey = [parse.sheet, g.barrio, cand.tipo, norm(cand.nombre), g.latitude, g.longitude].join('|');
    // A sheet that holds several complexes also needs the complex in the id ("Torre 1" repeats).
    const scope = cand.barrio ? `${slug(parse.sheet)}-${slug(cand.barrio)}` : slug(parse.sheet);
    const baseId = `${fuente}-${scope}-${cand.tipo}-${slug(cand.nombre)}`;
    if (seenKeys.has(dupKey)) {
      invalid.push({
        reason: 'duplicado_exacto',
        explanation: `Mismo nombre, tipo y coordenadas que ${seenKeys.get(dupKey)} en la misma hoja.`,
        fuente,
        sheet: parse.sheet,
        barrio: g.barrio,
        tipo: cand.tipo,
        nombre: cand.nombre,
        coordRaw: g.coordRaw,
        source: { file: source.file, sheet: parse.sheet, cell: cand.cell, row: cand.row },
      });
      continue;
    }
    const n = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, n);
    const id = n === 1 ? baseId : `${baseId}-${n}`;
    seenKeys.set(dupKey, id);
    references.push({
      id,
      tipo: cand.tipo,
      barrio: g.barrio,
      ...(parse.zona ? { zona: parse.zona } : {}),
      nombre: cand.nombre,
      ...(cand.direccion ? { direccion: cand.direccion } : {}),
      ...(cand.descripcion ? { descripcion: cand.descripcion } : {}),
      aliases: cand.aliases,
      latitude: g.latitude,
      longitude: g.longitude,
      coordRaw: g.coordRaw,
      ...(cand.marca ? { marca: uniqueMarca(cand.marca) } : {}),
      ...(Object.keys(cand.detalles).length ? { detalles: cand.detalles } : {}),
      source: { file: source.file, sheet: parse.sheet, cell: cand.cell, row: cand.row },
    });
  }

  for (const { sheet, block } of strayBlocks) {
    invalid.push({
      reason: 'bloque_huerfano_duplicado',
      explanation: `Fila repetida ${block.occurrences.toLocaleString('es-AR')} veces fuera de la zona de datos (desde la fila ${block.firstRow}), sin encabezado ni sección. No se importa.`,
      fuente,
      sheet,
      extra: { firma: block.signature, ocurrencias: block.occurrences, primeraFila: block.firstRow },
    });
  }

  // --- Warnings: far from the rest of its own sheet (kept, flagged) -------------
  const warnings: Warning[] = [];
  const bySheet = new Map<string, Reference[]>();
  for (const r of references) bySheet.set(r.source.sheet, [...(bySheet.get(r.source.sheet) ?? []), r]);
  for (const [sheet, refs] of bySheet) {
    if (refs.length < 3) continue;
    const mLat = median(refs.map((r) => r.latitude));
    const mLon = median(refs.map((r) => r.longitude));
    for (const r of refs) {
      const km = haversineKm(mLat, mLon, r.latitude, r.longitude);
      if (km > FAR_FROM_SHEET_KM) {
        warnings.push({
          reason: 'lejos_del_resto_de_la_hoja',
          explanation: `Está a ${km.toFixed(1)} km del centro del resto de los puntos de su hoja (límite ${FAR_FROM_SHEET_KM} km). Puede ser correcto, pero conviene verificarlo.`,
          fuente,
          sheet,
          barrio: r.barrio,
          nombre: r.nombre,
          coordRaw: r.coordRaw,
          cell: r.source.cell,
          km: Number(km.toFixed(2)),
        });
      }
    }
  }

  return {
    sourceId: fuente,
    sourceFile: source.file,
    sheets: reports,
    references,
    invalid,
    warnings,
    orphanCells,
    strayBlocks,
    candidateCount,
    geo: { medianLat, medianLon, outliers },
    ...analyzeAmbiguity(references),
  };
}

export type { Cell };
