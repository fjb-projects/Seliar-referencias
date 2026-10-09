import type { RefTipo } from '../../src/lib/types';
import { parseCoordinate } from './coords';
import type { Cell } from './workbook';
import { colLetter } from './workbook';

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** One item found in a sheet, before coordinate validation. */
export interface Candidate {
  tipo: RefTipo;
  nombre: string;
  direccion?: string;
  descripcion?: string;
  aliases: string[];
  /** Cell texts that parse as a valid coordinate. */
  coordTexts: string[];
  /** Text sitting in the coordinate slot that is not a coordinate (an address, a place name). */
  slotText?: string;
  marca?: string;
  /** Title of the block when a sheet holds several complexes side by side; else the sheet title applies. */
  barrio?: string;
  detalles: Record<string, string>;
  /** Cell that carries (or should carry) the coordinate. */
  cell: string;
  row: number;
}

export interface SheetParse {
  sheet: string;
  titulo: string;
  tituloFromSheetName: boolean;
  zona?: string;
  info: Record<string, string>;
  candidates: Candidate[];
  orphans: Cell[];
  anchors: { calles: number; referencias: number; info: number; grids: number; tablas: number };
}

const PLACEHOLDER_ALIAS = /^no tiene ning[uú]n nombre$|^pje sin nombre$/i;
const LOC_LABEL = /^(ubicacion|ubicacion por coordinadas|cordinadas|coordenadas?)$/;
/** Row markers used by the workbook's authors. "c" dominates; the rest are preserved as-is. */
const MARKER = /^(c|ç|v|ver)$/i;
const ADDRESS_LABELS = [
  'direccion',
  'torre sobre',
  'monoblokc sobre',
  'monoblock sobre',
  'casas sobre',
  'sobre',
  'calle ingreso',
  'complejo sobre',
  'ingresos',
];

