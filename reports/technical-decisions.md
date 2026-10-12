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

## 9. Categorización de coincidencias y Georef (2026-10-11)

Esta sección describe el comportamiento vigente para búsquedas de calles y direcciones y **reemplaza** tres afirmaciones anteriores de este documento: «no hay solicitudes HTTP por consulta» (§1 y tabla de §6) y «no hay geocodificación» (§7). Siguen siendo ciertas para el catálogo propio, que se busca en memoria; ya no lo son para la aplicación completa, que consulta Georef en cada búsqueda con forma de calle. Las medidas de latencia de §3 y §6 corresponden al motor local y no incluyen a Georef.

### Problema observado en los datos reales

- **Georef no llegaba a consultarse.** La versión anterior consultaba Georef sólo si el catálogo no devolvía ninguna coincidencia. En la práctica casi siempre hay alguna coincidencia débil, así que la consulta no se disparaba.
- **Alturas tratadas como texto.** El motor aplicaba prefijos y tolerancia a errores también a los números: `san martin 2500` devolvía «Sobre San Martin 8500» como coincidencia.
- **El catálogo es un nomenclador por cuadra.** 630 de los 1.062 registros son de tipo `calle` («Sobre San Martin 8500»). El responsable de los datos confirmó que cada uno marca la **cuadra entera** (8500 a 8599). Llevan el nombre popular y, como alias, el nombre de Google Maps, que a menudo difiere («Pje Segundo 4800» figura como «F Aguayo»).
- **Georef no devuelve puntaje.** `/calles` busca con tolerancia y por prefijo y devuelve rangos de altura por localidad. `/direcciones` puede devolver cero resultados para una calle que `/calles` lista (`rivadavia 1500` en la ciudad de Santa Fe): una respuesta vacía no significa que la calle no exista. Esto se observó consultando la API real, no surge de su documentación.

### Qué hacen los geocodificadores de producción

Los servicios consultados no reducen la calidad de una coincidencia a un único número: califican por componente, informan el tipo de resultado y separan lo que se muestra de lo que se acepta sin intervención.

| Servicio | Mecanismo | Qué aporta al diseño |
| --- | --- | --- |
| Mapbox | `match_code`: un valor por componente (`address_number`, `street`, `postcode`, `place`…) con `matched`, `unmatched`, `plausible` (altura interpolada), más una confianza global (`exact`, `high`, `medium`, `low`) | Calle y altura se califican por separado y se resumen en una categoría global. Una altura corregida baja la confianza a `low`. |
| HERE | `queryScore` (cuánto del texto se reconoció) y `fieldScore` por campo (`streets`, `houseNumber`, `city`), de 0 a 1 | Un puntaje global bajo no implica un mal resultado: hay que mirar los campos que importan. No publica umbrales; indica decidir según el costo de un error. |
| Google | `location_type` (`ROOFTOP`, `RANGE_INTERPOLATED`, `GEOMETRIC_CENTER`, `APPROXIMATE`) y `partial_match` | El tipo de resultado (punto exacto, interpolado, centro de la calle) es un eje propio, distinto del nombre. |
| Pelias | `match_type` (`exact`, `interpolated`, `fallback`), `accuracy` (`point`, `centroid`) y `confidence` | Distingue lo encontrado de lo estimado y de lo devuelto «por si sirve». |
| Esri (ArcGIS) | Puntaje de 0 a 100 con dos umbrales: puntaje mínimo de candidato (qué se muestra) y puntaje mínimo de coincidencia (qué se acepta sin revisar) | Mostrar y aceptar automáticamente son decisiones con umbrales distintos. |

Correspondencia con este proyecto: grado del nombre de calle y comparación de altura por separado; ocho categorías como calificación global; la fuente como eje aparte; y dos reglas distintas, una para mostrar una fila y otra, más estricta, para seleccionarla sin intervención del operador.

**Límites de esta investigación.** Que «los números se comparan de forma exacta» es una **inferencia**, no una regla documentada: se apoya en que Mapbox y Esri tratan la altura como un componente propio (Mapbox con `address_number` y con una confianza que no admite corregirla; Esri con un ajuste específico para alturas fuera de rango). No se encontró ninguna fuente primaria sobre interfaces de despacho o de radiooperación.

### Decisiones

Decisiones del responsable del proyecto:

1. Calle y altura se califican por separado; hay una categoría global; la fuente es un eje aparte.
2. La altura se compara **por cuadra** (centena), nunca con tolerancia ni por prefijo.
3. El nombre de la calle se compara contra el nombre popular **y** contra el alias de Google Maps; se muestran ambos.
4. Georef se consulta **siempre**; el categorizador ordena todo en una sola lista.
5. La jerarquía y los umbrales son iniciales, «para iniciar y probar».
6. Un pasaje con nombre decimal («Pje 38,50») se lee entero como nombre de calle; `40,5` y `40,50` son el mismo pasaje.
7. Las filas «Parecido» se muestran sólo cuando no hay nada mejor (categorías 0 a 6 vacías).
8. Los errores de tipeo del catálogo no se corrigen en la aplicación: los mantiene el responsable de los datos.
9. Las líneas de diagnóstico en la consola (`[georef]`, `[rank]`) se conservan en producción por pedido expreso, pese a una sugerencia de revisión en contra.

