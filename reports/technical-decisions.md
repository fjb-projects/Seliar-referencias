# Decisiones técnicas

Todas las cifras de este documento salen de ejecuciones reales sobre el catálogo generado desde los dos Excel (1.062 referencias). Se reproducen con `npm run benchmark` y `npm test`.

## 1. Modelo de datos: JSON normalizado y estático ✅

| Dato | Valor medido |
| --- | --- |
| Registros buscables | 1.062 (Fonavis 1.030 + Torres 32) |
| `references.json` | 435 KB (46,8 KB comprimido con gzip) |
| Bundle JS de la app (React incluido) | 245,8 KB (77,6 KB gzip) |

Con ese volumen, un JSON cargado una vez al abrir la página es suficiente: no hace falta base de datos, backend ni índice precalculado. Se carga el catálogo completo en memoria del navegador y no hay solicitudes HTTP por consulta.

**Por qué el esquema difiere del ejemplo del enunciado.** El libro no es una tabla sino una ficha por barrio (ver `excel-audit.md`). Se agregaron:

- `tipo` (`barrio`, `referencia`, `calle`, `torre`, `monoblock`, `manzana`, `casa`, `otro`): permite filtrar y priorizar y ayuda a diferenciar homónimos.
- `zona`: barrio donde se ubica un conjunto (campo "Barrio" de Información General).
- `aliases`: "En Google Maps figura como" (no el placeholder "No tiene ningun nombre").
- `coordRaw`: texto exacto de la celda; `latitude`/`longitude` se derivan de él.
- `marca`: marca textual de la fila (`c`, `ver`, `ç`…). Su significado no está documentado, por eso se conserva sin interpretar.
- `detalles`: cualquier otro par etiqueta → texto, para no perder información.
- `source`: archivo, hoja, celda y fila de la coordenada.

**IDs.** `fuente-hoja-tipo-nombre` normalizado (en hojas con varios complejos, también el complejo), con sufijo `-2`, `-3`… ante colisiones. Son estables mientras no cambie el nombre ni la hoja; no dependen del orden de las filas, así que insertar una fila no renumera el resto (a diferencia de `ref-00001`).

## 2. Importación (una o varias fuentes)

- **Varias fuentes, un catálogo.** `data-sources.json` lista los libros; cada uno corre por el mismo parser y las mismas validaciones. Cada registro lleva `source.file` y su id empieza con el id de la fuente, así que agregar un libro no cambia los ids de los existentes y nunca colisionan.
- **Libros con varios complejos en una hoja** (`Torres en el puerto`: 7 complejos con título propio en la fila 1): cada bloque toma el título de su complejo como `barrio`, en vez de heredar el del primero.
- **Advertencias** (se importa, se señala): punto a más de 2 km del centro del resto de su hoja. Con los dos libros actuales marca 1 caso y 0 falsos positivos en Fonavis.
- **Coordenadas repetidas entre hojas/archivos** se reportan en `excel-audit.md`; no se descartan automáticamente porque pueden ser legítimas (el mismo lugar referenciado desde dos barrios).
- **Parser por secciones, no por columnas.** Se ubican bloques por texto ancla ("Calles de Este a Oeste", "Referencias Propias y Cercanas", "Informacion General", filas `Ubicacion…` de las grillas). Las variantes encontradas (continuaciones de "Ingresos", títulos de contexto sin "SECTOR", tablas de casas con encabezado "Coordinada", valores desplazados una columna) quedaron cubiertas por tests con fragmentos reales.
- **Nada se pierde en silencio.** Cada celda con contenido queda *consumida* por un registro o se lista como *sin clasificar*. Hoy son 9 celdas, todas documentadas.
- **Celdas combinadas.** ExcelJS repite el valor del maestro en las celdas hijas; se descartan para no duplicar títulos.
- **Filas más allá de la 300.** `Santa Rita 1` declara 1.048.576 filas y 860.949 de ellas son 23 líneas repetidas. Se aíslan en `invalid-records.json` en vez de importarse.
- **Validación geográfica.** Formato estricto `lat, lon` con punto decimal (coma decimal sólo con `;` como separador), rangos válidos y distancia a la mediana del conjunto (límite 25 km). Una coordenada fuera de zona no se corrige ni se invierte: se aparta con un motivo. Resultado actual: 0 fuera de zona.
- **Duplicados exactos** (misma hoja, tipo, nombre y coordenadas) se apartan; coordenadas iguales con nombres distintos se conservan y se reportan (5 grupos dentro de una hoja y 8 entre hojas o archivos distintos).
- **Texto donde debería haber coordenadas** (11 casos) no se geocodifica: queda en `invalid-records.json`.

