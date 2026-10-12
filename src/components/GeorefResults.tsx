import { useEffect, useRef } from 'react';
import { formatCoordinates } from '../lib/format';
import type { GeorefHit } from '../lib/georef';
import { buildDirectionsUrl, buildMapsTextUrl, buildMapsUrl, MAPS_LINK_PROPS } from '../lib/maps';
import { optionId } from './ResultList';

interface Props {
  hits: GeorefHit[];
  query: string;
  activeIndex: number;
  listId: string;
  onHover: (index: number) => void;
}

const GEOREF_BADGE = 'Dirección aproximada · Georef';

/** Approximate addresses from Georef; visually and textually distinct from verified references. */
export function GeorefResults({ hits, query, activeIndex, listId, onHover }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  if (hits.length === 0) {
    const textUrl = buildMapsTextUrl(query.trim());
    return (
      <div className="georef-empty">
        <p>No encontramos esa dirección en Georef.</p>
        {textUrl ? (
          <a className="maps-link" href={textUrl} {...MAPS_LINK_PROPS}>
            Buscar «{query.trim()}» en Google Maps
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="results georef-results" role="listbox" id={listId} aria-label="Direcciones aproximadas">
      {hits.map((hit, index) => {
        const url = buildMapsUrl(hit.latitude, hit.longitude);
        const directionsUrl = buildDirectionsUrl(hit.latitude, hit.longitude);
        const active = index === activeIndex;
        return (
          <li
            key={`${hit.label}|${hit.localidad}|${index}`}
            id={optionId(listId, index)}
            ref={active ? activeRef : undefined}
            role="option"
            aria-selected={active}
            className={active ? 'result is-active' : 'result'}
            onMouseMove={() => !active && onHover(index)}
          >
            <div className="result-main">
              <div className="result-head">
                <span className="result-name">{hit.label}</span>
                <span className="badge georef-badge">{GEOREF_BADGE}</span>
              </div>
              {hit.localidad ? <div className="georef-localidad">{hit.localidad}</div> : null}
              <div className="result-coords muted">{formatCoordinates(hit.latitude, hit.longitude)}</div>
              <div className="result-detail muted">
                Punto interpolado: puede estar corrido una cuadra o dos.
              </div>
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
                    aria-label={`Cómo llegar a ${hit.label}`}
                  >
                    Cómo llegar
                  </a>
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