Jerarquía resultante (`src/lib/categorize.ts`):

| # | Categoría | Fuente | Regla |
| --- | --- | --- | --- |
| 0 | Referencia | Catálogo | Coincidencia del motor con confianza: no parcial y de nivel «todas las palabras completas o prefijos» o mejor |
| 1 | Cuadra confirmada | Catálogo + Georef | Categoría 2 con una dirección de Georef a 300 m o menos; la dirección se pliega en la fila |
| 2 | Misma cuadra | Catálogo | Nombre de calle fuerte o exacto y misma cuadra que la altura |
| 3 | Dirección interpolada | Georef | Resultado de `/direcciones` con nombre fuerte o exacto que no se plegó en una fila de categoría 1 |
| 4 | Cuadra vecina | Catálogo | Nombre fuerte o exacto y distancia de 100 a 200 en numeración |
| 5 | Misma calle | Catálogo | Nombre fuerte o exacto y: sin altura, a más de 200, o registro sin cuadra |
| 6 | La calle existe | Georef | Resultado de `/calles` con nombre fuerte o exacto, en una localidad sin fila de categoría 3 y cuyo rango admite la altura |
| 7 | Parecido | Ambas | Nombre de calle débil, o coincidencia del motor sin confianza |

Elecciones de implementación (no son decisiones del responsable; se pueden cambiar sin consultarlo si no alteran lo anterior):

- Grados del nombre: `exact`, `strong`, `weak`, `none` (`gradeStreetName` en `src/lib/address.ts`). La distancia de edición cuenta la transposición de letras vecinas como un error, y el presupuesto de errores lo fija la palabra más corta del par.
- Una consulta hecha sólo de letras sueltas no nombra ninguna calle: una inicial sólo acompaña a una palabra completa. Surgió de la revisión: una letra suelta calificaba como coincidencia fuerte a toda calle con esa inicial.
- Las localidades cuyo rango de alturas no admite la altura escrita se descartan. Surgió de una prueba en vivo: «SAN MARTIN @ Recreo [0-1599]» para la altura 8540 era ruido.
- Un rango de Georef con un solo extremo conocido se trata como desconocido (no filtra). Con ambos extremos, mínimo y máximo se toman de los cuatro valores laterales, porque hay calles digitalizadas en sentido inverso.
- La altura que informa Georef se acepta sólo si es un número o un texto de dígitos (`0x10` o `1e3` no son alturas).
- Las confirmaciones se asignan de la más cercana a la más lejana: cada dirección confirma una sola fila.
- La discrepancia sólo la marcan direcciones de la ciudad de Santa Fe, que además encabeza las filas de Georef.
- Selección automática: una única «Referencia» inequívoca sin filas de cuadra, o una única fila de categoría 1 o 2 sin ninguna «Referencia». Nunca una fila de Georef.
- La elección del operador se guarda por clave estable, común a la lista simple y a la categorizada, de modo que una respuesta tardía de Georef no la mueve.
- Georef se consulta desde el navegador con 400 ms de espera tras la última tecla y 1,5 s de tiempo máximo por solicitud; `/calles` y `/direcciones` salen en paralelo y las filas del catálogo no esperan.
- El motor de búsqueda (§4) dejó de aplicar tolerancia y transposiciones a las palabras con dígitos.

### Umbrales provisorios

Todos los valores de esta tabla son iniciales y están **pendientes de validación con el operador**.

| Umbral | Valor | Dónde |
| --- | --- | --- |
| Cuadra vecina | hasta 200 de distancia en numeración (dos cuadras) | `NEIGHBOUR_BLOCK_DISTANCE` |
| Acuerdo entre catálogo y Georef | 300 m | `AGREEMENT_METERS` |
| Tolerancia a errores en nombres de calle | 0 en palabras de menos de 4 letras, 1 de 4 a 7, 2 desde 8; ninguna en palabras con dígitos | `tolerance` en `address.ts` |
| Prefijo en la última palabra | 3 letras o más (da grado débil) | `MIN_PREFIX_LENGTH` |
| Tope de «Misma calle» | 8 filas | `SAME_STREET_CAP` |
| Tope de «La calle existe» | 5 filas | `STREET_EXISTS_CAP` |
| Tope de «Parecido» | 5 filas (más la fila elegida por el operador) | `SIMILAR_CAP` |

