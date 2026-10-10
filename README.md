# Buscador de referencias

Buscador instantáneo de referencias georreferenciadas para radiooperadores. Se escribe un lugar, calle o barrio, se identifica la coincidencia correcta y se abre su ubicación exacta en Google Maps. Todo corre en el navegador: sin backend, sin servicios pagos y sin solicitudes HTTP por consulta.

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
| Enter | Abre en Google Maps el resultado seleccionado |
| Esc | Quita la selección; otra vez, limpia la búsqueda |
| Ctrl + K | Enfoca el buscador desde cualquier lugar |

Si hay varias coincidencias posibles (por ejemplo `UTN` existe en dos barrios), **no se selecciona ninguna**: se elige con ↑ ↓. Con una única coincidencia clara, Enter la abre directamente.

Cada resultado ofrece tres acciones, todas basadas únicamente en las coordenadas guardadas:

| Acción | Qué hace |
| --- | --- |
| **Abrir en Google Maps** | Pin en el punto exacto (es lo que abre Enter). |
| **Cómo llegar** | Ruta hasta el punto. Sin origen, Google Maps parte de la ubicación del dispositivo; en un celular abre la app instalada. |
| **Compartir** | Abre el menú de compartir del dispositivo (WhatsApp, SMS, mail…) con nombre, barrio y el enlace del pin. Si el navegador no lo tiene (típico en PC), copia el texto con el enlace al portapapeles. |

> El menú de compartir y la geolocalización del celular sólo funcionan con la app servida por **HTTPS** (en `localhost` también). Probar el menú real de compartir requiere un teléfono.

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
npm test          # 176 tests (importador, coordenadas, Maps, compartir, búsqueda, teclado)
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
src/lib/            Lógica pura: búsqueda, normalización, URLs de Maps, catálogo
src/components/     Componentes visuales
reports/            Auditorías, decisiones técnicas, resumen y registros inválidos
tests/              Tests, incluido el set de relevancia con registros reales (gold.ts)
```

## Más información

- `reports/excel-audit.md`: resumen de las fuentes y hallazgos entre ellas; el detalle de cada libro está en `reports/audit-<fuente>.md`.
- `reports/technical-decisions.md`: motor elegido, métricas medidas y reglas de ranking.
- `reports/transformation-summary.md`: cantidades por fuente, hoja, tipo y motivo de descarte.
