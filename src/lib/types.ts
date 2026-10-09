export type RefTipo =
  | 'barrio'
  | 'referencia'
  | 'calle'
  | 'torre'
  | 'monoblock'
  | 'manzana'
  | 'casa'
  | 'otro';

export interface RefSource {
  /** Workbook the record was imported from. */
  file: string;
  sheet: string;
  /** A1-style address of the cell holding the coordinate (or the item's main cell). */
  cell: string;
  row: number;
}

export interface Reference {
  /** Deterministic id: sheet slug + tipo + name slug (+ suffix on collisions). */
  id: string;
  tipo: RefTipo;
  /** Barrio / sector title exactly as written in the sheet's title row. */
  barrio: string;
  /** Neighbourhood in which the complex sits (the sheet's "Barrio" field), if filled. */
  zona?: string;
  nombre: string;
  direccion?: string;
  descripcion?: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  /** Coordinate cell text exactly as stored in the workbook. */
  coordRaw: string;
  /**
   * Marker text found next to the item in the workbook ("c", "ver", "v", "ç"...).
   * Its meaning is undocumented, so it is preserved verbatim; absent when the row has none.
   */
  marca?: string;
  /** Any other labelled text found for the item (label -> text). */
  detalles?: Record<string, string>;
  source: RefSource;
}

export interface CatalogSource {
  id: string;
  file: string;
  count: number;
}

export interface ReferenceCatalog {
  version: 1;
  generatedAt: string;
  sources: CatalogSource[];
  count: number;
  references: Reference[];
}