La tolerancia de nombres de calle (1 error de 4 a 7 letras, 2 desde 8) es distinta de la del motor de §4 (1 error hasta 6 letras, 2 desde 7). Son dos capas independientes.

### Alternativas descartadas

| Alternativa | Motivo del descarte |
| --- | --- |
| Consultar Georef sólo cuando el catálogo no tiene la cuadra | Se perderían la confirmación (categoría 1) y la advertencia de discrepancia, que existen justamente cuando el catálogo sí tiene la cuadra. El responsable decidió consultar siempre y dejar que el categorizador ordene. |
| Comparar la altura de forma exacta | Los registros del catálogo marcan cuadras enteras, no puertas: `san martin 8540` no coincidiría con «Sobre San Martin 8500», que es precisamente la cuadra buscada. |
| Mostrar siempre las filas «Parecido» | Las coincidencias sin confianza del motor llenaban la lista con registros ajenos («San Jose 8500» para `san martin 8540`). El responsable decidió mostrarlas sólo cuando no hay nada mejor. |

### Evidencia medida

| Dato | Valor |
| --- | --- |
| `npm test` | 645 de 645 (12 archivos), ejecutado el 2026-10-11 |
| Set de relevancia (`tests/gold.ts`) | 38/38, sin cambios |
| Tests de `address.ts` / `georef.ts` al cerrar sus tareas | 137 / 78 |
| Registros de tipo `calle` | 630 de 1.062; los 630 se interpretan |
| Registros con cuadra | 628 de 630 (sin cuadra: «Falcon» y «Pje 173,70») |
| Registros con nombre decimal | 34 |
| Registros con cuadra doble («8300 / 8400») | 12 |
| Alias con dos nombres separados por barra | 2 |
| Registros «Pje S/N» que ya no coinciden por nombre | 6 |

Pruebas en vivo, con el catálogo real y la API real de Georef:

| Consulta | Resultado |
| --- | --- |
| `san martin 8540` | «Cuadra confirmada»: «Sobre San Martin 8500», con Georef a 12 m; se selecciona sola |
| `san martin 2500` | Primero «Dirección interpolada» en Santa Fe y Santo Tomé; las cuadras 8500 a 8900 del catálogo quedan como «Misma calle» |
| `pje 32.50 8350` | «Misma cuadra»: «Pje 32,50 8300 / 8400» |
| `comisaria 25` | Una sola fila «Referencia», seleccionada sola |
| `/calles` con `rivadavia` | 6 localidades con rango (Santa Fe 0 a 9699); `/direcciones` con `rivadavia 1500` no devuelve ningún resultado en Santa Fe |
| `/calles` con `san matrin` | Devuelve SAN MARTIN (búsqueda tolerante); un texto sin sentido devuelve 0 |

**Lo que no se midió.** La lista categorizada no se verificó en un navegador real: los tests de interfaz corren en jsdom. No se midió la latencia de Georef de forma sistemática ni su disponibilidad.

### Pendientes

- Validar los umbrales y los topes con el operador.
- Consultar Georef con el alias de Google Maps cuando difiere del nombre popular.
- Pasajes «S/N»: tratar `s/n` como una sola palabra para que vuelvan a coincidir por nombre.
- Ordinales (`1ro de Mayo` frente a `1 de mayo`) y texto después de la altura (`depto 3`, que hoy se lee como altura).
- Los 21 registros con alias de una sola letra (`c`) ya no coinciden con la consulta `c`.
- Fuera de la lista categorizada no se indica «Buscando en Georef…»: una calle que sólo conoce Georef, escrita sin altura, muestra «Sin coincidencias» hasta que llega la respuesta.
- Pasar el mouse sobre una fila la fija como elegida; una fila «Parecido» fijada se suma al tope (la lista puede tener 6).
- `comisaria 25` muestra dos etiquetas «Referencia» (tipo de registro y categoría).
- «Av Peñaloza 7700» perdió la selección automática porque «MONOBLOCK 11» también es una coincidencia con confianza del motor (ambiguo: no se selecciona).
- El enlace de respaldo a Google Maps queda fuera de la región `role="status"`.
- Verificación en un navegador real.

### Fuentes

- Pelias, calidad de resultados: https://github.com/pelias/documentation/blob/master/result_quality.md
- Google, Geocoding API: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
- Mapbox, Geocoding API: https://docs.mapbox.com/api/search/geocoding/
- HERE, puntajes de geocodificación: https://docs.here.com/geocoding-and-search/docs/code-geocode-scoring
- Esri, calidad de geocodificación en ArcGIS Pro: https://doc.esri.com/en/arcgis-pro/latest/help/data/geocoding/tips-for-improving-geocoding-quality.html
- Georef, API del Servicio de Normalización de Datos Geográficos de Argentina: https://datosgobar.github.io/georef-ar-api/
