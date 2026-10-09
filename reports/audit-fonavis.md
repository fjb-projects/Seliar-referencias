# Auditoría del Excel · Fonavis 1 .xlsx

Generado: 2026-10-09T09:47:54.286Z · Fuente `fonavis`: `Fonavis 1 .xlsx` · Reproducible con `npm run import`.

## 1. Resumen estructural

- **49 hojas**, todas visibles. 48 contienen datos geográficos; 1 se omiten (`Hoja4`).
- Fórmulas: **0** · hipervínculos: **0** · notas/comentarios: **0** · imágenes: **0** · celdas numéricas: **0**. Todo el contenido es texto plano; no hay información oculta en fórmulas o comentarios.
- **El libro no es tabular.** Cada hoja es una "ficha" de barrio con bloques en posiciones variables. Las coordenadas están guardadas como **texto** `"lat, lon"` en una sola celda (nunca en columnas separadas).
- Celdas combinadas: títulos y encabezados de sección (se tratan como una sola celda; ExcelJS repite su valor en las celdas hijas, por lo que se descartan para no duplicar).

### Bloques reconocidos

| Bloque | Contenido | Cantidad de bloques |
| --- | --- | --- |
| Información General | Ubicación general del barrio, Esquema, Tipo de numeración, Barrio donde se encuentra | 40 |
| Calles E-O / S-N | Calle con altura · coordenada · "En Google Maps figura como" | 75 |
| Referencias Propias y Cercanas | Nombre del lugar · coordenada | 48 |
| Grillas (torres, monoblocks, manzanas, casas) | Una columna por elemento; filas de ubicación, dirección, límites, etc. | 17 |
| Tablas libres de casas | Rango · dirección · coordenada | 1 |

## 2. Estadísticas por hoja

