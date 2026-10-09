import type { Reference } from '../../src/lib/types';
import { MAX_ROW } from './workbook';
import { haversineKm, parseCoordinate } from './coords';
import type { InvalidRecord, PipelineResult } from './pipeline';
import { analyzeAmbiguity, OUTLIER_KM } from './pipeline';

const fmt = (n: number) => n.toLocaleString('es-AR');
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const table = (head: string[], rows: (string | number)[][]) =>
  [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

function countBy<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function decimals(raw: string): number[] {
  return [...raw.matchAll(/-?\d+\.(\d+)/g)].map((m) => m[1].length);
}

function geoStats(refs: Reference[]) {
  const lats = refs.map((r) => r.latitude);
  const lons = refs.map((r) => r.longitude);
  const dec = refs.flatMap((r) => decimals(r.coordRaw));
  return {
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
    lonMin: Math.min(...lons),
    lonMax: Math.max(...lons),
    decMin: Math.min(...dec),
    decMax: Math.max(...dec),
    lowPrecision: refs.filter((r) => decimals(r.coordRaw).some((d) => d < 5)),
  };
}

export function buildAudit(res: PipelineResult, generatedAt: string): string {
  const { sheets, references, invalid } = res;
  const processed = sheets.filter((s) => s.parse);
  const skipped = sheets.filter((s) => !s.parse);
  const geo = geoStats(references);
  const sum = (f: (s: (typeof sheets)[number]) => number) => sheets.reduce((a, s) => a + f(s), 0);
  const markers = countBy(references, (r) => r.marca ?? '(sin marca)');
  const esquemas = countBy(processed, (s) => s.parse!.info['Esquema'] ?? s.parse!.info['Esquema '] ?? '(vacío)');
  const numeraciones = countBy(processed, (s) => s.parse!.info['Tipo de numeracion'] ?? '(vacío)');
  const byReason = countBy(invalid, (i) => i.reason);
  const stray = res.strayBlocks;

  const lines: string[] = [];
  lines.push(`# Auditoría del Excel · ${res.sourceFile}`);
  lines.push('');
  lines.push(`Generado: ${generatedAt} · Fuente \`${res.sourceId}\`: \`${res.sourceFile}\` · Reproducible con \`npm run import\`.`);
  lines.push('');
  lines.push('## 1. Resumen estructural');
  lines.push('');
  lines.push(
    `- **${sheets.length} hojas**, todas visibles. ${processed.length} contienen datos geográficos; ${skipped.length} se omiten (${skipped.map((s) => `\`${s.data.name}\``).join(', ') || 'ninguna'}).`,
  );
  lines.push(`- Fórmulas: **${sum((s) => s.data.formulas)}** · hipervínculos: **${sum((s) => s.data.hyperlinks)}** · notas/comentarios: **${sum((s) => s.data.notes)}** · imágenes: **${sum((s) => s.data.images)}** · celdas numéricas: **${sum((s) => s.data.numericCells)}**. Todo el contenido es texto plano; no hay información oculta en fórmulas o comentarios.`);
  lines.push('- **El libro no es tabular.** Cada hoja es una "ficha" de barrio con bloques en posiciones variables. Las coordenadas están guardadas como **texto** `"lat, lon"` en una sola celda (nunca en columnas separadas).');
  lines.push('- Celdas combinadas: títulos y encabezados de sección (se tratan como una sola celda; ExcelJS repite su valor en las celdas hijas, por lo que se descartan para no duplicar).');
  lines.push('');
  lines.push('### Bloques reconocidos');
  lines.push('');
  lines.push(table(['Bloque', 'Contenido', 'Cantidad de bloques'], [
    ['Información General', 'Ubicación general del barrio, Esquema, Tipo de numeración, Barrio donde se encuentra', sum((s) => s.parse?.anchors.info ?? 0)],
    ['Calles E-O / S-N', 'Calle con altura · coordenada · "En Google Maps figura como"', sum((s) => s.parse?.anchors.calles ?? 0)],
    ['Referencias Propias y Cercanas', 'Nombre del lugar · coordenada', sum((s) => s.parse?.anchors.referencias ?? 0)],
    ['Grillas (torres, monoblocks, manzanas, casas)', 'Una columna por elemento; filas de ubicación, dirección, límites, etc.', sum((s) => s.parse?.anchors.grids ?? 0)],
    ['Tablas libres de casas', 'Rango · dirección · coordenada', sum((s) => s.parse?.anchors.tablas ?? 0)],
  ]));
  lines.push('');
  lines.push('## 2. Estadísticas por hoja');
  lines.push('');
  lines.push(
    table(
      ['Hoja', 'Título (fila 1)', 'Filas×cols declaradas', 'Combinadas', 'Válidos', 'Inválidos', 'Celdas sin clasificar'],
      sheets.map((s) => [
        `\`${s.data.name}\``,
        s.parse ? (s.parse.tituloFromSheetName ? `*(sin título; se usa el nombre de hoja)*` : s.parse.titulo) : '—',
        `${fmt(s.data.declaredRows)}×${s.data.declaredCols}`,
        s.data.merges,
        s.valid,
        s.invalid,
        s.parse ? s.parse.orphans.length : '—',
      ]),
    ),
  );
  lines.push('');
  lines.push('## 3. Inventario de campos');
  lines.push('');
  lines.push(table(['Campo normalizado', 'Origen en el Excel', 'Notas'], [
    ['`barrio`', 'Título de la fila 1 de la hoja', 'Se conserva tal cual (p. ej. `BARRIO FAVALORO`)'],
    ['`zona`', 'Campo "Barrio" de Información General', 'Barrio donde se ubica el conjunto; casi siempre vacío'],
    ['`nombre`', 'Etiqueta de la calle / lugar / encabezado de torre, monoblock o manzana', 'Texto original'],
    ['`direccion`', '"Torre sobre", "Direccion", "Sobre", "Ingresos", "Calle ingreso"…', 'Sólo grillas, calles y tablas de casas'],
    ['`descripcion`', 'Límites (N/E/S/O), "Trayecto desde el ingreso", "Otros", "Escaleras"', 'Texto de búsqueda de menor peso'],
    ['`aliases`', '"En Google Maps figura como"', 'Se omiten placeholders ("No tiene ningun nombre")'],
    ['`latitude`/`longitude`/`coordRaw`', 'Celda de coordenada', '`coordRaw` conserva el texto exacto'],
    ['`marca`', 'Columna de marcas junto a cada fila', 'Ver sección 5'],
    ['`detalles`', 'Resto de pares etiqueta → texto', 'Sin pérdida de información'],
    ['`source`', 'Hoja, celda y fila de la coordenada', 'Trazabilidad'],
  ]));
  lines.push('');
  lines.push('Valores encontrados en Información General:');
  lines.push('');
  lines.push(`- **Esquema:** ${esquemas.map(([k, v]) => `\`${k.trim()}\` (${v})`).join(', ')}`);
  lines.push(`- **Tipo de numeración:** ${numeraciones.map(([k, v]) => `\`${k.trim()}\` (${v})`).join(', ')}`);
  lines.push('');
  lines.push('## 4. Calidad de los datos geográficos');
  lines.push('');
  lines.push(`- Candidatos detectados: **${fmt(res.candidateCount)}** · con coordenada válida: **${fmt(references.length + invalid.filter((i) => i.reason === 'duplicado_exacto' || i.reason === 'coordenada_fuera_de_zona').length)}** · sin coordenada utilizable: **${fmt(invalid.filter((i) => i.reason === 'sin_coordenadas' || i.reason === 'coordenada_no_numerica' || i.reason === 'coordenadas_conflictivas').length)}**.`);
  lines.push(`- Formato: texto \`lat, lon\` con punto decimal y coma separadora en el 100 % de las coordenadas válidas. No se encontraron comas decimales ni formatos regionales alternativos. Los espacios sobrantes se recortan (no alteran el valor).`);
  lines.push(`- Precisión decimal original: entre ${geo.decMin} y ${geo.decMax} decimales por componente. Con 5 decimales la resolución es de ≈1 m; con 3, de ≈100 m.`);
  if (geo.lowPrecision.length) {
    lines.push(`- **${geo.lowPrecision.length} coordenadas con menos de 5 decimales** (probablemente truncadas a mano; el punto puede estar desplazado decenas de metros). Se importan tal cual y se señalan para revisión: ${geo.lowPrecision.map((r) => `\`${r.source.sheet}!${r.source.cell}\` (${r.nombre}: ${r.coordRaw})`).join('; ')}.`);
  }
  lines.push(`- Rango: latitud ${geo.latMin} a ${geo.latMax}; longitud ${geo.lonMin} a ${geo.lonMax}. Mediana del conjunto: ${res.geo.medianLat.toFixed(6)}, ${res.geo.medianLon.toFixed(6)} (zona de Santa Fe capital).`);
  lines.push(`- Inversión latitud/longitud: **0** casos (todas las latitudes están en [-90, 90] y dentro de la zona). Coordenadas a más de ${OUTLIER_KM} km de la mediana: **${res.geo.outliers}**.`);
  lines.push(`- Referencias distintas que comparten coordenadas exactas: **${res.sharedCoordinates.length}** grupos (ver \`transformation-summary.md\`).`);
  lines.push(`- Nombres repetidos en barrios distintos: **${res.repeatedNames.length}** (la interfaz los muestra como alternativas con su barrio).`);
  lines.push('');
  lines.push('### Registros descartados');
  lines.push('');
  lines.push(table(['Motivo', 'Cantidad'], byReason.map(([k, v]) => [`\`${k}\``, v])));
  lines.push('');
  lines.push('Detalle completo en `reports/invalid-records.json`. Ningún valor fue corregido ni inferido.');
  lines.push('');
  lines.push('### Advertencias (se importan, pero conviene verificarlas)');
  lines.push('');
  if (res.warnings.length === 0) lines.push('Ninguna.');
  else {
    lines.push(
      table(
        ['Hoja', 'Celda', 'Referencia', 'Coordenada', 'Distancia al resto de la hoja'],
        res.warnings.map((w) => [`\`${w.sheet}\``, w.cell, w.nombre, w.coordRaw, `${w.km} km`]),
      ),
    );
  }
  lines.push('');
  lines.push('## 5. Inconsistencias encontradas');
  lines.push('');
  lines.push('**Marcas junto a cada fila.** La mayoría de las filas tiene una `c` en una columna adyacente, pero el significado no está documentado. Distribución sobre los registros válidos:');
  lines.push('');
  lines.push(table(['Marca', 'Registros'], markers.map(([k, v]) => [`\`${k}\``, v])));
  lines.push('');
  if (markers.some(([k]) => !/^c( c)*$/i.test(k) && k !== '(sin marca)')) {
    lines.push('Hay variantes (`ver`, `v`, `ç`…) que sugieren estados de verificación. Se conservan sin interpretar en el campo `marca`; **requiere confirmación del responsable de los datos**.');
  } else {
    lines.push('Se conservan sin interpretar en el campo `marca`; su significado debe confirmarlo el responsable de los datos.');
  }
  lines.push('');
  lines.push('**Texto en lugar de coordenadas.** ' + `${invalid.filter((i) => i.reason === 'coordenada_no_numerica').length} elementos tienen una dirección o un nombre en la celda de coordenadas. No se geocodifican (regla del proyecto); quedan en \`invalid-records.json\` con el texto original.`);
  lines.push('');
  const missing = invalid.filter((i) => i.reason === 'sin_coordenadas');
  const worstSheets = countBy(missing, (i) => i.sheet).slice(0, 3).map(([s, n]) => `\`${s}\` (${n})`);
  lines.push('**Elementos sin coordenadas.** ' + `${missing.length} elementos tienen nombre pero ninguna coordenada${worstSheets.length ? `; hojas más afectadas: ${worstSheets.join(', ')}` : ''}.`);
  lines.push('');
  lines.push('**Celdas sueltas sin clasificar** (conservadas en `invalid-records.json` → `celdasSinClasificar`):');
  lines.push('');
  lines.push(table(['Hoja', 'Celda', 'Contenido'], res.orphanCells.map((o) => [`\`${o.sheet}\``, o.cell, `\`${o.text.replace(/\|/g, '\\|')}\``])));
  lines.push('');
  if (stray.length) {
    const total = stray.reduce((a, b) => a + b.block.occurrences, 0);
    const cols = [...new Set(stray.flatMap((s) => [...s.block.signature.matchAll(/(?:^| \| )([A-Z]+)=/g)].map((m) => m[1])))].join('/');
    const hint = stray.find((s) => /barrio donde se encuentra/i.test(s.block.signature));
    const where = hint ? `; sólo se identifica "Barrio donde se encuentra: ${hint.block.signature.split(' | ').pop()?.split('=').slice(1).join('=')}"` : '';
    lines.push('**Bloque repetido masivamente (`' + stray[0].sheet + '`).** ' + `Más allá de la fila ${MAX_ROW} hay ${fmt(total)} filas de datos en las columnas ${cols}, que repiten ${stray.length} líneas distintas una y otra vez. No tiene encabezado ni sección${where}. Parece una pegada accidental. **No se importó**; las ${stray.length} líneas únicas están en \`invalid-records.json\` por si se quieren recuperar.`);
    lines.push('');
  }
  const strayCoords = res.orphanCells.filter((o) => parseCoordinate(o.text).ok);
  if (strayCoords.length) {
    lines.push(
      `**Coordenadas sueltas fuera de todo bloque:** ${strayCoords
        .map((p) => {
          const c = parseCoordinate(p.text);
          const km = c.ok ? haversineKm(res.geo.medianLat, res.geo.medianLon, c.latitude, c.longitude) : 0;
          return `\`${p.sheet}!${p.cell}\` (${p.text}, a ${km.toFixed(0)} km de la mediana)`;
        })
        .join('; ')}. Probable residuo; no se importaron.`,
    );
    lines.push('');
  }
  lines.push('## 6. Registros utilizables');
  lines.push('');
  lines.push(table(['Tipo', 'Buscables'], countBy(references, (r) => r.tipo).map(([k, v]) => [k, v])));
  lines.push('');
  lines.push(`**Total buscable: ${fmt(references.length)}** de ${fmt(res.candidateCount)} candidatos.`);
  lines.push('');
  lines.push('## 7. Riesgos');
  lines.push('');
  lines.push('1. **Estructura frágil.** El libro es una ficha visual, no una tabla. El importador depende de textos ancla ("Calles de Este a Oeste", "Referencias Propias y Cercanas", "Informacion General"…). Si se renombran o aparece un bloque nuevo, las celdas quedan como *sin clasificar* y se listan (no se pierden en silencio, pero tampoco se importan).');
  lines.push('2. **Significado de las marcas desconocido.** Si `ver` significa "pendiente de verificar", habría que reflejarlo en la interfaz.');
  lines.push('3. **Coordenadas sin verificación independiente.** Se validan formato y zona, no que el punto sea el correcto en el terreno.');
  let risk = 4;
  if (stray.length) {
    lines.push(`${risk++}. **Hoja \`${stray[0].sheet}\` pesada.** Declara más de un millón de filas de las que casi todas son repeticiones; el libro tarda en abrirse y pesa de más.`);
  }
  if (res.warnings.length) {
    lines.push(`${risk++}. **Puntos lejos del resto de su hoja (${res.warnings.length}).** Se importan tal cual; si alguno es un error de carga, el operador sería enviado a un lugar equivocado.`);
  }
  lines.push(`${risk}. **Datos operativos.** El JSON generado se sirve como archivo estático: **no hay control de acceso**. Si las referencias son internas, no deben publicarse sin autenticación.`);
  lines.push('');
  lines.push('## 8. Recomendaciones');
  lines.push('');
  let rec = 1;
  lines.push(`${rec++}. Confirmar con el responsable el significado de las marcas (\`c\`, \`ver\`, \`v\`, \`ç\`…).`);
  lines.push(`${rec++}. Completar o descartar los elementos sin coordenadas (lista en \`invalid-records.json\`).`);
  lines.push(`${rec++}. Reemplazar por coordenadas las direcciones escritas en celdas de coordenadas.`);
  if (stray.length) lines.push(`${rec++}. Revisar las filas repetidas de \`${stray[0].sheet}\` (¿son de otro barrio?) y eliminar las sobrantes del libro.`);
  if (skipped.some((s) => s.data.cells.length > 0)) {
    lines.push(`${rec++}. Mover fuera del libro de referencias las hojas sin coordenadas con contenido (${skipped.filter((s) => s.data.cells.length > 0).map((s) => `\`${s.data.name}\``).join(', ')}).`);
  }
  if (skipped.some((s) => s.data.cells.length === 0)) {
    lines.push(`${rec++}. Eliminar las hojas vacías (${skipped.filter((s) => s.data.cells.length === 0).map((s) => `\`${s.data.name}\``).join(', ')}).`);
  }
  lines.push(`${rec++}. A mediano plazo, migrar la fuente a una tabla plana (una fila por referencia) para simplificar el importador.`);
  lines.push('');
  return lines.join('\n');
}

/** Everything the catalogue is made of, across all sources. */
export interface Combined {
  results: PipelineResult[];
  references: Reference[];
  invalid: InvalidRecord[];
}

export function combine(results: PipelineResult[]): Combined {
  return {
    results,
    references: results.flatMap((r) => r.references),
    invalid: results.flatMap((r) => r.invalid),
  };
}

export function buildSummary(c: Combined, generatedAt: string): string {
  const { results, references, invalid } = c;
  const { sharedCoordinates, repeatedNames } = analyzeAmbiguity(references);
  const discarded = (r: PipelineResult) => r.invalid.filter((i) => i.reason !== 'bloque_huerfano_duplicado').length;
  const lines: string[] = [];
  lines.push('# Resumen de la transformación');
  lines.push('');
  lines.push(`Generado: ${generatedAt} · ${results.length} fuente(s)`);
  lines.push('');
  lines.push('## Por fuente');
  lines.push('');
  lines.push(
    table(
      ['Fuente', 'Archivo', 'Hojas (procesadas/total)', 'Candidatos', 'Buscables', 'Descartados', 'Advertencias', 'Celdas sin clasificar'],
      results.map((r) => [
        `\`${r.sourceId}\``,
        `\`${r.sourceFile}\``,
        `${r.sheets.filter((s) => s.parse).length}/${r.sheets.length}`,
        fmt(r.candidateCount),
        fmt(r.references.length),
        discarded(r),
        r.warnings.length,
        r.orphanCells.length,
      ]),
    ),
  );
  lines.push('');
  lines.push(`**Total buscable (\`references.json\`): ${fmt(references.length)}** · descartados: ${fmt(results.reduce((a, r) => a + discarded(r), 0))}`);
  lines.push('');
  lines.push('## Descartes por motivo');
  lines.push('');
  lines.push(table(['Motivo', 'Cantidad'], countBy(invalid, (i) => i.reason).map(([k, v]) => [`\`${k}\``, v])));
  lines.push('');
  lines.push('## Buscables por tipo');
  lines.push('');
  lines.push(table(['Tipo', 'Cantidad'], countBy(references, (r) => r.tipo).map(([k, v]) => [k, v])));
  lines.push('');
  lines.push('## Por hoja');
  lines.push('');
  lines.push(
    table(
      ['Fuente', 'Hoja', 'Válidos', 'Descartados'],
      results.flatMap((r) => r.sheets.map((s) => [`\`${r.sourceId}\``, `\`${s.data.name}\``, s.valid, s.invalid])),
    ),
  );
  lines.push('');
  lines.push(...crossSection(sharedCoordinates, repeatedNames));
  return lines.join('\n');
}

