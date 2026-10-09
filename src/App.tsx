import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ResultList, optionId } from './components/ResultList';
import { loadCatalog } from './lib/catalog';
import { buildMapsUrlFor } from './lib/maps';
import { SearchEngine } from './lib/search';

const MAX_RESULTS = 10;

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
    setNotice(null);
  };

  const openActive = () => {
    if (activeIndex < 0) {
      if (hits.length > 0) setNotice('Hay varias coincidencias posibles: elegí una con ↑ ↓ y Enter.');
      return;
    }
    const url = buildMapsUrlFor(hits[activeIndex].ref);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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

  const trimmed = query.trim();
  const total = hits.length;

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
          aria-expanded={total > 0}
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
        {catalog.status === 'ready' &&
          trimmed === '' &&
          'Empezá a escribir para buscar. ↑ ↓ para recorrer, Enter para abrir en Google Maps, Esc para limpiar.'}
        {catalog.status === 'ready' && trimmed !== '' && total === 0 && `Sin coincidencias para «${trimmed}».`}
        {response?.partial && total > 0 && 'No hay resultados con todas las palabras: se muestran coincidencias parciales.'}
        {notice ??
          (!response?.partial && total > 1 && activeIndex < 0
            ? 'Varias coincidencias posibles: elegí una con ↑ ↓.'
            : null)}
      </div>

      {total > 0 && <ResultList hits={hits} activeIndex={activeIndex} listId={listId} onHover={setPicked} />}
    </main>
  );
}