## 3. Evaluación de motores de búsqueda

Medido con `npm run benchmark`, sobre las 1.062 referencias reales. Carga de trabajo: 2.905 consultas simulando el tecleo (prefijos crecientes de nombres reales). Relevancia: 38 casos del archivo `tests/gold.ts`, todos apuntando a registros reales.

| Motor | Peso (gzip) | Indexación | Memoria | p50 | p95 | máx | Relevancia |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Búsqueda nativa sobre array | 0 | 6,9 ms | 0,65 MB | 0,102 ms | 0,194 ms | 1,05 ms | 32/38 (0/6 en errores de tipeo) |
| MiniSearch (config básica) | 17,9 KB | 20,7 ms | 1,31 MB | 0,068 ms | 0,375 ms | 1,82 ms | 36/38 |
| Fuse.js | 9,0 KB | 5,3 ms | 0,57 MB | 21,4 ms | **69,0 ms** | **278,6 ms** | 33/38 |
| FlexSearch | 17,4 KB | 41,6 ms | 3,44 MB | 0,030 ms | 0,119 ms | 1,67 ms | 29/38 (1/6 en errores de tipeo) |
| **MiniSearch + ranking por niveles (elegido)** | 17,9 KB | 25,6 ms | 2,64 MB | 0,102 ms | 0,625 ms | 3,67 ms | **38/38** |

Lectura:

- **Fuse.js** recorre linealmente con fuzzy en cada consulta: con ~1.000 registros llega a un p95 de 69 ms (hasta 99 ms en otra corrida) y picos de 280–420 ms: bloquea la escritura. Descartado.
- **FlexSearch** es el más rápido y no tolera errores de tipeo de forma útil (1/6). Descartado.
- **Nativo** es suficiente para exactas y prefijos, pero no tolera errores (0/6) y habría que reimplementar fuzzy y ranking.
- **MiniSearch** da prefijos, fuzzy, boost por campo y es pequeño. Le faltan las transposiciones (`rtia`, `malvnia`), que la distancia de edición cuenta como dos errores.

**Decisión: MiniSearch, con una capa propia de ranking** (`src/lib/search.ts`). No hay necesidad técnica demostrable de un motor externo.

**Web Worker: no.** La indexación toma ~26 ms una sola vez por carga y el p95 de consulta es menor a 1 ms; un worker sumaría complejidad sin beneficio medible.

## 4. Motor de búsqueda

### Campos y pesos (según el contenido real del Excel)

| Campo | Peso | Motivo |
| --- | --- | --- |
| `nombre` | 5 | Lo que el operador escribe casi siempre |
| `aliases` | 3 | Nombre con el que figura en Google Maps |
| `direccion` | 3 | Torres/monoblocks se buscan por calle y altura |
| `barrio` | 2 | Desambigua homónimos ("torre 1 el pozo") |
| `tipoTexto` | 1 | "torre", "calle", "monoblock" (incluye la grafía "Monoblokc" del Excel) |
| `zona`, `descripcion` | 1 | Anotaciones originales (límites de manzanas, trayectos): útiles pero de menor peso |

### Normalización y tolerancia

- Minúsculas, sin tildes ni diacríticos (`Peñaloza` ≡ `penaloza`), espacios colapsados.
- Palabras vacías ignoradas (`de`, `del`, `la`, `el`, `sobre`…). No se ignora `a` porque distingue "Monoblokc A".
- Prefijos en todas las palabras.
- Fuzzy prudente: nada en palabras de menos de 4 letras, 1 edición hasta 6 letras, 2 desde 7.
- Transposiciones: para cada palabra se prueban los intercambios de letras adyacentes que **existan en el vocabulario real**.
- Todas las palabras deben coincidir (AND). Sólo si ninguna referencia las contiene todas, se muestran coincidencias parciales con un aviso.

### Ranking por niveles

Un resultado nunca pasa por delante de uno de mejor nivel, sin importar el puntaje de MiniSearch:

1. Nombre o alias idéntico a la consulta.
2. Nombre o alias que empieza con la consulta.
3. Todas las palabras aparecen completas.
4. Todas las palabras son completas o prefijos.
5. Hace falta tolerancia a errores.
6. Parcial.

Empates por puntaje, luego por tipo (referencia → torre/monoblock → manzana/casa → calle → barrio) y luego alfabético, para que el orden sea determinista.