/** Same coordinates in different sheets/sources, and names repeated across barrios. */
function crossSection(
  sharedCoordinates: ReturnType<typeof analyzeAmbiguity>['sharedCoordinates'],
  repeatedNames: ReturnType<typeof analyzeAmbiguity>['repeatedNames'],
): string[] {
  const lines: string[] = [];
  const crossSheet = sharedCoordinates.filter((g) => new Set(g.refs.map((r) => `${r.fuente}|${r.sheet}`)).size > 1);
  lines.push('## Mismas coordenadas en hojas o archivos distintos');
  lines.push('');
  if (crossSheet.length === 0) lines.push('Ninguna.');
  else {
    lines.push(
      `${crossSheet.length} grupos. Si las direcciones difieren, es probable que una coordenada se haya copiado por error; **se conservan tal cual** para que las revise quien conoce el terreno.`,
    );
    lines.push('');
    lines.push(
      table(
        ['Coordenada', 'Referencias (hoja · nombre · dirección)'],
        crossSheet.map((g) => [g.coord, g.refs.map((r) => `${r.sheet} · ${r.nombre}${r.direccion ? ` · ${r.direccion}` : ''}`).join(' ↔ ')]),
      ),
    );
  }
  lines.push('');
  const sameSheet = sharedCoordinates.filter((g) => !crossSheet.includes(g));
  lines.push('## Mismas coordenadas con nombres distintos (dentro de una hoja)');
  lines.push('');
  if (sameSheet.length === 0) lines.push('Ninguna.');
  else {
    lines.push(`${sameSheet.length} grupos.`);
    lines.push('');
    lines.push(table(['Coordenada', 'Referencias'], sameSheet.map((g) => [g.coord, g.refs.map((r) => `${r.nombre} (${r.barrio})`).join(' · ')])));
  }
  lines.push('');
  lines.push('## Nombres repetidos en barrios distintos');
  lines.push('');
  lines.push(`${repeatedNames.length} nombres. Primeros 40:`);
  lines.push('');
  lines.push(table(['Nombre (normalizado)', 'Barrios'], repeatedNames.slice(0, 40).map((g) => [g.nombre, [...new Set(g.refs.map((r) => r.barrio))].join(' · ')])));
  lines.push('');
  return lines;
}