| Hoja | Título (fila 1) | Filas×cols declaradas | Combinadas | Válidos | Inválidos | Celdas sin clasificar |
| --- | --- | --- | --- | --- | --- | --- |
| `Hoja4` | — | 47×9 | 0 | 0 | 0 | — |
| `29 de abril` | BARRIO 29 DE ABRIL 1 | 51×14 | 5 | 16 | 0 | 0 |
| `29 de Abril 2` | BARRIO 29 DE ABRIL 2 | 18×13 | 5 | 14 | 0 | 0 |
| `Aceria nuevo` | BARRIO ACERIA NUEVO | 26×13 | 4 | 29 | 0 | 0 |
| `Centenario` | Fonavi Centenario | 21×18 | 2 | 21 | 1 | 0 |
| `Centenario casas` | CENTENARIO CASAS | 24×21 | 5 | 4 | 5 | 0 |
| `Container y quinchitos` | CONTAINER Y QUINCHITOS | 22×14 | 5 | 16 | 0 | 0 |
| `Docente` | BARRIO DOCENTE | 27×15 | 5 | 13 | 0 | 0 |
| `El Pozo` | BARRIO EL POZO | 42×21 | 4 | 52 | 3 | 0 |
| `El Vergel` | BARRIO EL VERGEL | 22×18 | 5 | 16 | 0 | 0 |
| `Esmeralda Este` | BARRIO ESMERALDA ESTE | 22×19 | 5 | 13 | 0 | 0 |
| `Esmeralda Este Edificios` | *(sin título; se usa el nombre de hoja)* | 11×11 | 1 | 6 | 0 | 0 |
| `Esmeralda Norte` | BARRIO ESMERALDA NORTE | 25×18 | 5 | 9 | 0 | 0 |
| `Esmeralda Sur` | BARRIO ESMERALDA SUR | 24×18 | 5 | 14 | 0 | 0 |
| `Eva Peron` | *(sin título; se usa el nombre de hoja)* | 10×12 | 4 | 6 | 7 | 0 |
| `Favaloro` | BARRIO FAVALORO | 74×20 | 5 | 77 | 0 | 0 |
| `Fonavi Don Bosco` | FONAVI DON BOSCO | 17×8 | 3 | 11 | 0 | 0 |
| `Foprovi` | BARRIO FOPROVI | 25×20 | 5 | 16 | 0 | 0 |
| `Gremio Solidario` | GREMIO SOLIDARIO | 23×20 | 5 | 12 | 0 | 1 |
| `Hipotecario` | BARRIO HIPOTECARIO | 21×20 | 5 | 20 | 0 | 0 |
| `Jubilados` | BARRIO JUBILADOS | 22×16 | 4 | 7 | 0 | 0 |
| `Judicial` | BARRIO JUDICIAL | 32×18 | 5 | 21 | 0 | 0 |
| `Jesuita` | BARRIO JESUITA | 23×21 | 5 | 31 | 0 | 1 |
| `Las Flores I` | LAS FLORES I | 28×20 | 4 | 34 | 0 | 0 |
| `Las Flores II` | LAS FLORES II | 117×21 | 6 | 47 | 7 | 0 |
| `Las Flores 3` | LAS FLORES 3 | 38×20 | 5 | 33 | 0 | 0 |
| `La florida` | BARRIO LA FLORIDA | 35×12 | 7 | 20 | 1 | 0 |
| `La Nueva Tablada` | LA NUEVA TABLADA | 14×12 | 4 | 23 | 0 | 0 |
| `Las delicias` | BARRIO LAS DELICIAS | 28×21 | 5 | 22 | 0 | 0 |
| `Las Delicias 2` | BARRIO LAS DELICIAS 2 | 26×21 | 5 | 17 | 0 | 0 |
| `Ledesco` | LEDESCO | 30×21 | 5 | 30 | 0 | 0 |
| `Legislativo` | BARRIO LEGISLATIVO | 25×17 | 5 | 6 | 0 | 0 |
| `Los Cipreses` | BARRIO LOS CIPRESES | 31×16 | 4 | 49 | 0 | 1 |
| `Monoblokc Gral Paz 7000` | MONOBLOKC GENERAL PAZ 7019 | 14×5 | 2 | 4 | 4 | 0 |
| `Monoblokc Iturraspe 4300` | MONOBLOCK ITURRASPE 4300 / 4400 | 19×3 | 2 | 7 | 0 | 0 |
| `Nueva Esperanza` | BARRIO NUEVA ESPERANZA | 55×18 | 5 | 65 | 0 | 0 |
| `Nueva Esperanza Este` | BARRIO NUEVA ESÈRANZA ESTE | 23×21 | 5 | 23 | 0 | 0 |
| `Nuevo Horizonte` | NUEVO HORIZONTE | 54×20 | 5 | 58 | 0 | 0 |
| `Pje Santa teresita 3100` | PASAJE SANTA TERESITA  3000 | 14×10 | 4 | 5 | 0 | 0 |
| `Plan Casas de cambio` | BARRIO PLAN CASAS DE CAMBIO | 23×21 | 5 | 10 | 0 | 0 |
| `Pte Peron` | PTE PERON | 13×12 | 5 | 6 | 0 | 6 |
| `Policial` | BARRIO POLICIAL | 26×21 | 5 | 18 | 0 | 0 |
| `Punta Norte` | PUNTA NORTE | 57×13 | 5 | 40 | 0 | 0 |
| `Santa Rita 1` | SANTA RITA 1 | 1.048.576×20 | 5 | 10 | 0 | 0 |
| `Santa Rita 2` | SANTA RITA 2 | 69×20 | 5 | 37 | 0 | 0 |
| `Solis 3000` | COMPLEJO J DIAZ SOLIS 3000 - PJE ALFONSO 3000 | 19×16 | 2 | 7 | 0 | 0 |
| `UNL` | UNL | 24×18 | 5 | 13 | 0 | 0 |
| `Villa Olimpica` | VILLA OLIMPICA | 12×12 | 5 | 14 | 0 | 0 |
| `Villa Setubal` | VILLA SETUBAL | 15×10 | 3 | 8 | 0 | 0 |

## 3. Inventario de campos

