import type { ReactNode } from 'react';
import { displayBarrio, formatCoordinates, TIPO_LABEL } from '../lib/format';
import { buildDirectionsUrlFor, buildMapsUrlFor, MAPS_LINK_PROPS } from '../lib/maps';
import type { Reference } from '../lib/types';

interface Props {
  reference: Reference;
  onShare: (ref: Reference) => void;
  /** Extra badges, after the one that tells the kind of record. */
  badges?: ReactNode;
  /** Extra lines about this result, after the coordinates. */
  notes?: ReactNode;
}

/** What a catalog record shows inside its row of a result list: its data and its actions. */
export function ReferenceRow({ reference, onShare, badges, notes }: Props) {
  const url = buildMapsUrlFor(reference);
  const directionsUrl = buildDirectionsUrlFor(reference);
  const detail = reference.direccion ?? reference.descripcion;
  const alias = reference.aliases.length ? `Figura en Google Maps como «${reference.aliases.join(', ')}»` : null;
  return (
    <>
      <div className="result-main">
        <div className="result-head">
          <span className="result-name">{reference.nombre}</span>
          <span className="badge">{TIPO_LABEL[reference.tipo] ?? reference.tipo}</span>
          {badges}
        </div>
        <div className="result-barrio">
          {displayBarrio(reference.barrio)}
          {reference.zona ? <span className="muted"> · zona {reference.zona}</span> : null}
        </div>
        {detail ? <div className="result-detail">{detail}</div> : null}
        {alias ? <div className="result-detail muted">{alias}</div> : null}
        <div className="result-coords muted">{formatCoordinates(reference.latitude, reference.longitude)}</div>
        {notes}
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
              aria-label={`Cómo llegar a ${reference.nombre}`}
            >
              Cómo llegar
            </a>
            <button
              type="button"
              className="maps-link is-secondary"
              tabIndex={-1}
              aria-label={`Compartir ${reference.nombre}`}
              onClick={() => onShare(reference)}
            >
              Compartir
            </button>
          </div>
        </div>
      ) : (
        <span className="maps-link is-disabled">Sin coordenadas válidas</span>
      )}
    </>
  );
}