class Grid {
  private byKey = new Map<number, Cell>();
  private consumed = new Set<number>();
  constructor(cells: Cell[]) {
    for (const c of cells) this.byKey.set(c.row * 1000 + c.col, c);
  }
  cell(r: number, c: number): Cell | undefined {
    return this.byKey.get(r * 1000 + c);
  }
  text(r: number, c: number): string {
    return this.byKey.get(r * 1000 + c)?.text ?? '';
  }
  mark(r: number, c: number) {
    if (this.byKey.has(r * 1000 + c)) this.consumed.add(r * 1000 + c);
  }
  isConsumed(r: number, c: number): boolean {
    return this.consumed.has(r * 1000 + c);
  }
  /** Reads a cell and marks it as accounted for. */
  take(r: number, c: number): string {
    this.mark(r, c);
    return this.text(r, c);
  }
  /** Consumes up to two consecutive marker cells starting at (r, c) and returns them joined. */
  takeMarkers(r: number, c: number): string | undefined {
    const found: string[] = [];
    for (let i = 0; i < 2; i++) {
      const t = this.text(r, c + i);
      if (!MARKER.test(t)) break;
      this.mark(r, c + i);
      found.push(t);
    }
    return found.length ? found.join(' ') : undefined;
  }
  all(): Cell[] {
    return [...this.byKey.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  }
  find(pred: (normText: string, cell: Cell) => boolean): Cell[] {
    return this.all().filter((c) => pred(norm(c.text), c));
  }
  orphans(): Cell[] {
    return this.all().filter((c) => !this.consumed.has(c.row * 1000 + c.col));
  }
  rowHasAny(r: number, c1: number, c2: number): boolean {
    for (let c = c1; c <= c2; c++) if (this.byKey.has(r * 1000 + c)) return true;
    return false;
  }
}

function inferTipo(...hints: string[]): RefTipo {
  for (const h of hints) {
    const n = norm(h);
    if (/torre/.test(n)) return 'torre';
    if (/monob/.test(n)) return 'monoblock';
    if (/manzana/.test(n)) return 'manzana';
    if (/casa/.test(n)) return 'casa';
  }
  return 'otro';
}

export function parseSheet(sheet: string, cells: Cell[]): SheetParse {
  const g = new Grid(cells);
  const candidates: Candidate[] = [];
  const anchors = { calles: 0, referencias: 0, info: 0, grids: 0, tablas: 0 };

  // --- Title (row 1) -------------------------------------------------------
  const titleCell = g.all().find((c) => c.row === 1);
  let titulo = sheet;
  let tituloFromSheetName = true;
  const titles = g.all().filter((c) => c.row === 1);
  if (titleCell) {
    titulo = titleCell.text;
    tituloFromSheetName = false;
    for (const c of titles) g.mark(c.row, c.col);
  }
  // Several different row-1 titles = several complexes in one sheet (e.g. "Torres en el puerto").
  const multiTitle = new Set(titles.map((c) => norm(c.text))).size > 1;
  const titleFor = (from: number, to: number): string | undefined => {
    if (!multiTitle) return undefined;
    const inside = titles.find((c) => c.col >= from && c.col <= to);
    if (inside) return inside.text;
    return titles.filter((c) => c.col < from).sort((a, b) => b.col - a.col)[0]?.text;
  };

  // --- Sector titles ("SECTOR TORRES", "Sector Casas") -----------------------
  const sectors = g.find((n) => /^sector\b/.test(n));
  for (const s of sectors) g.mark(s.row, s.col);

  // --- Información General ---------------------------------------------------
  const info: Record<string, string> = {};
  let zona: string | undefined;
  for (const a of g.find((n) => n === 'informacion general')) {
    anchors.info++;
    g.mark(a.row, a.col);
    let emptyStreak = 0;
    for (let r = a.row + 1; r <= a.row + 10; r++) {
      const labelCell = g.cell(r, a.col);
      const label = labelCell ? norm(labelCell.text) : '';
      if (!label) {
        if (++emptyStreak >= 2) break;
        continue;
      }
      if (label === 'referencias propias y cercanas' || label.startsWith('sector') || label.startsWith('calles')) break;
      emptyStreak = 0;
      g.mark(r, a.col);
      // Some sheets shift the value one column to the right (value in C instead of B).
      let valueCol = a.col + 1;
      if (!g.text(r, valueCol) && g.text(r, valueCol + 1) && !MARKER.test(g.text(r, valueCol + 1))) valueCol++;
      const valueCell = g.cell(r, valueCol);
      const value = g.take(r, valueCol);
      const marca = g.takeMarkers(r, valueCol + 1);
      if (label === 'ubicacion general') {
        const coord = parseCoordinate(value);
        candidates.push({
          tipo: 'barrio',
          nombre: titulo,
          aliases: [],
          coordTexts: coord.ok ? [value] : [],
          slotText: coord.ok || value === '' ? undefined : value,
          marca,
          detalles: {},
          cell: valueCell?.address ?? `${colLetter(valueCol)}${r}`,
          row: r,
        });
      } else if (value !== '') {
        info[labelCell!.text] = value;
        if (label === 'barrio') zona = value;
      }
    }
  }

  // --- Street blocks ------------------------------------------------------
  for (const h of g.find((n) => n.startsWith('calles de '))) {
    g.mark(h.row, h.col);
    let hdr: Cell | undefined;
    for (let r = h.row + 1; r <= h.row + 2 && !hdr; r++) {
      for (let c = h.col - 1; c <= h.col + 2 && !hdr; c++) {
        const cell = g.cell(r, c);
        if (cell && norm(cell.text) === 'sobre calle') hdr = cell;
      }
    }
    if (!hdr) continue; // left unconsumed on purpose; reported as orphan
    anchors.calles++;
    const c0 = hdr.col;
    for (let i = 0; i < 3; i++) g.mark(hdr.row, c0 + i);
    for (let r = hdr.row + 1; r < hdr.row + 200; r++) {
      const label = g.text(r, c0);
      const coord = g.text(r, c0 + 1);
      const alias = g.text(r, c0 + 2);
      if (!label && !coord && !alias) break;
      // A row holding only markers (typed into the data columns by mistake) is not a street: leave it as orphans.
      if ([label, coord, alias].filter(Boolean).every((t) => MARKER.test(t))) continue;
      g.mark(r, c0);
      g.mark(r, c0 + 1);
      g.mark(r, c0 + 2);
      const marca = g.takeMarkers(r, c0 + 3);
      const parsed = parseCoordinate(coord);
      const detalles: Record<string, string> = { sentido: h.text };
      if (alias) detalles['En Google Maps figura como'] = alias;
      candidates.push({
        tipo: 'calle',
        nombre: label || alias || '(sin nombre)',
        direccion: label.replace(/^sobre\s+/i, '') || undefined,
        aliases: alias && !PLACEHOLDER_ALIAS.test(alias) ? [alias] : [],
        coordTexts: parsed.ok ? [coord] : [],
        slotText: parsed.ok || coord === '' ? undefined : coord,
        marca,
        detalles,
        cell: `${colLetter(c0 + 1)}${r}`,
        row: r,
      });
    }
  }

  // --- Referencias Propias y Cercanas -----------------------------------------
  for (const a of g.find((n) => n === 'referencias propias y cercanas')) {
    anchors.referencias++;
    g.mark(a.row, a.col);
    // The list may start after up to two blank rows; once started, a blank row ends it.
    let started = false;
    for (let r = a.row + 1; r < a.row + 300; r++) {
      const name = g.text(r, a.col);
      const value = g.text(r, a.col + 1);
      if (!name && !value) {
        if (started || r > a.row + 2) break;
        continue;
      }
      started = true;
      g.mark(r, a.col);
      g.mark(r, a.col + 1);
      if (norm(name) === 'lugar' && norm(value) === 'coordinada') continue; // sub-header row
      const marca = g.takeMarkers(r, a.col + 2);
      const parsed = parseCoordinate(value);
      candidates.push({
        tipo: 'referencia',
        nombre: name || '(sin nombre)',
        aliases: [],
        coordTexts: parsed.ok ? [value] : [],
        slotText: parsed.ok || value === '' ? undefined : value,
        marca,
        detalles: {},
        cell: `${colLetter(a.col + 1)}${r}`,
        row: r,
      });
    }
  }

  // --- Grid blocks (torres / monoblocks / manzanas / casas) --------------------
  const locCells = g.find((n) => LOC_LABEL.test(n));
  const blocks = new Map<string, { c: number; top: number; headerRow: number | null; locRows: number[]; nextLabelCol: number }>();
  for (const lc of locCells) {
    // Walk up over other location rows of the same column (e.g. "Ubicacion" then "Cordinadas").
    let top = lc.row;
    while (LOC_LABEL.test(norm(g.text(top - 1, lc.col)))) top--;
    const nextLabelCol =
      locCells.filter((o) => o.row === lc.row && o.col > lc.col).map((o) => o.col).sort((x, y) => x - y)[0] ?? 1000;
    let headerRow: number | null = null;
    for (let hr = top - 1; hr >= Math.max(1, top - 2); hr--) {
      if (g.rowHasAny(hr, lc.col + 1, nextLabelCol - 1)) {
        headerRow = hr;
        break;
      }
    }
    const key = `${lc.col}:${top}`;
    const entry = blocks.get(key) ?? { c: lc.col, top, headerRow, locRows: [], nextLabelCol };
    entry.locRows.push(lc.row);
    blocks.set(key, entry);
  }

  for (const block of blocks.values()) {
    anchors.grids++;
    const c = block.c;
    const firstLocRow = Math.min(...block.locRows);
    const colMax = block.nextLabelCol - 1;
    const headerAt = (cc: number) => (block.headerRow != null ? g.text(block.headerRow, cc) : '');

    // Item columns: header cells plus non-marker cells of the location rows.
    const itemCols = new Set<number>();
    if (block.headerRow != null) {
      for (const cell of g.all()) {
        if (cell.row === block.headerRow && cell.col > c && cell.col <= colMax) itemCols.add(cell.col);
      }
    }
    for (const lr of block.locRows) {
      for (const cell of g.all()) {
        if (cell.row !== lr || cell.col <= c || cell.col > colMax) continue;
        if (MARKER.test(cell.text) && !headerAt(cell.col)) continue;
        itemCols.add(cell.col);
      }
    }
    const cols = [...itemCols].sort((x, y) => x - y);
    if (cols.length === 0) continue;

    interface AttrRow {
      label: string;
      norm: string;
      row: number;
      values: Map<number, string>;
      extra: { row: number; col: number; text: string }[];
    }
    const attrRows: AttrRow[] = [];
    const markerByCol = new Map<number, string>();
    const addMarker = (cc: number, text: string) =>
      markerByCol.set(cc, markerByCol.has(cc) ? `${markerByCol.get(cc)} ${text}` : text);
    let emptyStreak = 0;
    for (let r = firstLocRow; r <= firstLocRow + 16; r++) {
      const labelCell = g.cell(r, c);
      const labelNorm = labelCell ? norm(labelCell.text) : '';
      if (
        r > firstLocRow &&
        labelNorm &&
        (labelNorm.startsWith('sector') || labelNorm === 'referencias propias y cercanas' || labelNorm === 'informacion general')
      )
        break;

      // Marker cells that sit right after an item column (outside the item set).
      for (const cc of cols) {
        const t = g.text(r, cc + 1);
        if (!itemCols.has(cc + 1) && cc + 1 <= colMax && MARKER.test(t)) {
          g.mark(r, cc + 1);
          addMarker(cc, t);
        }
      }

      const rowHasItems = g.rowHasAny(r, cols[0], cols[cols.length - 1]);
      if (!labelNorm && !rowHasItems) {
        if (++emptyStreak >= 2) break;
        continue;
      }
      emptyStreak = 0;
      if (!labelNorm) {
        const vals = cols.filter((cc) => g.text(r, cc));
        if (vals.length > 0 && vals.every((cc) => MARKER.test(g.text(r, cc)))) {
          for (const cc of vals) {
            addMarker(cc, g.take(r, cc));
          }
        } else if (attrRows.length > 0) {
          // Continuation of the label above (e.g. several "Ingresos" for one monoblock).
          const last = attrRows[attrRows.length - 1];
          for (const cc of vals) {
            const t = g.text(r, cc);
            if (MARKER.test(t)) addMarker(cc, g.take(r, cc));
            else last.extra.push({ row: r, col: cc, text: t });
          }
        }
        continue;
      }
      g.mark(r, c);
      const values = new Map<number, string>();
      for (const cc of cols) {
        const t = g.text(r, cc);
        if (t) values.set(cc, t);
      }
      attrRows.push({ label: labelCell!.text, norm: labelNorm, row: r, values, extra: [] });
    }

    // Section title: an explicit "SECTOR ..." row, else the nearest plain title above the block.
    const topRow = block.headerRow ?? firstLocRow;
    let sectorText = sectors
      .filter((s) => s.row < firstLocRow && s.col <= cols[0])
      .sort((a, b) => b.row - a.row || b.col - a.col)[0]?.text.trim();
    if (!sectorText) {
      const ctx = g
        .all()
        .filter(
          (cell) =>
            cell.row < topRow &&
            cell.row >= topRow - 3 &&
            cell.col >= c &&
            cell.col <= cols[0] &&
            !g.isConsumed(cell.row, cell.col) &&
            !MARKER.test(cell.text) &&
            !parseCoordinate(cell.text).ok,
        )
        .sort((a, b) => b.row - a.row || b.col - a.col)[0];
      if (ctx) {
        g.mark(ctx.row, ctx.col);
        sectorText = ctx.text.trim();
      }
    }
    sectorText ??= '';

    // Names, disambiguated by position when the header repeats ("Monoblokc" x5).
    const headerCounts = new Map<string, number>();
    for (const cc of cols) {
      const h = norm(headerAt(cc));
      if (h) headerCounts.set(h, (headerCounts.get(h) ?? 0) + 1);
    }
    const ordinals = new Map<string, number>();

    for (const cc of cols) {
      const hdrRaw = headerAt(cc);
      if (block.headerRow != null) {
        g.mark(block.headerRow, cc);
        g.mark(block.headerRow, c);
      }
      const hdrNorm = norm(hdrRaw);
      let nombre: string;
      if (hdrRaw) {
        if ((headerCounts.get(hdrNorm) ?? 0) > 1) {
          const n = (ordinals.get(hdrNorm) ?? 0) + 1;
          ordinals.set(hdrNorm, n);
          nombre = `${hdrRaw.trim()} ${n}`;
        } else nombre = hdrRaw.trim();
      } else {
        const n = (ordinals.get('__nohdr') ?? 0) + 1;
        ordinals.set('__nohdr', n);
        nombre = `${sectorText.replace(/^sector\s+/i, '') || 'Item'} ${n}`.trim();
      }

      const coordTexts: string[] = [];
      let slotText: string | undefined;
      const detalles: Record<string, string> = {};
      let direccion: string | undefined;
      const descParts: string[] = [];
      let coordCell: Cell | undefined;
      let anyText = false;

      for (const ar of attrRows) {
        let v = ar.values.get(cc);
        for (const ex of ar.extra) {
          if (ex.col !== cc) continue;
          g.mark(ex.row, ex.col);
          v = v ? `${v} / ${ex.text}` : ex.text;
        }
        if (!v) continue;
        g.mark(ar.row, cc);
        anyText = true;
        const isLoc = LOC_LABEL.test(ar.norm);
        if (parseCoordinate(v).ok) {
          if (!coordTexts.includes(v)) coordTexts.push(v);
          coordCell ??= g.cell(ar.row, cc);
          continue;
        }
        if (isLoc && slotText === undefined) slotText = v;
        detalles[ar.label.trim()] = v;
        if (ADDRESS_LABELS.includes(ar.norm) && !direccion) direccion = v;
        else if (/^limite /.test(ar.norm) || ar.norm.startsWith('referencias')) descParts.push(`${ar.label.trim()}: ${v}`);
        else if (ar.norm === 'trayecto desde el ingreso' || ar.norm === 'otros' || ar.norm === 'escaleras') {
          descParts.push(ar.norm === 'escaleras' ? `Escaleras: ${v}` : v);
        }
      }
      if (!anyText && !hdrRaw) continue;
      // Text in the "Ubicacion" slot of an item that also has a real coordinate is an address.
      if (!direccion && coordTexts.length && slotText) direccion = slotText;
      candidates.push({
        tipo: inferTipo(hdrRaw, sectorText, nombre),
        nombre,
        direccion,
        descripcion: descParts.length ? descParts.join(' · ') : undefined,
        aliases: [],
        coordTexts,
        slotText: coordTexts.length ? undefined : slotText,
        marca: markerByCol.get(cc),
        barrio: titleFor(c, colMax),
        detalles,
        cell: coordCell?.address ?? `${colLetter(cc)}${block.locRows[0]}`,
        row: coordCell?.row ?? block.locRows[0],
      });
    }
  }

  // --- Free tables: name | address | "Coordinada" (e.g. house ranges in Las Flores I) ---
  for (const h of g.find((n, cell) => n === 'coordinada' && !g.isConsumed(cell.row, cell.col))) {
    if (h.col < 3) continue;
    anchors.tablas++;
    g.mark(h.row, h.col);
    const nameCol = h.col - 2;
    const addrCol = h.col - 1;
    const sector = sectors
      .filter((s) => s.row <= h.row && s.col <= h.col)
      .sort((a, b) => b.row - a.row || b.col - a.col)[0]?.text;
    for (let r = h.row + 1; r < h.row + 300; r++) {
      const name = g.text(r, nameCol);
      const addr = g.text(r, addrCol);
      const coord = g.text(r, h.col);
      if (!name && !addr && !coord) break;
      g.mark(r, nameCol);
      g.mark(r, addrCol);
      g.mark(r, h.col);
      const marca = g.takeMarkers(r, h.col + 1);
      const parsed = parseCoordinate(coord);
      candidates.push({
        tipo: inferTipo(sector ?? ''),
        nombre: name || addr || '(sin nombre)',
        direccion: addr || undefined,
        aliases: [],
        coordTexts: parsed.ok ? [coord] : [],
        slotText: parsed.ok || coord === '' ? undefined : coord,
        marca,
        detalles: sector ? { sector: sector.trim() } : {},
        cell: `${colLetter(h.col)}${r}`,
        row: r,
      });
    }
  }

  return { sheet, titulo, tituloFromSheetName, zona, info, candidates, orphans: g.orphans(), anchors };
}