### Ambigüedad: nunca se elige sola una ubicación dudosa

Se preselecciona un resultado únicamente si es el mejor de su nivel, de nivel exacto/prefijo/completo, y **ningún otro resultado** lo iguala ni empieza con la misma consulta. Así `UTN` (dos barrios), `comisaria` (tres comisarías) o un resultado difuso **no** se preseleccionan: Enter no abre nada hasta que el operador elige con ↑ ↓. Los homónimos se muestran con barrio, tipo, dirección y coordenadas para diferenciarlos.

## 5. Google Maps

`src/lib/maps.ts` construye `https://www.google.com/maps/search/?api=1&query=LAT%2CLON` únicamente con las coordenadas almacenadas, sin redondear. Devuelve `null` si no son válidas (la interfaz muestra "Sin coordenadas válidas" en lugar de un enlace) y valida la URL resultante (https, dominio, ruta, `api=1`, consulta numérica). Los enlaces llevan `target="_blank" rel="noopener noreferrer"`; con teclado se abre con `window.open(url, '_blank', 'noopener,noreferrer')`. No se usa geocodificación ni la API de Google Cloud.

### Ruta y compartir (pensado para celulares)

- **Cómo llegar:** `https://www.google.com/maps/dir/?api=1&destination=LAT%2CLON`, sin `origin`. Según la documentación de Google, sin origen se usa la ubicación del dispositivo, y en Android/iOS se abre la app de Google Maps si está instalada. No requiere clave, facturación ni código de geolocalización propio. El validador `isSafeMapsUrl` acepta únicamente esta forma y la del pin, siempre con un par `lat,lon` numérico.
- **Compartir:** `navigator.share` con nombre, barrio y el enlace del **pin** (no el de ruta: el de ruta depende de dónde esté quien lo recibe). Si el navegador no lo ofrece, o falla por una causa distinta a que el usuario cancele, se copia "texto + enlace" al portapapeles y se avisa. MDN lo marca como disponibilidad limitada y sólo disponible en HTTPS, así que el plan B es necesario. Cancelar el menú no es un error y no copia nada.
- **Pendiente de verificar en un teléfono real:** la apariencia y el comportamiento del menú nativo de compartir y la apertura de la app de Google Maps desde los enlaces. Los tests cubren la lógica y el plan B, no el dispositivo.
- **Evaluado y no implementado:** mapa propio dentro de la app (Google Maps JS API, con costo por carga de mapa y clave, o MapLibre + OpenStreetMap) y capa personalizada de Google (My Maps o Datasets API). Ver la investigación en la conversación; no hay cambios en el proyecto por ese motivo.

## 6. Rendimiento medido

| Métrica | Resultado | Cómo se midió |
| --- | --- | --- |
| Solicitudes HTTP por consulta | 0 | Catálogo cargado una vez |
| Indexación | ~26 ms, una vez por carga | `npm run benchmark` |
| Latencia de búsqueda (motor final) | p50 0,10 ms · p95 0,63 ms · máx 3,67 ms | 2.905 consultas de tecleo |
| Meta p95 < 30 ms | Cumplida con holgura (también se verifica en `tests/search.test.ts`) | |
| Evento de input → DOM actualizado, en el navegador integrado (Chromium, app real con `vite dev`) | ≤ 16 ms | Medido con `performance.now()` + `setTimeout(0)`; la resolución está limitada por el temporizador |

**Lo que no se midió:** el tiempo hasta el pintado en pantalla. El panel del navegador estaba oculto durante la verificación y `requestAnimationFrame` no se dispara en ese estado; la cifra de arriba cubre el trabajo de JavaScript y la actualización del DOM, no el pintado. Para el operador, la búsqueda ocupa una fracción de un cuadro de pantalla.

## 7. Seguridad y alcance

- `public/data/references.json` se sirve como archivo estático: **no hay control de acceso**. Si las referencias son internas u operativas, no deben publicarse sin autenticación delante. No se hizo ningún despliegue.
- No hay login, CRUD, mapa embebido, geolocalización, gráficos ni geocodificación.
- El Excel original no se modifica: sólo se lee.

## 8. Pendientes y riesgos

Ver la sección *Riesgos* de `excel-audit.md`. En particular: significado de las marcas `c`/`ver`/`ç`, el bloque de `Santa Rita 1` que parece pertenecer a otro barrio, 28 elementos sin coordenadas utilizables y 2 coordenadas con la longitud truncada.