| Campo normalizado | Origen en el Excel | Notas |
| --- | --- | --- |
| `barrio` | Título de la fila 1 de la hoja | Se conserva tal cual (p. ej. `BARRIO FAVALORO`) |
| `zona` | Campo "Barrio" de Información General | Barrio donde se ubica el conjunto; casi siempre vacío |
| `nombre` | Etiqueta de la calle / lugar / encabezado de torre, monoblock o manzana | Texto original |
| `direccion` | "Torre sobre", "Direccion", "Sobre", "Ingresos", "Calle ingreso"… | Sólo grillas, calles y tablas de casas |
| `descripcion` | Límites (N/E/S/O), "Trayecto desde el ingreso", "Otros", "Escaleras" | Texto de búsqueda de menor peso |
| `aliases` | "En Google Maps figura como" | Se omiten placeholders ("No tiene ningun nombre") |
| `latitude`/`longitude`/`coordRaw` | Celda de coordenada | `coordRaw` conserva el texto exacto |
| `marca` | Columna de marcas junto a cada fila | Ver sección 5 |
| `detalles` | Resto de pares etiqueta → texto | Sin pérdida de información |
| `source` | Hoja, celda y fila de la coordenada | Trazabilidad |

Valores encontrados en Información General:

- **Esquema:** `Casas` (34), `(vacío)` (9), `Casasa` (2), `casas` (1), `Casas / Monoblock - Torres` (1), `Departamentos` (1)
- **Tipo de numeración:** `(vacío)` (11), `Comun` (9), `Tradicional` (9), `Propia` (6), `Ver` (5), `Normal` (2), `Numeracion propia y Ver Normal` (1), `Numercion Propia y comun` (1), `ver` (1), `Nuneracion Propia` (1), `Propias` (1), `Propia y Tradicional` (1)

## 4. Calidad de los datos geográficos

- Candidatos detectados: **1.058** · con coordenada válida: **1.030** · sin coordenada utilizable: **28**.
- Formato: texto `lat, lon` con punto decimal y coma separadora en el 100 % de las coordenadas válidas. No se encontraron comas decimales ni formatos regionales alternativos. Los espacios sobrantes se recortan (no alteran el valor).
- Precisión decimal original: entre 3 y 15 decimales por componente. Con 5 decimales la resolución es de ≈1 m; con 3, de ≈100 m.
- **2 coordenadas con menos de 5 decimales** (probablemente truncadas a mano; el punto puede estar desplazado decenas de metros). Se importan tal cual y se señalan para revisión: `Esmeralda Sur!F9` (Sobre Matheu 2900: -31.592530, -60.695); `Punta Norte!B5` (PUNTA NORTE: -31.565797, -60.7119).
- Rango: latitud -31.670878 a -31.560198; longitud -60.754781 a -60.656445. Mediana del conjunto: -31.586490, -60.711795 (zona de Santa Fe capital).
- Inversión latitud/longitud: **0** casos (todas las latitudes están en [-90, 90] y dentro de la zona). Coordenadas a más de 25 km de la mediana: **0**.
- Referencias distintas que comparten coordenadas exactas: **9** grupos (ver `transformation-summary.md`).
- Nombres repetidos en barrios distintos: **55** (la interfaz los muestra como alternativas con su barrio).

### Registros descartados

| Motivo | Cantidad |
| --- | --- |
| `bloque_huerfano_duplicado` | 23 |
| `sin_coordenadas` | 17 |
| `coordenada_no_numerica` | 11 |

Detalle completo en `reports/invalid-records.json`. Ningún valor fue corregido ni inferido.

### Advertencias (se importan, pero conviene verificarlas)

Ninguna.

## 5. Inconsistencias encontradas

**Marcas junto a cada fila.** La mayoría de las filas tiene una `c` en una columna adyacente, pero el significado no está documentado. Distribución sobre los registros válidos:

| Marca | Registros |
| --- | --- |
| `c` | 916 |
| `(sin marca)` | 82 |
| `C` | 16 |
| `ver` | 11 |
| `ç` | 3 |
| `c v` | 2 |

