# Buscador de referencias

Buscador instantáneo de referencias georreferenciadas para radiooperadores. Se escribe un lugar, calle o barrio, se identifica la coincidencia correcta y se abre su ubicación exacta en Google Maps. Todo corre en el navegador: sin backend y sin servicios pagos. El catálogo propio se busca localmente, en memoria. Además, cuando el texto tiene forma de calle o dirección, se consulta en paralelo la API pública Georef y sus respuestas se ordenan junto con las del catálogo en una sola lista categorizada (ver [Calles y direcciones](#calles-y-direcciones-categorías-y-georef)).

> **Aviso de privacidad.** Los datos se sirven como archivo estático (`public/data/references.json`) y **no tienen control de acceso**. Si las referencias son internas, no publiques la app sin autenticación. Este proyecto no hace ningún despliegue.

## Requisitos

- Node.js 20.19 o superior (probado con 24).
- Los libros Excel de referencias (`Fonavis 1 .xlsx`, `Torres similares.xlsx`).

## Instalación y ejecución

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. El campo de búsqueda tiene el foco al entrar.

| Atajo | Acción |
| --- | --- |
| Escribir | Busca mientras se escribe |
| ↑ / ↓ | Recorre los resultados |
| Enter | Abre en Google Maps el resultado seleccionado. Si no hay ninguno seleccionado, no abre nada y pide elegir uno |
| Esc | Quita la selección hecha por el operador; otra vez, limpia la búsqueda |
| Ctrl + K | Enfoca el buscador desde cualquier lugar |

Si hay varias coincidencias posibles (por ejemplo `UTN` existe en dos barrios), **no se selecciona ninguna**: se elige con ↑ ↓. Con una única coincidencia clara, Enter la abre directamente. En las búsquedas de calles y direcciones la regla es más estricta (ver [Teclado y selección automática](#teclado-y-selección-automática)).

Cada resultado del catálogo ofrece tres acciones, todas basadas únicamente en las coordenadas guardadas (los resultados que aporta Georef ofrecen menos; ver [Categorías](#categorías)):

| Acción | Qué hace |
| --- | --- |
| **Abrir en Google Maps** | Pin en el punto exacto (es lo que abre Enter). |
| **Cómo llegar** | Ruta hasta el punto. Sin origen, Google Maps parte de la ubicación del dispositivo; en un celular abre la app instalada. |
| **Compartir** | Abre el menú de compartir del dispositivo (WhatsApp, SMS, mail…) con nombre, barrio y el enlace del pin. Si el navegador no lo tiene (típico en PC), copia el texto con el enlace al portapapeles. |

> El menú de compartir y la geolocalización del celular sólo funcionan con la app servida por **HTTPS** (en `localhost` también). Probar el menú real de compartir requiere un teléfono.

## Calles y direcciones: categorías y Georef

Cuando la búsqueda es una calle o una dirección, la lista deja de ser la lista simple del motor y pasa a ser una **lista categorizada**: los registros del catálogo y las respuestas de [Georef](https://www.argentina.gob.ar/georef/api) (la API oficial y gratuita de normalización de direcciones) se ordenan juntos, de mejor a peor, y cada fila indica su categoría y su fuente.

### Cuándo cambia la lista

La lista categorizada se usa cuando se cumple alguna de estas condiciones:

- el texto tiene una altura (`san martin 2500`) o es una intersección (`san martin y juan de garay`, también con `esquina` o `esq`);
- el texto, sin altura, es el nombre de una calle que el catálogo o Georef reconocen (`san martin`).

En cualquier otro caso (`utn`, `comisaria`, un barrio) se mantiene la lista simple, con el mismo orden y la misma selección automática de siempre. Un nombre seguido de un número (`comisaria 25`, `torre 3`) se lee como una altura y se muestra en la lista categorizada, pero los resultados son los mismos: aparecen en la categoría «Referencia».

### Consulta a Georef

- **Siempre se consulta**, encuentre lo que encuentre el catálogo, cuando el texto tiene forma de calle: al menos una palabra de tres letras o el decimal de un pasaje (`38.50`). Esto incluye búsquedas de lugares, para las que Georef normalmente no devuelve nada útil.
- **Dos recursos.** `/calles` se consulta siempre, con el nombre de la calle sin la altura ni la calle que cruza; devuelve en qué localidades existe la calle y su rango de alturas. `/direcciones` se consulta sólo si hay altura o intersección, con el texto completo; devuelve un punto interpolado. Las dos consultas salen en paralelo.
- **Sin esperas.** Las filas del catálogo se muestran al instante; las de Georef se suman cuando llega la respuesta (mientras tanto, la lista categorizada indica «Buscando en Georef…»). La consulta sale 400 ms después de la última tecla y cada solicitud tiene un tiempo máximo de 1,5 s. Si Georef falla o no responde, se sigue sólo con el catálogo.
- **Zona acotada.** La consulta se limita a estas localidades del departamento La Capital (Santa Fe), definidas en `src/lib/georef.ts` (`GEOREF_LOCALIDADES`, por código de localidad censal INDEC): Santa Fe, Recreo, Monte Vera, Candioti, Angel Gallardo, San José del Rincón, Arroyo Leyes, Santo Tomé y Sauce Viejo. Para sumar o quitar una ciudad se edita esa lista.
- **Llamada directa desde el navegador.** La API responde con CORS abierto (`Access-Control-Allow-Origin: *`) y no requiere clave. Si la central llegara a depender de Georef, conviene pasar por una función propia (con caché) o instalar la API en un servidor.
- **Respaldo.** Si no hay ninguna fila para mostrar y no queda ninguna respuesta pendiente, se ofrece un enlace de Google Maps que busca el texto escrito.

### Categorías

Una fila nunca pasa por delante de otra de mejor categoría. Cada fila muestra dos etiquetas: la categoría y la fuente (`Catálogo`, `Georef` o `Catálogo + Georef`).

| # | Etiqueta | Fuente | Qué significa |
| --- | --- | --- | --- |
| 0 | **Referencia** | Catálogo | Registro que el motor de búsqueda encontró con confianza (lugar, torre, barrio…). Es el resultado de siempre. |
| 1 | **Cuadra confirmada** | Catálogo + Georef | Registro de la calle en la misma cuadra que la altura escrita, y Georef ubica la dirección a 300 m o menos. La fila indica la distancia («Georef coincide a N m»); el punto de Georef no tiene fila propia. |
| 2 | **Misma cuadra** | Catálogo | Registro de la calle en la misma cuadra que la altura escrita, sin confirmación de Georef. |
| 3 | **Dirección interpolada** | Georef | Punto que Georef calculó por altura sobre la calle escrita. Puede estar corrido una o dos cuadras; no es una referencia verificada. |
| 4 | **Cuadra vecina** | Catálogo | Registro de la calle a una o dos cuadras de la altura escrita. La fila indica a cuántas. |
| 5 | **Misma calle** | Catálogo | Registro de la calle a más de dos cuadras, sin cuadra para comparar, o búsqueda sin altura. Se muestran hasta 8, primero los más cercanos (sin altura, de menor a mayor). |
| 6 | **La calle existe** | Georef | Georef conoce la calle en esa localidad, pero no ubicó la dirección allí. Muestra el rango de alturas cuando se conoce y sólo ofrece buscar por texto en Google Maps. Hasta 5 filas. |
| 7 | **Parecido** | Catálogo o Georef | El nombre sólo se parece al escrito, o es una coincidencia del motor sin confianza. Hasta 5 filas. |

Dentro de las filas de Georef, las de la ciudad de Santa Fe van primero. Las filas del catálogo conservan sus tres acciones; una «Dirección interpolada» ofrece abrir el punto y cómo llegar, y «La calle existe» sólo la búsqueda por texto.

### Cómo se compara la altura

- **Por cuadra (centena), nunca por número exacto.** Cada registro de calle del catálogo (`Sobre San Martin 8500`) marca la cuadra entera, del 8500 al 8599. `san martin 8540` cae en esa cuadra; `san martin 2500` no.
- **Nunca con tolerancia a errores.** Un número no se corrige ni se completa: `2500` no coincide con `8500`. Lo mismo vale para el motor de búsqueda, que no aplica tolerancia a las palabras que tienen dígitos.
- **Cuadras dobles.** Un registro escrito `Pje 32,50 8300 / 8400` cubre las dos cuadras.
- **La altura es el último número del texto** (de 1 a 5 dígitos), siempre que antes haya un nombre de calle. `25 de mayo` no tiene altura.

### Cómo se compara el nombre de la calle

- **Dos nombres por registro.** Se compara contra el nombre popular y contra el nombre con el que figura en Google Maps (alias); la fila muestra ambos. Un alias con dos nombres separados por barra (`Luciano Leiva / Bernardo de Irigoyen`) cuenta como dos.
- **Palabras que no cuentan.** Se ignoran las que indican el tipo de vía (`sobre`, `calle`, `av`, `avda`, `avenida`, `bv`, `boulevard`, `pje`, `pasaje`, `cjon`, `callejon`) y las palabras vacías (`de`, `del`, `la`, `el`, `los`, `las`, `y`, `en`, `por`, `al`), además de mayúsculas y tildes.
- **Tolerancia a errores de tipeo según el largo de la palabra:** ninguna en palabras de menos de 4 letras, 1 error en las de 4 a 7 y 2 errores en las de 8 o más. Intercambiar dos letras vecinas cuenta como un solo error. Si las dos palabras tienen distinto largo, manda la más corta. Las palabras con dígitos no tienen tolerancia: `9 de julio` no es `8 de julio`.
- **Iniciales.** Una letra suelta coincide con una palabra que empieza con esa letra (`f aguayo` con `Francisco Aguayo`, y al revés), pero sólo como ayuda: un texto hecho únicamente de letras sueltas no nombra ninguna calle.
- **Pasajes con nombre decimal.** En `Pje 38,50` el decimal es el nombre de la calle, no una altura. La coma y el punto son equivalentes y los ceros finales no cuentan: `40,5` y `40,50` son el mismo pasaje. `pje 38.50 1200` se lee como pasaje 38,50 al 1200.
- **Coincidencia completa o sólo parecida.** La calle coincide cuando todas las palabras escritas tienen su par y al nombre del registro no le sobra nada más que iniciales. Si al registro le sobran palabras, o la última palabra escrita es sólo el comienzo de otra (3 letras o más), el resultado es «Parecido». Si se escriben más palabras que las que tiene el nombre, no coincide.
- **Intersecciones.** La calle que cruza se envía a Georef; contra el catálogo se compara sólo la calle principal.

### Confirmación y discrepancia entre fuentes

- Si un registro de «Misma cuadra» tiene una dirección de Georef a **300 m o menos**, pasa a «Cuadra confirmada». Cada dirección de Georef confirma un solo registro: el más cercano.
- Si el registro queda sin confirmar y Georef ubica esa dirección en la ciudad de Santa Fe en otro punto, la fila lo advierte («Georef ubica esta dirección a N m de este punto») y la dirección de Georef se muestra aparte como «Dirección interpolada». El operador decide.
- Las localidades cuyo rango de alturas no puede contener la altura escrita se descartan (por ejemplo, una calle que en Recreo llega al 1599 no se muestra para la altura 8540). Si Georef no informa los dos extremos del rango, no se descarta nada.

### Cuándo aparecen las filas «Parecido»

Sólo cuando las categorías 0 a 6 están vacías: alcanza una fila «La calle existe» para ocultarlas. Como Georef responde después que el catálogo, puede ocurrir que las filas «Parecido» se vean un momento y luego desaparezcan. La excepción es la fila que el operador ya eligió: esa queda visible aunque lleguen resultados mejores.

### Teclado y selección automática

- **Enter sin elegir** abre un resultado únicamente en dos casos: hay una sola «Referencia» clara (la regla de siempre) y ninguna fila de cuadra; o hay una sola fila «Cuadra confirmada» o «Misma cuadra» y ninguna «Referencia». En cualquier otro caso no abre nada y pide elegir con ↑ ↓.
- **Las filas que sólo aporta Georef nunca se seleccionan solas**, aunque sean las únicas. La misma calle y altura puede existir en varias localidades.
- **La elección del operador no se mueve.** Elegir una fila (con ↑ ↓ o pasando el mouse) la fija: las respuestas de Georef que lleguen después pueden agregar filas arriba o abajo, pero la fila elegida sigue siendo la misma, también si la lista simple se convierte en categorizada. Si la fila elegida dejara de estar en pantalla, Enter no abre nada.
- En una fila «La calle existe», Enter abre la búsqueda por texto en Google Maps (calle, altura escrita y localidad), porque no hay coordenadas.

### Límites conocidos

- **Georef tiene huecos.** Una calle que `/calles` lista puede no devolver nada en `/direcciones` (`rivadavia 1500` en la ciudad de Santa Fe). Que no haya dirección interpolada no significa que la calle no exista: por eso existe la categoría «La calle existe».
- **Georef no conoce barrios ni lugares:** sólo calles y alturas.
- **Sin garantía de disponibilidad.** Es un servicio público; el buscador funciona sin él, sólo con el catálogo.
- **Pasajes «S/N».** Los registros `Pje S/N <cuadra>` no se encuentran por nombre de calle, porque su nombre son sólo letras sueltas.
- **Ordinales.** `1ro de Mayo` necesita la grafía exacta; `1 de mayo` no coincide.
- **Texto después de la altura.** En `san martin 2500 depto 3` se toma el `3` como altura y el resto como nombre de calle. Conviene escribir sólo calle y altura.
- **Calle que sólo conoce Georef, escrita sin altura.** Hasta que Georef responde, la pantalla puede indicar «Sin coincidencias».
- **Umbrales provisorios.** Las dos cuadras de «Cuadra vecina», los 300 m de confirmación, la tolerancia a errores y los topes de filas son valores iniciales, pendientes de validar con el operador. Están en `src/lib/categorize.ts` y `src/lib/address.ts`.

### Diagnóstico

La consola del navegador registra cada consulta: las líneas con prefijo `[georef]` indican qué se pidió a Georef, cuánto tardó y qué devolvió (o que la respuesta se descartó porque el texto cambió); las líneas `[rank]` indican, para cada texto, cuántas filas hay de cada categoría y qué fila se selecciona sola, o que no se trató como búsqueda de calle.

## Fuentes de datos (uno o varios Excel)

Todos los libros pasan por el **mismo importador, las mismas validaciones y el mismo buscador**, y terminan en un único catálogo. Las fuentes se declaran en `data-sources.json`:

```json
{
  "sources": [
    { "id": "fonavis", "file": "../Fonavis 1 .xlsx" },
    { "id": "torres", "file": "../Torres similares.xlsx" }
  ]
}
```

Para **agregar otro Excel**, sumá una línea con un `id` corto y único (se usa de prefijo en los ids de cada registro) y volvé a importar. Cada registro conserva el archivo, la hoja y la celda de origen.

## Actualizar los datos

```bash
npm run import                       # todas las fuentes de data-sources.json
npm run import -- "a.xlsx" "b.xlsx"  # sólo estos archivos (los ids se toman del nombre)
```

Lee los libros sin modificarlos y regenera siempre el catálogo completo:

| Archivo | Contenido |
| --- | --- |
| `public/data/references.json` | Catálogo buscable (todas las fuentes) |
| `reports/invalid-records.json` | Descartados con su motivo, advertencias, celdas sin clasificar, hojas omitidas |
| `reports/transformation-summary.md` | Estadísticas por fuente, hoja y tipo |
| `reports/excel-audit.md` | Resumen y hallazgos **entre** fuentes (coordenadas repetidas en hojas distintas) |
| `reports/audit-<fuente>.md` | Auditoría detallada de cada libro |

Tarda unos 12 segundos porque la hoja `Santa Rita 1` de Fonavis declara más de un millón de filas. Después de importar, revisá los reportes: *celdas sin clasificar* nuevas significan que el libro tiene un bloque que el importador todavía no reconoce, y las *advertencias* son puntos que se importan pero conviene verificar.

> **Limitación.** El importador entiende el formato de ficha de estos libros (bloques "Información General", calles, "Referencias Propias y Cercanas" y grillas de torres/monoblocks/manzanas/casas). Un libro con otra estructura necesita un parser adicional; mientras tanto sus celdas se listan como sin clasificar en vez de importarse mal.

## Otros comandos

```bash
npm test          # importador, coordenadas, Maps, compartir, búsqueda, direcciones, categorización, Georef, teclado
npm run typecheck # TypeScript
npm run build     # build de producción en dist/
npm run benchmark # compara motores de búsqueda sobre los datos reales
```

`tests/importer.test.ts` vuelve a ejecutar el importador contra los Excel declarados en `data-sources.json`; si alguno no está, esos tests se omiten.

## Estructura

```
data-sources.json   Libros que alimentan el catálogo
scripts/            Procesamiento del Excel (lectura, parser por secciones, validación, reportes)
public/data/        Datos normalizados
src/lib/            Lógica pura: búsqueda, normalización, URLs de Maps, catálogo, consulta a Georef,
                    lectura de direcciones (address.ts) y categorización de coincidencias (categorize.ts)
src/components/     Componentes visuales (lista simple: ResultList; lista categorizada: RankedResults)
reports/            Auditorías, decisiones técnicas, resumen y registros inválidos
tests/              Tests, incluido el set de relevancia con registros reales (gold.ts)
```

## Más información

- `reports/excel-audit.md`: resumen de las fuentes y hallazgos entre ellas; el detalle de cada libro está en `reports/audit-<fuente>.md`.
- `reports/technical-decisions.md`: motor elegido, métricas medidas, reglas de ranking y categorización de coincidencias con Georef.
- `reports/transformation-summary.md`: cantidades por fuente, hoja, tipo y motivo de descarte.
