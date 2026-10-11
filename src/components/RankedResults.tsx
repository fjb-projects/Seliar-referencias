import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { RankedItem } from '../lib/categorize';
import { CATEGORY_LABEL, categoryTrust, formatCoordinates, sourceLabel, streetSearchText } from '../lib/format';
import type { GeorefHit, GeorefStreet } from '../lib/georef';
import { buildDirectionsUrl, buildMapsTextUrl, buildMapsUrl, MAPS_LINK_PROPS } from '../lib/maps';
import type { Reference } from '../lib/types';
import { ReferenceRow } from './ReferenceRow';
import { optionId } from './ResultList';

interface Props {
  /** Rows already ranked, best first; rows of one category are next to each other. */
  items: RankedItem[];
  activeIndex: number;
  listId: string;
  /** House number the operator typed, or null. */
  queryNumber: number | null;
  onHover: (key: string) => void;
  onShare: (ref: Reference) => void;
}

type CatalogItem = Extract<RankedItem, { source: 'catalog' }>;

const BLOCK_SIZE = 100;

/** Why the row is where it is (its category) and who says so (its source). */
function RankBadges({ item }: { item: RankedItem }) {
  return (
    <>
      <span className={`badge category-badge is-${categoryTrust(item.category)}`}>{CATEGORY_LABEL[item.category]}</span>
      <span className="badge source-badge">{sourceLabel(item.source, item.category)}</span>
    </>
  );
}

/** What Georef and the typed house number say about a catalog row. */
function CatalogNotes({ item }: { item: CatalogItem }) {
  const blocksAway = item.blockDistance === null ? 0 : item.blockDistance / BLOCK_SIZE;
  return (
    <>
      {item.confirmedBy ? (
        <div className="result-detail muted">Georef coincide a {Math.round(item.confirmedBy.distanceM)} m</div>
      ) : null}
      {item.discrepancy ? (
        <div className="result-warning">
          Georef ubica esta dirección a {Math.round(item.discrepancy.distanceM)} m de este punto
        </div>
      ) : null}
      {blocksAway > 0 ? (
        <div className="result-detail muted">
          A {blocksAway} {blocksAway === 1 ? 'cuadra' : 'cuadras'} de la altura buscada
        </div>
      ) : null}
    </>
  );
}

/** An address Georef interpolated: a point on the map, but not a verified one. */
function AddressRow({ hit, badges }: { hit: GeorefHit; badges: ReactNode }) {
  const title = hit.calle !== '' && hit.altura !== null ? `${hit.calle} ${hit.altura}` : hit.label;
  const url = buildMapsUrl(hit.latitude, hit.longitude);
  const directionsUrl = buildDirectionsUrl(hit.latitude, hit.longitude);
  return (
    <>
      <div className="result-main">
        <div className="result-head">
          <span className="result-name">{title}</span>
          {badges}
        </div>
        {hit.localidad ? <div className="result-locality">{hit.localidad}</div> : null}
        <div className="result-coords muted">{formatCoordinates(hit.latitude, hit.longitude)}</div>
        <div className="result-detail muted">Punto interpolado: puede estar corrido una cuadra o dos.</div>
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
              aria-label={`Cómo llegar a ${title}`}
            >
              Cómo llegar
            </a>
          </div>
        </div>
      ) : (
        <span className="maps-link is-disabled">Sin coordenadas válidas</span>
      )}
    </>
  );
}

function heightRange({ alturaMin, alturaMax }: GeorefStreet): string | null {
  if (alturaMin !== null && alturaMax !== null) return `Alturas ${alturaMin} a ${alturaMax}`;
  if (alturaMin !== null) return `Alturas desde ${alturaMin}`;
  if (alturaMax !== null) return `Alturas hasta ${alturaMax}`;
  return null;
}

/** A street Georef knows in a locality, with no point on the map: all it offers is a search by name. */
function StreetRow({ street, queryNumber, badges }: { street: GeorefStreet; queryNumber: number | null; badges: ReactNode }) {
  const range = heightRange(street);
  const url = buildMapsTextUrl(streetSearchText(street.nombre, queryNumber), street.localidad);
  return (
    <>
      <div className="result-main">
        <div className="result-head">
          <span className="result-name">{street.nombre}</span>
          {badges}
        </div>
        {street.localidad ? <div className="result-locality">{street.localidad}</div> : null}
        {range ? <div className="result-detail">{range}</div> : null}
        {queryNumber !== null ? <div className="result-detail muted">No se pudo ubicar la altura {queryNumber}.</div> : null}
      </div>
      {url ? (
        <div className="result-actions">
          <a className="maps-link" href={url} {...MAPS_LINK_PROPS} tabIndex={-1}>
            Buscar en Google Maps
          </a>
        </div>
      ) : null}
    </>
  );
}

function RowBody({ item, queryNumber, onShare }: { item: RankedItem; queryNumber: number | null; onShare: Props['onShare'] }) {
  const badges = <RankBadges item={item} />;
  if (item.source === 'catalog') {
    return <ReferenceRow reference={item.ref} onShare={onShare} badges={badges} notes={<CatalogNotes item={item} />} />;
  }
  if (item.kind === 'address') return <AddressRow hit={item.hit} badges={badges} />;
  return <StreetRow street={item.street} queryNumber={queryNumber} badges={badges} />;
}

/**
 * The results of a street query in one list: catalog records and Georef answers together, best
 * first, each under the heading of its category and saying where it comes from.
 */
export function RankedResults({ items, activeIndex, listId, queryNumber, onHover, onShare }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <ul className="results" role="listbox" id={listId} aria-label="Resultados">
      {items.map((item, index) => {
        const active = index === activeIndex;
        const opensGroup = index === 0 || items[index - 1].category !== item.category;
        return (
          <Fragment key={item.key}>
            {opensGroup ? (
              <li role="presentation" className="result-group">
                {CATEGORY_LABEL[item.category]}
              </li>
            ) : null}
            <li
              id={optionId(listId, index)}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              className={active ? 'result is-active' : 'result'}
              onMouseMove={() => !active && onHover(item.key)}
            >
              <RowBody item={item} queryNumber={queryNumber} onShare={onShare} />
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