Hay variantes (`ver`, `v`, `ç`…) que sugieren estados de verificación. Se conservan sin interpretar en el campo `marca`; **requiere confirmación del responsable de los datos**.

**Texto en lugar de coordenadas.** 11 elementos tienen una dirección o un nombre en la celda de coordenadas. No se geocodifican (regla del proyecto); quedan en `invalid-records.json` con el texto original.

**Elementos sin coordenadas.** 17 elementos tienen nombre pero ninguna coordenada; hojas más afectadas: `Eva Peron` (7), `Centenario casas` (5), `Monoblokc Gral Paz 7000` (4).

**Celdas sueltas sin clasificar** (conservadas en `invalid-records.json` → `celdasSinClasificar`):

| Hoja | Celda | Contenido |
| --- | --- | --- |
| `Gremio Solidario` | R2 | `-31.821746, -60.854709` |
| `Jesuita` | U2 | `-31.821746, -60.854709` |
| `Los Cipreses` | N3 | `Barrio donde se encuentra` |
| `Pte Peron` | F6 | `c` |
| `Pte Peron` | G6 | `c` |
| `Pte Peron` | H6 | `c` |
| `Pte Peron` | J6 | `c` |
| `Pte Peron` | K6 | `c` |
| `Pte Peron` | L6 | `c` |

**Bloque repetido masivamente (`Santa Rita 1`).** Más allá de la fila 300 hay 860.949 filas de datos en las columnas R/T, que repiten 23 líneas distintas una y otra vez. No tiene encabezado ni sección; sólo se identifica "Barrio donde se encuentra: Rivadavia". Parece una pegada accidental. **No se importó**; las 23 líneas únicas están en `invalid-records.json` por si se quieren recuperar.

**Coordenadas sueltas fuera de todo bloque:** `Gremio Solidario!R2` (-31.821746, -60.854709, a 29 km de la mediana); `Jesuita!U2` (-31.821746, -60.854709, a 29 km de la mediana). Probable residuo; no se importaron.

## 6. Registros utilizables

| Tipo | Buscables |
| --- | --- |
| calle | 630 |
| referencia | 245 |
| monoblock | 52 |
| barrio | 38 |
| manzana | 30 |
| torre | 27 |
| casa | 6 |
| otro | 2 |

**Total buscable: 1.030** de 1.058 candidatos.

## 7. Riesgos

1. **Estructura frágil.** El libro es una ficha visual, no una tabla. El importador depende de textos ancla ("Calles de Este a Oeste", "Referencias Propias y Cercanas", "Informacion General"…). Si se renombran o aparece un bloque nuevo, las celdas quedan como *sin clasificar* y se listan (no se pierden en silencio, pero tampoco se importan).
2. **Significado de las marcas desconocido.** Si `ver` significa "pendiente de verificar", habría que reflejarlo en la interfaz.
3. **Coordenadas sin verificación independiente.** Se validan formato y zona, no que el punto sea el correcto en el terreno.
4. **Hoja `Santa Rita 1` pesada.** Declara más de un millón de filas de las que casi todas son repeticiones; el libro tarda en abrirse y pesa de más.
5. **Datos operativos.** El JSON generado se sirve como archivo estático: **no hay control de acceso**. Si las referencias son internas, no deben publicarse sin autenticación.

## 8. Recomendaciones

1. Confirmar con el responsable el significado de las marcas (`c`, `ver`, `v`, `ç`…).
2. Completar o descartar los elementos sin coordenadas (lista en `invalid-records.json`).
3. Reemplazar por coordenadas las direcciones escritas en celdas de coordenadas.
4. Revisar las filas repetidas de `Santa Rita 1` (¿son de otro barrio?) y eliminar las sobrantes del libro.
5. Mover fuera del libro de referencias las hojas sin coordenadas con contenido (`Hoja4`).
6. A mediano plazo, migrar la fuente a una tabla plana (una fila por referencia) para simplificar el importador.
