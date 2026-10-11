import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { RankedResults } from './components/RankedResults';
import { ResultList, optionId } from './components/ResultList';
import { parseAddressQuery, streetQueryText } from './lib/address';
import { loadCatalog } from './lib/catalog';
import { buildStreetIndex, catalogKey, rankResults } from './lib/categorize';
import type { RankedItem, RankOutput, StreetIndexEntry } from './lib/categorize';
import { CATEGORY_LABEL, streetSearchText } from './lib/format';
import { searchGeoref, searchGeorefStreets } from './lib/georef';
import type { GeorefHit, GeorefStreet } from './lib/georef';
import { buildMapsTextUrl, buildMapsUrl, buildMapsUrlFor, MAPS_LINK_PROPS } from './lib/maps';
import { SearchEngine } from './lib/search';
import type { SearchHit } from './lib/search';
import { shareReference } from './lib/share';
import type { Reference } from './lib/types';

const MAX_RESULTS = 10;
const GEOREF_DEBOUNCE_MS = 400;
/** A street text worth sending to Georef: a word of three letters or more, or the decimal of a passage. */
const NAMES_A_STREET = /\p{L}{3,}|\d+\.\d+/u;
const PICK_NOTICE = 'Hay varias coincidencias posibles: elegí una con ↑ ↓ y Enter.';
const NO_ROWS: RankedItem[] = [];
const NO_HITS: SearchHit[] = [];

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; references: Reference[]; engine: SearchEngine; streets: StreetIndexEntry[] };

function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(undefined, controller.signal)
      .then((references) =>
        setState({
          status: 'ready',
          references,
          engine: new SearchEngine(references),
          // Parsed once per catalog: every keystroke only grades names against it.
          streets: buildStreetIndex(references),
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Error desconocido' });
      });
    return () => controller.abort();
  }, []);
  return state;
}

interface GeorefAnswer {
  addresses: GeorefHit[];
  streets: GeorefStreet[];
}

type GeorefState = { status: 'idle' } | { status: 'loading' } | ({ status: 'done' } & GeorefAnswer);

/**
 * Looks the query up in Georef, debounced, while `streetText` is not empty: the street by name
 * always, and the whole text as an address when `withAddress` is set. Both requests run in
 * parallel and are aborted when the query changes or the component unmounts; stale answers are
 * ignored. The lookups never throw: failure and empty both mean `done` with nothing found.
 */
function useGeoref(query: string, streetText: string, withAddress: boolean): GeorefState {
  const [result, setResult] = useState<({ query: string } & GeorefAnswer) | null>(null);
  const enabled = streetText !== '';
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const started = performance.now();
      console.log(
        withAddress
          ? `[georef] querying /calles «${streetText}» and /direcciones «${query}»`
          : `[georef] querying /calles «${streetText}» (no number or cross street: /direcciones not asked)`,
      );
      const addressLookup = withAddress ? searchGeoref(query, controller.signal) : Promise.resolve<GeorefHit[]>([]);
      void Promise.all([addressLookup, searchGeorefStreets(streetText, controller.signal)]).then(([addresses, streets]) => {
        if (controller.signal.aborted) {
          console.log(`[georef] discarded «${query}» (query changed or aborted)`);
          return;
        }
        const took = Math.round(performance.now() - started);
        console.log(
          `[georef] «${query}» -> ${addresses.length} address(es), ${streets.length} street(s) in ${took} ms`,
          { addresses, streets },
        );
        setResult({ query, addresses, streets });
      });
    }, GEOREF_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      // Drop the stored answer so a later re-enable never reports a stale one.
      setResult(null);
    };
  }, [query, streetText, withAddress, enabled]);
  if (!enabled) return { status: 'idle' };
  return result?.query === query
    ? { status: 'done', addresses: result.addresses, streets: result.streets }
    : { status: 'loading' };
}

/** "2 Misma cuadra, 3 Misma calle": how many rows of each category a ranking holds. */
function categoryCounts(items: RankedItem[]): string {
  const counts = new Map<number, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts].map(([category, count]) => `${count} ${CATEGORY_LABEL[category]}`).join(', ') || 'no rows';
}

/** Where Enter or a click takes the operator for a ranked row, or null when no safe link exists. */
function rankedUrl(item: RankedItem, queryNumber: number | null): string | null {
  if (item.source === 'catalog') return buildMapsUrlFor(item.ref);
  if (item.kind === 'address') return buildMapsUrl(item.hit.latitude, item.hit.longitude);
  // Georef knows the street but gave no point: all that is left is a search by name.
  return buildMapsTextUrl(streetSearchText(item.street.nombre, queryNumber), item.street.localidad);
}

function openInMaps(url: string | null): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

