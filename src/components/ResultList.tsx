import { useEffect, useRef } from 'react';
import { displayBarrio, formatCoordinates, TIPO_LABEL } from '../lib/format';
import { buildMapsUrlFor, MAPS_LINK_PROPS } from '../lib/maps';
import type { SearchHit } from '../lib/search';

interface Props {
  hits: SearchHit[];
  activeIndex: number;
  listId: string;
  onHover: (index: number) => void;
}

export const optionId = (listId: string, index: number) => `${listId}-opt-${index}`;

export function ResultList({ hits, activeIndex, listId, onHover }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <ul className="results" role="listbox" id={listId} aria-label="Resultados">
      {hits.map(({ ref }, index) => {
        const url = buildMapsUrlFor(ref);
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
            {url ? (
              <a className="maps-link" href={url} {...MAPS_LINK_PROPS} tabIndex={-1}>
                Abrir en Google Maps
              </a>
            ) : (
              <span className="maps-link is-disabled">Sin coordenadas válidas</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
