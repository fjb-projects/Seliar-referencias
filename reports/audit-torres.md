# Auditoría del Excel · Torres similares.xlsx

Generado: 2026-10-09T09:47:54.286Z · Fuente `torres`: `Torres similares.xlsx` · Reproducible con `npm run import`.

## 1. Resumen estructural

- **15 hojas**, todas visibles. 6 contienen datos geográficos; 9 se omiten (`Parque Federal`, `Hoja8`, `Hoja9`, `Hoja10`, `Hoja11`, `Hoja12`, `Hoja13`, `Hoja14`, `Hoja15`).
- Fórmulas: **0** · hipervínculos: **0** · notas/comentarios: **0** · imágenes: **0** · celdas numéricas: **0**. Todo el contenido es texto plano; no hay información oculta en fórmulas o comentarios.
- **El libro no es tabular.** Cada hoja es una "ficha" de barrio con bloques en posiciones variables. Las coordenadas están guardadas como **texto** `"lat, lon"` en una sola celda (nunca en columnas separadas).
- Celdas combinadas: títulos y encabezados de sección (se tratan como una sola celda; ExcelJS repite su valor en las celdas hijas, por lo que se descartan para no duplicar).

### Bloques reconocidos

| Bloque | Contenido | Cantidad de bloques |
| --- | --- | --- |
| Información General | Ubicación general del barrio, Esquema, Tipo de numeración, Barrio donde se encuentra | 0 |
| Calles E-O / S-N | Calle con altura · coordenada · "En Google Maps figura como" | 0 |
| Referencias Propias y Cercanas | Nombre del lugar · coordenada | 3 |
| Grillas (torres, monoblocks, manzanas, casas) | Una columna por elemento; filas de ubicación, dirección, límites, etc. | 12 |
| Tablas libres de casas | Rango · dirección · coordenada | 0 |

## 2. Estadísticas por hoja

| Hoja | Título (fila 1) | Filas×cols declaradas | Combinadas | Válidos | Inválidos | Celdas sin clasificar |
| --- | --- | --- | --- | --- | --- | --- |
| `Torres en el puerto` | TORRES AMARRAS | 6×34 | 6 | 15 | 0 | 0 |
| `Juan dell Campillo 1300` | JUAN DEL CAMPILLO 1300 | 10×3 | 1 | 3 | 0 | 0 |
| `Lavalle 5000` | LAVALLE 5000 | 14×3 | 1 | 3 | 0 | 0 |
| `Marcial Candiotti 2600` | MARCIAL CANDIOTI 2600 | 20×3 | 1 | 6 | 0 | 0 |
| `Pedro centeno 2100` | PEDRO CENTENO 2100 | 6×3 | 1 | 2 | 0 | 0 |
| `Parque Federal` | — | 0×0 | 0 | 0 | 0 | — |
| `Parque Sur` | PARQUE SUR | 8×4 | 1 | 3 | 0 | 0 |
| `Hoja8` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja9` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja10` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja11` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja12` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja13` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja14` | — | 0×0 | 0 | 0 | 0 | — |
| `Hoja15` | — | 0×0 | 0 | 0 | 0 | — |

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

- **Esquema:** `(vacío)` (6)
- **Tipo de numeración:** `(vacío)` (6)

## 4. Calidad de los datos geográficos

- Candidatos detectados: **32** · con coordenada válida: **32** · sin coordenada utilizable: **0**.
- Formato: texto `lat, lon` con punto decimal y coma separadora en el 100 % de las coordenadas válidas. No se encontraron comas decimales ni formatos regionales alternativos. Los espacios sobrantes se recortan (no alteran el valor).
- Precisión decimal original: entre 6 y 6 decimales por componente. Con 5 decimales la resolución es de ≈1 m; con 3, de ≈100 m.
- Rango: latitud -31.653829 a -31.568461; longitud -60.717921 a -60.657909. Mediana del conjunto: -31.645600, -60.697788 (zona de Santa Fe capital).
- Inversión latitud/longitud: **0** casos (todas las latitudes están en [-90, 90] y dentro de la zona). Coordenadas a más de 25 km de la mediana: **0**.
- Referencias distintas que comparten coordenadas exactas: **2** grupos (ver `transformation-summary.md`).
- Nombres repetidos en barrios distintos: **4** (la interfaz los muestra como alternativas con su barrio).

### Registros descartados

| Motivo | Cantidad |
| --- | --- |

Detalle completo en `reports/invalid-records.json`. Ningún valor fue corregido ni inferido.

### Advertencias (se importan, pero conviene verificarlas)

| Hoja | Celda | Referencia | Coordenada | Distancia al resto de la hoja |
| --- | --- | --- | --- | --- |
| `Juan dell Campillo 1300` | B10 | Edificio con antena alta | -31.568461, -60.717921 | 9.45 km |

## 5. Inconsistencias encontradas

**Marcas junto a cada fila.** La mayoría de las filas tiene una `c` en una columna adyacente, pero el significado no está documentado. Distribución sobre los registros válidos:

| Marca | Registros |
| --- | --- |
| `(sin marca)` | 17 |
| `c` | 9 |
| `C` | 6 |

Se conservan sin interpretar en el campo `marca`; su significado debe confirmarlo el responsable de los datos.

**Texto en lugar de coordenadas.** 0 elementos tienen una dirección o un nombre en la celda de coordenadas. No se geocodifican (regla del proyecto); quedan en `invalid-records.json` con el texto original.

**Elementos sin coordenadas.** 0 elementos tienen nombre pero ninguna coordenada.

**Celdas sueltas sin clasificar** (conservadas en `invalid-records.json` → `celdasSinClasificar`):

| Hoja | Celda | Contenido |
| --- | --- | --- |

## 6. Registros utilizables

| Tipo | Buscables |
| --- | --- |
| torre | 26 |
| referencia | 6 |

**Total buscable: 32** de 32 candidatos.

## 7. Riesgos

1. **Estructura frágil.** El libro es una ficha visual, no una tabla. El importador depende de textos ancla ("Calles de Este a Oeste", "Referencias Propias y Cercanas", "Informacion General"…). Si se renombran o aparece un bloque nuevo, las celdas quedan como *sin clasificar* y se listan (no se pierden en silencio, pero tampoco se importan).
2. **Significado de las marcas desconocido.** Si `ver` significa "pendiente de verificar", habría que reflejarlo en la interfaz.
3. **Coordenadas sin verificación independiente.** Se validan formato y zona, no que el punto sea el correcto en el terreno.
4. **Puntos lejos del resto de su hoja (1).** Se importan tal cual; si alguno es un error de carga, el operador sería enviado a un lugar equivocado.
5. **Datos operativos.** El JSON generado se sirve como archivo estático: **no hay control de acceso**. Si las referencias son internas, no deben publicarse sin autenticación.

## 8. Recomendaciones

1. Confirmar con el responsable el significado de las marcas (`c`, `ver`, `v`, `ç`…).
2. Completar o descartar los elementos sin coordenadas (lista en `invalid-records.json`).
3. Reemplazar por coordenadas las direcciones escritas en celdas de coordenadas.
4. Eliminar las hojas vacías (`Parque Federal`, `Hoja8`, `Hoja9`, `Hoja10`, `Hoja11`, `Hoja12`, `Hoja13`, `Hoja14`, `Hoja15`).
5. A mediano plazo, migrar la fuente a una tabla plana (una fila por referencia) para simplificar el importador.
