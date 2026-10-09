import ExcelJS from 'exceljs';

/** Rows beyond this are treated as stray content (see "Santa Rita 1": 860k pasted rows). */
export const MAX_ROW = 300;

export interface Cell {
  text: string;
  row: number;
  col: number;
  address: string;
}

export interface StrayBlock {
  /** Text cells of a row found beyond MAX_ROW, e.g. "R464=Pje Roca 5800 | T464=-31.5, -60.7". */
  signature: string;
  occurrences: number;
  firstRow: number;
  firstCells: Cell[];
}

export interface SheetData {
  name: string;
  state: string;
  declaredRows: number;
  declaredCols: number;
  merges: number;
  images: number;
  formulas: number;
  hyperlinks: number;
  notes: number;
  numericCells: number;
  cells: Cell[];
  /** Non-empty cells beyond MAX_ROW. */
  strayCellCount: number;
  strayRowCount: number;
  strayBlocks: StrayBlock[];
}

export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellText(cell: ExcelJS.Cell): { text: string; kind: 'text' | 'number' | 'formula' | 'link' | 'other' } {
  const v = cell.value as unknown;
  if (v == null) return { text: '', kind: 'other' };
  if (typeof v === 'string') return { text: v, kind: 'text' };
  if (typeof v === 'number') return { text: String(v), kind: 'number' };
  if (typeof v === 'boolean') return { text: String(v), kind: 'other' };
  if (v instanceof Date) return { text: v.toISOString(), kind: 'other' };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) {
      const result = o.result;
      return { text: result == null ? '' : String(result), kind: 'formula' };
    }
    if ('richText' in o) {
      return { text: (o.richText as { text: string }[]).map((r) => r.text).join(''), kind: 'text' };
    }
    if ('hyperlink' in o) return { text: String(o.text ?? ''), kind: 'link' };
    if ('error' in o) return { text: '', kind: 'other' };
  }
  return { text: String(v), kind: 'other' };
}

/**
 * Reads every sheet into a plain list of non-empty cells. Merged-cell followers
 * are skipped: ExcelJS repeats the master value in them, which would otherwise
 * look like dozens of duplicated titles.
 */
export async function readWorkbook(file: string): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out: SheetData[] = [];

  for (const ws of wb.worksheets) {
    const sheet: SheetData = {
      name: ws.name,
      state: ws.state,
      declaredRows: ws.rowCount,
      declaredCols: ws.columnCount,
      merges: Object.keys((ws as unknown as { _merges?: object })._merges ?? {}).length,
      images: ws.getImages().length,
      formulas: 0,
      hyperlinks: 0,
      notes: 0,
      numericCells: 0,
      cells: [],
      strayCellCount: 0,
      strayRowCount: 0,
      strayBlocks: [],
    };
    const strayBySignature = new Map<string, StrayBlock>();

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowCells: Cell[] = [];
      row.eachCell({ includeEmpty: false }, (c, colNumber) => {
        if (c.isMerged && c.master.address !== c.address) return;
        const { text, kind } = cellText(c);
        if (kind === 'formula') sheet.formulas++;
        if (kind === 'link') sheet.hyperlinks++;
        if (kind === 'number') sheet.numericCells++;
        if (c.note) sheet.notes++;
        const trimmed = text.replace(/ /g, ' ').trim();
        if (trimmed === '') return;
        rowCells.push({ text: trimmed, row: rowNumber, col: colNumber, address: c.address });
      });
      if (rowCells.length === 0) return;

      if (rowNumber > MAX_ROW) {
        sheet.strayRowCount++;
        sheet.strayCellCount += rowCells.length;
        // Signature ignores the row number so repeated pastes collapse into one entry.
        const signature = rowCells.map((c) => `${colLetter(c.col)}=${c.text}`).join(' | ');
        const known = strayBySignature.get(signature);
        if (known) known.occurrences++;
        else {
          const block: StrayBlock = { signature, occurrences: 1, firstRow: rowNumber, firstCells: rowCells };
          strayBySignature.set(signature, block);
          sheet.strayBlocks.push(block);
        }
        return;
      }
      sheet.cells.push(...rowCells);
    });

    out.push(sheet);
  }
  return out;
}
