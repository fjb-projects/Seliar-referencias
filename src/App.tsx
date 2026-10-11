import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { GeorefResults } from './components/GeorefResults';
import { ResultList, optionId } from './components/ResultList';
import { loadCatalog } from './lib/catalog';
import { looksLikeAddress, searchGeoref } from './lib/georef';
import type { GeorefHit } from './lib/georef';
import { buildMapsUrl, buildMapsUrlFor } from './lib/maps';
import { SearchEngine } from './lib/search';
import { shareReference } from './lib/share';
import type { Reference } from './lib/types';

const MAX_RESULTS = 10;
const GEOREF_DEBOUNCE_MS = 400;

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; engine: SearchEngine };

function useEngine(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(undefined, controller.signal)
      .then((refs) => setState({ status: 'ready', engine: new SearchEngine(refs) }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Error desconocido' });
      });
    return () => controller.abort();
  }, []);
  return state;
}

type GeorefState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; hits: GeorefHit[] };

/**
 * Looks the query up in Georef, debounced, only while `enabled`. The request is
 * aborted when the query changes or the component unmounts, and stale answers
 * are ignored. `searchGeoref` never throws: failure and empty both mean `done` with no hits.
 */
function useGeoref(query: string, enabled: boolean): GeorefState {
  const [result, setResult] = useState<{ query: string; hits: GeorefHit[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchGeoref(query, controller.signal).then((hits) => {
        if (!controller.signal.aborted) setResult({ query, hits });
      });
    }, GEOREF_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      // Drop the stored answer so a later re-enable never reports stale hits.
      setResult(null);
    };
  }, [query, enabled]);
  if (!enabled) return { status: 'idle' };
  return result?.query === query ? { status: 'done', hits: result.hits } : { status: 'loading' };
}

export default function App() {
  const catalog = useEngine();
  const [query, setQuery] = useState('');
  // Index chosen by the operator; null means "follow the engine's suggestion".
  const [picked, setPicked] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const response = useMemo(
    () => (catalog.status === 'ready' ? catalog.engine.search(query, MAX_RESULTS) : null),
    [catalog, query],
  );
  const hits = response?.hits ?? [];
  const activeIndex = picked !== null && picked < hits.length ? picked : (response?.autoSelect ?? -1);

  const trimmed = query.trim();
  const total = hits.length;
  // Georef only runs when the local engine found nothing for an address-shaped query.
  const georefEnabled = catalog.status === 'ready' && total === 0 && looksLikeAddress(trimmed);
  const georef = useGeoref(trimmed, georefEnabled);
  const georefHits = georef.status === 'done' ? georef.hits : [];
  // Separate from `picked`: Georef results are never auto-selected.
  const [geoPicked, setGeoPicked] = useState<number | null>(null);
  const geoActive = geoPicked !== null && geoPicked < georefHits.length ? geoPicked : -1;
  const geoMode = georefHits.length > 0;

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
    setPicked(null);
    setGeoPicked(null);
    setNotice(null);
  };

  const openGeoref = () => {
    if (geoActive < 0) {
      setNotice('Elegí una dirección aproximada con ↑ ↓ y Enter.');
      return;
    }
    const hit = georefHits[geoActive];
    const url = buildMapsUrl(hit.latitude, hit.longitude);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openActive = () => {
    if (activeIndex < 0) {
      if (hits.length > 0) setNotice('Hay varias coincidencias posibles: elegí una con ↑ ↓ y Enter.');
      return;
    }
    const url = buildMapsUrlFor(hits[activeIndex].ref);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const share = async (ref: Reference) => {
    const outcome = await shareReference(ref);
    if (outcome === 'copied') setNotice('Enlace copiado al portapapeles: pegalo donde quieras enviarlo.');
    else if (outcome === 'unavailable') setNotice('Este navegador no permite compartir ni copiar desde acá.');
    else setNotice(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (geoMode) {
      const n = georefHits.length;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setGeoPicked(geoActive < 0 ? 0 : (geoActive + 1) % n);
          setNotice(null);
          return;
        case 'ArrowUp':
          e.preventDefault();
          setGeoPicked(geoActive <= 0 ? n - 1 : geoActive - 1);
          setNotice(null);
          return;
        case 'Enter':
          e.preventDefault();
          openGeoref();
          return;
        case 'Escape':
          e.preventDefault();
          if (geoPicked !== null) setGeoPicked(null);
          else changeQuery('');
          return;
      }
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (hits.length) setPicked(activeIndex < 0 ? 0 : (activeIndex + 1) % hits.length);
        setNotice(null);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (hits.length) setPicked(activeIndex <= 0 ? hits.length - 1 : activeIndex - 1);
        setNotice(null);
        break;
      case 'Enter':
        e.preventDefault();
        openActive();
        break;
      case 'Escape':
        e.preventDefault();
        if (picked !== null) setPicked(null);
        else changeQuery('');
        break;
    }
  };

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
          aria-expanded={total > 0 || geoMode}
          aria-controls={listId}
          aria-activedescendant={
            geoMode
              ? geoActive >= 0
                ? optionId(listId, geoActive)
                : undefined
              : activeIndex >= 0
                ? optionId(listId, activeIndex)
                : undefined
          }
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
        {catalog.status === 'ready' &&
          trimmed === '' &&
          'Empezá a escribir para buscar. ↑ ↓ para recorrer, Enter para abrir en Google Maps, Esc para limpiar.'}
        {georef.status === 'loading' && 'Buscando dirección aproximada…'}
        {catalog.status === 'ready' && trimmed !== '' && total === 0 && !georefEnabled && `Sin coincidencias para «${trimmed}».`}
        {response?.partial && total > 0 && 'No hay resultados con todas las palabras: se muestran coincidencias parciales.'}
        {notice ??
          (!response?.partial && total > 1 && activeIndex < 0
            ? 'Varias coincidencias posibles: elegí una con ↑ ↓.'
            : null)}
      </div>

      {georef.status === 'done' && (
        <GeorefResults hits={georefHits} query={trimmed} activeIndex={geoActive} listId={listId} onHover={setGeoPicked} />
      )}
      {total > 0 && <ResultList hits={hits} activeIndex={activeIndex} listId={listId} onHover={setPicked} onShare={share} />}
    </main>
  );
}