export default function App() {
  const catalog = useCatalog();
  const ready = catalog.status === 'ready';
  const [query, setQuery] = useState('');
  // Row chosen by the operator, by key, in whichever list is on screen: rows Georef adds later
  // cannot move it, and it survives the switch between the plain list and the ranked one.
  // Null means "follow the suggestion".
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const response = useMemo(
    () => (catalog.status === 'ready' ? catalog.engine.search(query, MAX_RESULTS) : null),
    [catalog, query],
  );
  const hits = response?.hits ?? NO_HITS;
  const total = hits.length;

  const trimmed = query.trim();
  const parsed = useMemo(() => parseAddressQuery(trimmed), [trimmed]);
  const streetText = useMemo(() => streetQueryText(trimmed), [trimmed]);
  // Georef is asked about every street-shaped text, whatever the catalog found for it.
  const georefText = ready && NAMES_A_STREET.test(streetText) ? streetText : '';
  const georef = useGeoref(trimmed, georefText, parsed.number !== null || parsed.crossTokens !== null);
  const georefAddresses = georef.status === 'done' ? georef.addresses : null;
  const georefStreets = georef.status === 'done' ? georef.streets : null;

  const rank = useMemo<RankOutput | null>(() => {
    if (catalog.status !== 'ready' || response === null) return null;
    return rankResults({
      query: parsed,
      engine: response,
      streets: catalog.streets,
      georefAddresses,
      georefStreets,
      pinnedKey: pickedKey,
    });
  }, [catalog, response, parsed, georefAddresses, georefStreets, pickedKey]);

  const streetMode = rank?.streetMode ?? false;
  const items = rank?.streetMode ? rank.items : NO_ROWS;
  // The keys of the rows on screen, in order. A catalog record has the same key in both lists.
  const rowKeys = useMemo(
    () => (streetMode ? items.map((item) => item.key) : hits.map((hit) => catalogKey(hit.ref))),
    [streetMode, items, hits],
  );
  const suggested = (streetMode ? rank?.autoSelect : response?.autoSelect) ?? -1;
  // The suggestion only stands in while the operator has picked nothing. A pick whose row is not
  // on screen leaves no active row: Enter must never open a row the operator did not choose.
  const activeIndex = pickedKey === null ? suggested : rowKeys.indexOf(pickedKey);
  const rowCount = rowKeys.length;

  // One trace line per ranking: when the query settles and again when Georef answers, never per render.
  const traceRef = useRef('');
  useEffect(() => {
    if (rank === null) traceRef.current = '';
    else if (!rank.streetMode) traceRef.current = `not a street query, ${total} engine hit(s)`;
    else traceRef.current = `${categoryCounts(rank.items)}; auto-select ${rank.autoSelect}`;
  });
  useEffect(() => {
    if (!ready || trimmed === '') return;
    const log = () => console.log(`[rank] «${trimmed}» (georef ${georef.status}) -> ${traceRef.current}`);
    const timer = setTimeout(log, georef.status === 'done' ? 0 : GEOREF_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ready, trimmed, georef.status]);

  // Ctrl+K from anywhere focuses the search box.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeQuery = (value: string) => {
    setQuery(value);
    setPickedKey(null);
    setNotice(null);
  };

  const openActive = () => {
    if (activeIndex < 0) {
      if (rowCount > 0) setNotice(PICK_NOTICE);
      return;
    }
    openInMaps(streetMode ? rankedUrl(items[activeIndex], parsed.number) : buildMapsUrlFor(hits[activeIndex].ref));
  };

  const share = async (ref: Reference) => {
    const outcome = await shareReference(ref);
    if (outcome === 'copied') setNotice('Enlace copiado al portapapeles: pegalo donde quieras enviarlo.');
    else if (outcome === 'unavailable') setNotice('Este navegador no permite compartir ni copiar desde acá.');
    else setNotice(null);
  };

  /** Moves the pick to another row of the list on screen, by its index. */
  const pickRow = (index: number) => setPickedKey(rowKeys[index]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (rowCount) pickRow(activeIndex < 0 ? 0 : (activeIndex + 1) % rowCount);
        setNotice(null);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (rowCount) pickRow(activeIndex <= 0 ? rowCount - 1 : activeIndex - 1);
        setNotice(null);
        break;
      case 'Enter':
        e.preventDefault();
        openActive();
        break;
      case 'Escape':
        e.preventDefault();
        if (pickedKey !== null) setPickedKey(null);
        else changeQuery('');
        break;
    }
  };

  const searching = streetMode && georef.status === 'loading';
  // Nothing to show, and nothing still on its way.
  const noMatches = ready && trimmed !== '' && rowCount === 0 && !searching;
  const textUrl = noMatches ? buildMapsTextUrl(trimmed) : null;

  return (
    <main className="app">
      <h1 className="title">Buscador de referencias</h1>

      <div className="search">
        <input
          ref={inputRef}
          autoFocus
          type="search"
          className="search-input"
          placeholder="Escribí un lugar, calle o barrio…  (Ctrl+K)"
          aria-label="Buscar referencia"
          role="combobox"
          aria-expanded={rowCount > 0}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(listId, activeIndex) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="status" role="status" aria-live="polite">
        {catalog.status === 'loading' && 'Cargando referencias…'}
        {catalog.status === 'error' && (
          <span className="error">
            {catalog.message}. <button onClick={() => window.location.reload()}>Reintentar</button>
          </span>
        )}
        {ready &&
          trimmed === '' &&
          'Empezá a escribir para buscar. ↑ ↓ para recorrer, Enter para abrir en Google Maps, Esc para limpiar.'}
        {searching && 'Buscando en Georef… '}
        {noMatches && `Sin coincidencias para «${trimmed}».`}
        {!streetMode &&
          response?.partial &&
          total > 0 &&
          'No hay resultados con todas las palabras: se muestran coincidencias parciales.'}
        {notice ??
          (!(response?.partial && !streetMode) && rowCount > 1 && activeIndex < 0
            ? 'Varias coincidencias posibles: elegí una con ↑ ↓.'
            : null)}
      </div>

      {textUrl ? (
        <p className="maps-fallback">
          <a className="maps-link" href={textUrl} {...MAPS_LINK_PROPS}>
            Buscar «{trimmed}» en Google Maps
          </a>
        </p>
      ) : null}
      {streetMode && items.length > 0 && (
        <RankedResults
          items={items}
          activeIndex={activeIndex}
          listId={listId}
          queryNumber={parsed.number}
          onHover={setPickedKey}
          onShare={share}
        />
      )}
      {!streetMode && total > 0 && (
        <ResultList hits={hits} activeIndex={activeIndex} listId={listId} onHover={pickRow} onShare={share} />
      )}
    </main>
  );
}