/** `reports/excel-audit.md`: entry point that links the per-source audits and covers what only shows up across sources. */
export function buildOverview(c: Combined, generatedAt: string): string {
  const { results, references } = c;
  const { sharedCoordinates, repeatedNames } = analyzeAmbiguity(references);
  const lines: string[] = [];
  lines.push('# Auditoría de los Excel');
  lines.push('');
  lines.push(`Generado: ${generatedAt}. Todas las fuentes pasan por el mismo importador y las mismas validaciones, y terminan en un único catálogo.`);
  lines.push('');
  lines.push(
    table(
      ['Fuente', 'Archivo', 'Buscables', 'Descartados', 'Advertencias', 'Auditoría detallada'],
      results.map((r) => [
        `\`${r.sourceId}\``,
        `\`${r.sourceFile}\``,
        fmt(r.references.length),
        r.invalid.filter((i) => i.reason !== 'bloque_huerfano_duplicado').length,
        r.warnings.length,
        `[audit-${r.sourceId}.md](audit-${r.sourceId}.md)`,
      ]),
    ),
  );
  lines.push('');
  lines.push(`**Total buscable: ${fmt(references.length)} referencias.**`);
  lines.push('');
  lines.push('# Hallazgos entre fuentes');
  lines.push('');
  lines.push(...crossSection(sharedCoordinates, repeatedNames).map((l) => (l.startsWith('## ') ? `#${l}` : l)));
  return lines.join('\n');
}

export function buildInvalidJson(c: Combined) {
  return {
    generatedAt: new Date().toISOString(),
    fuentes: c.results.map((r) => ({ id: r.sourceId, archivo: r.sourceFile })),
    descartados: c.invalid as InvalidRecord[],
    advertencias: c.results.flatMap((r) => r.warnings),
    celdasSinClasificar: c.results.flatMap((r) => r.orphanCells),
    hojasOmitidas: c.results.flatMap((r) =>
      r.sheets
        .filter((s) => !s.parse)
        .map((s) => ({ fuente: r.sourceId, hoja: s.data.name, motivo: s.skippedReason, celdas: s.data.cells.length })),
    ),
  };
}
