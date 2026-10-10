import { useEffect, useRef } from 'react';
import { displayBarrio, formatCoordinates, TIPO_LABEL } from '../lib/format';
import { buildDirectionsUrlFor, buildMapsUrlFor, MAPS_LINK_PROPS } from '../lib/maps';
import type { SearchHit } from '../lib/search';
import type { Reference } from '../lib/types';

interface Props {
  hits: SearchHit[];
  activeIndex: number;
  listId: string;
  onHover: (index: number) => void;
  onShare: (ref: Reference) => void;
}

export const optionId = (listId: string, index: number) => `${listId}-opt-${index}`;

export function ResultList({ hits, activeIndex, listId, onHover, onShare }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <ul className="results" role="listbox" id={listId} aria-label="Resultados">
      {hits.map(({ ref }, index) => {
        const url = buildMapsUrlFor(ref);
        const directionsUrl = buildDirectionsUrlFor(ref);
        const active = index === activeIndex;
        const detail = ref.direccion ?? ref.descripcion;
        const alias = ref.aliases.length ? `Figura en Google Maps como «${ref.aliases.join(', ')}»` : null;
        return (
          <li
            key={ref.id}
            id={optionId(listId, index)}
            ref={active ? activeRef : undefined}
            role="option"
            aria-selected={active}
            className={active ? 'result is-active' : 'result'}
            onMouseMove={() => !active && onHover(index)}
          >
            <div className="result-main">
              <div className="result-head">
                <span className="result-name">{ref.nombre}</span>
                <span className="badge">{TIPO_LABEL[ref.tipo] ?? ref.tipo}</span>
              </div>
              <div className="result-barrio">
                {displayBarrio(ref.barrio)}
                {ref.zona ? <span className="muted"> · zona {ref.zona}</span> : null}
              </div>
              {detail ? <div className="result-detail">{detail}</div> : null}
              {alias ? <div className="result-detail muted">{alias}</div> : null}
              <div className="result-coords muted">{formatCoordinates(ref.latitude, ref.longitude)}</div>
            </div>
            {url && directionsUrl ? (
              <div className="result-actions">
                <a className="maps-link" href={url} {...MAPS_LINK_PROPS} tabIndex={-1}>
                  Abrir en Google Maps
                </a>
                <div className="result-actions-secondary">
                  <a
                    className="maps-link is-secondary"
                    href={directionsUrl}
                    {...MAPS_LINK_PROPS}
                    tabIndex={-1}
                    aria-label={`Cómo llegar a ${ref.nombre}`}
                  >
                    Cómo llegar
                  </a>
                  <button
                    type="button"
                    className="maps-link is-secondary"
                    tabIndex={-1}
                    aria-label={`Compartir ${ref.nombre}`}
                    onClick={() => onShare(ref)}
                  >
                    Compartir
                  </button>
                </div>
              </div>
            ) : (
              <span className="maps-link is-disabled">Sin coordenadas válidas</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
