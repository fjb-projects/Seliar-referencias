// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RankedResults } from '../src/components/RankedResults';
import { Category, type CategoryId, type RankedItem } from '../src/lib/categorize';
import { formatCoordinates } from '../src/lib/format';
import type { GeorefHit, GeorefStreet } from '../src/lib/georef';
import { buildDirectionsUrl, buildMapsTextUrl, buildMapsUrl } from '../src/lib/maps';
import type { Reference } from '../src/lib/types';

afterEach(cleanup);

function makeRef(nombre: string, overrides: Partial<Reference> = {}): Reference {
  return {
    id: nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    tipo: 'calle',
    barrio: 'BARRIO FAVALORO',
    nombre,
    aliases: [],
    latitude: -31.6,
    longitude: -60.7,
    coordRaw: '-31.6,-60.7',
    source: { file: 'test.xlsx', sheet: 'Test', cell: 'A1', row: 1 },
    ...overrides,
  };
}

type CatalogItem = Extract<RankedItem, { source: 'catalog' }>;

function catalogItem(category: CategoryId, ref: Reference, extra: Partial<CatalogItem> = {}): RankedItem {
  return { key: `c:${ref.id}`, category, source: 'catalog', ref, streetGrade: 'exact', blockDistance: null, ...extra };
}

const HIT: GeorefHit = {
  label: 'SAN MARTIN 2500, La Capital, Santa Fe',
  localidad: 'Santa Fe',
  latitude: -31.64,
  longitude: -60.71,
  calle: 'SAN MARTIN',
  altura: 2500,
};

function addressItem(hit: GeorefHit = HIT, category: CategoryId = Category.Interpolated): RankedItem {
  return { key: `g:${hit.localidad}|${hit.label}`, category, source: 'georef', kind: 'address', hit, streetGrade: 'exact' };
}

function streetItem(street: Partial<GeorefStreet> = {}, category: CategoryId = Category.StreetExists): RankedItem {
  const full: GeorefStreet = { nombre: 'RIVADAVIA', localidad: 'Recreo', alturaMin: 100, alturaMax: 1999, ...street };
  return { key: `s:${full.localidad}|${full.nombre}`, category, source: 'georef', kind: 'street', street: full, streetGrade: 'exact' };
}

interface Options {
  activeIndex?: number;
  queryNumber?: number | null;
}

function renderList(items: RankedItem[], { activeIndex = -1, queryNumber = null }: Options = {}) {
  const onHover = vi.fn();
  const onShare = vi.fn();
  render(
    <RankedResults
      items={items}
      activeIndex={activeIndex}
      listId="rk"
      queryNumber={queryNumber}
      onHover={onHover}
      onShare={onShare}
    />,
  );
  return { onHover, onShare };
}

const options = () => screen.getAllByRole('option');
const headings = () => screen.getAllByRole('presentation').map((heading) => heading.textContent);
const badge = (row: HTMLElement, text: string) => within(row).getByText(text, { selector: '.badge' });

describe('RankedResults', () => {
  it('renders one labelled listbox with an option per row', () => {
    renderList([catalogItem(Category.SameBlock, makeRef('Sobre San Martin 8500')), addressItem(), streetItem()]);
    const list = screen.getByRole('listbox', { name: 'Resultados' });
    expect(list).toHaveAttribute('id', 'rk');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(options().map((option) => option.id)).toEqual(['rk-opt-0', 'rk-opt-1', 'rk-opt-2']);
  });

  it('heads each category once, in the order of the rows', () => {
    renderList([
      catalogItem(Category.Reference, makeRef('Comisaria 25', { tipo: 'referencia' })),
      catalogItem(Category.ConfirmedBlock, makeRef('Sobre San Martin 8500')),
      catalogItem(Category.SameBlock, makeRef('Sobre San Martin 8500', { id: 'twin' })),
      addressItem(),
      addressItem({ ...HIT, localidad: 'Recreo' }),
      catalogItem(Category.NeighbourBlock, makeRef('Sobre San Martin 8600'), { blockDistance: 100 }),
      catalogItem(Category.SameStreet, makeRef('Sobre San Martin 9900')),
      catalogItem(Category.SameStreet, makeRef('Sobre San Martin 9800')),
      streetItem(),
      catalogItem(Category.Similar, makeRef('Sobre San Martin Norte 100'), { streetGrade: 'weak' }),
    ]);
    expect(headings()).toEqual([
      'Referencia',
      'Cuadra confirmada',
      'Misma cuadra',
      'Dirección interpolada',
      'Cuadra vecina',
      'Misma calle',
      'La calle existe',
      'Parecido',
    ]);
    expect(options()).toHaveLength(10);
    // A heading is not a row: it takes no option id and cannot be selected.
    for (const heading of screen.getAllByRole('presentation')) {
      expect(heading).not.toHaveAttribute('id');
      expect(heading).not.toHaveAttribute('aria-selected');
    }
  });

  it.each<[CategoryId, string, string, string]>([
    [Category.Reference, 'Referencia', 'Catálogo', 'is-verified'],
    [Category.ConfirmedBlock, 'Cuadra confirmada', 'Catálogo + Georef', 'is-verified'],
    [Category.SameBlock, 'Misma cuadra', 'Catálogo', 'is-verified'],
    [Category.NeighbourBlock, 'Cuadra vecina', 'Catálogo', 'is-verified'],
    [Category.SameStreet, 'Misma calle', 'Catálogo', 'is-verified'],
    [Category.Similar, 'Parecido', 'Catálogo', 'is-similar'],
  ])('badges a catalog row of category %d as "%s" from "%s"', (category, label, source, trust) => {
    renderList([catalogItem(category, makeRef('Sobre San Martin 8500'))]);
    const [row] = options();
    expect(badge(row, label)).toHaveClass('category-badge', trust);
    expect(badge(row, source)).toHaveClass('source-badge');
    expect(headings()).toEqual([label]);
  });

  it.each<[CategoryId, string, string]>([
    [Category.Interpolated, 'Dirección interpolada', 'is-georef'],
    [Category.Similar, 'Parecido', 'is-similar'],
  ])('badges a Georef address row of category %d as "%s" from Georef', (category, label, trust) => {
    renderList([addressItem(HIT, category)]);
    const [row] = options();
    expect(badge(row, label)).toHaveClass('category-badge', trust);
    expect(badge(row, 'Georef')).toHaveClass('source-badge');
  });

  it.each<[CategoryId, string, string]>([
    [Category.StreetExists, 'La calle existe', 'is-georef'],
    [Category.Similar, 'Parecido', 'is-similar'],
  ])('badges a Georef street row of category %d as "%s" from Georef', (category, label, trust) => {
    renderList([streetItem({}, category)]);
    const [row] = options();
    expect(badge(row, label)).toHaveClass('category-badge', trust);
    expect(badge(row, 'Georef')).toHaveClass('source-badge');
  });

  describe('catalog rows', () => {
    const ref = makeRef('Pje Segundo 4800', {
      aliases: ['F Aguayo'],
      zona: 'Norte',
      descripcion: 'Entre Azcuenaga y French',
      latitude: -31.566827,
      longitude: -60.70427,
    });

    it('shows the record like the plain list does: both street names, barrio, detail and coordinates', () => {
      renderList([catalogItem(Category.SameBlock, ref)]);
      const [row] = options();
      expect(within(row).getByText('Pje Segundo 4800')).toHaveClass('result-name');
      expect(badge(row, 'Calle')).toBeInTheDocument();
      expect(row).toHaveTextContent('Barrio Favaloro · zona Norte');
      expect(row).toHaveTextContent('Entre Azcuenaga y French');
      expect(row).toHaveTextContent('Figura en Google Maps como «F Aguayo»');
      expect(row).toHaveTextContent(formatCoordinates(-31.566827, -60.70427));
    });

    it('links to Maps and directions and shares the record', async () => {
      const { onShare } = renderList([catalogItem(Category.SameBlock, ref)]);
      const [row] = options();
      const maps = within(row).getByRole('link', { name: 'Abrir en Google Maps' });
      const directions = within(row).getByRole('link', { name: 'Cómo llegar a Pje Segundo 4800' });
      expect(maps).toHaveAttribute('href', buildMapsUrl(-31.566827, -60.70427));
      expect(directions).toHaveAttribute('href', buildDirectionsUrl(-31.566827, -60.70427));
      for (const link of [maps, directions]) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveAttribute('tabindex', '-1');
      }
      await userEvent.click(within(row).getByRole('button', { name: 'Compartir Pje Segundo 4800' }));
      expect(onShare).toHaveBeenCalledWith(ref);
    });

    it('shows the disabled text instead of actions when the coordinates are unusable', () => {
      renderList([catalogItem(Category.SameStreet, makeRef('Sobre Rota 100', { latitude: 999 }))]);
      expect(screen.getByText('Sin coordenadas válidas')).toHaveClass('maps-link', 'is-disabled');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('says how close the agreeing Georef address is on a confirmed block', () => {
      renderList([catalogItem(Category.ConfirmedBlock, ref, { blockDistance: 0, confirmedBy: { hit: HIT, distanceM: 12.4 } })]);
      const [row] = options();
      expect(within(row).getByText('Georef coincide a 12 m')).toBeInTheDocument();
      expect(row).not.toHaveTextContent(/cuadra[s]? de la altura/);
      expect(row.querySelector('.result-warning')).toBeNull();
    });

    it('warns when Georef places the address somewhere else', () => {
      renderList([catalogItem(Category.SameBlock, ref, { blockDistance: 0, discrepancy: { hit: HIT, distanceM: 1234.6 } })]);
      const [row] = options();
      const warning = within(row).getByText('Georef ubica esta dirección a 1235 m de este punto');
      expect(warning).toHaveClass('result-warning');
      expect(row).not.toHaveTextContent('Georef coincide');
    });

    it('adds no Georef note to a row Georef said nothing about', () => {
      renderList([catalogItem(Category.SameBlock, ref, { blockDistance: 0 })]);
      const [row] = options();
      expect(row).not.toHaveTextContent('Georef coincide');
      expect(row).not.toHaveTextContent('Georef ubica');
      expect(row).not.toHaveTextContent('de la altura buscada');
    });

    it.each([
      [100, 'A 1 cuadra de la altura buscada'],
      [200, 'A 2 cuadras de la altura buscada'],
      [6000, 'A 60 cuadras de la altura buscada'],
    ])('tells a block distance of %d as "%s"', (blockDistance, text) => {
      renderList([catalogItem(Category.NeighbourBlock, ref, { blockDistance })]);
      expect(within(options()[0]).getByText(text)).toBeInTheDocument();
    });

    it.each([[0], [null]])('tells no block distance for %s', (blockDistance) => {
      renderList([catalogItem(Category.SameStreet, ref, { blockDistance })]);
      expect(options()[0]).not.toHaveTextContent('de la altura buscada');
    });
  });

  describe('Georef address rows', () => {
    it('shows the official street and height, the locality, the coordinates and the interpolation note', () => {
      renderList([addressItem()]);
      const [row] = options();
      expect(within(row).getByText('SAN MARTIN 2500')).toHaveClass('result-name');
      expect(within(row).getByText('Santa Fe')).toHaveClass('result-locality');
      expect(row).toHaveTextContent(formatCoordinates(-31.64, -60.71));
      expect(row).toHaveTextContent('Punto interpolado: puede estar corrido una cuadra o dos.');
    });

    it.each<[string, Partial<GeorefHit>]>([
      ['no street', { calle: '' }],
      ['no height', { altura: null }],
    ])('falls back to the Georef label when the hit has %s', (_label, missing) => {
      renderList([addressItem({ ...HIT, ...missing })]);
      expect(within(options()[0]).getByText('SAN MARTIN 2500, La Capital, Santa Fe')).toHaveClass('result-name');
    });

    it('omits the locality line when Georef sent none', () => {
      renderList([addressItem({ ...HIT, localidad: '' })]);
      expect(options()[0].querySelector('.result-locality')).toBeNull();
    });

    it('links to Maps and directions with the safe builders, and offers no sharing', () => {
      renderList([addressItem()]);
      const [row] = options();
      const maps = within(row).getByRole('link', { name: 'Abrir en Google Maps' });
      const directions = within(row).getByRole('link', { name: 'Cómo llegar a SAN MARTIN 2500' });
      expect(maps).toHaveAttribute('href', buildMapsUrl(-31.64, -60.71));
      expect(maps).toHaveClass('maps-link');
      expect(directions).toHaveAttribute('href', buildDirectionsUrl(-31.64, -60.71));
      expect(directions).toHaveClass('maps-link', 'is-secondary');
      for (const link of [maps, directions]) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveAttribute('tabindex', '-1');
      }
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows the disabled text instead of links when the coordinates are unusable', () => {
      renderList([addressItem({ ...HIT, latitude: 999 })]);
      expect(screen.getByText('Sin coordenadas válidas')).toHaveClass('maps-link', 'is-disabled');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('Georef street rows', () => {
    it('shows the street, its locality and one text-search action', () => {
      renderList([streetItem()], { queryNumber: 1500 });
      const [row] = options();
      expect(within(row).getByText('RIVADAVIA')).toHaveClass('result-name');
      expect(within(row).getByText('Recreo')).toHaveClass('result-locality');
      expect(row).toHaveTextContent('No se pudo ubicar la altura');
      const links = within(row).getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName('Buscar en Google Maps');
      expect(links[0]).toHaveAttribute('href', buildMapsTextUrl('RIVADAVIA 1500', 'Recreo'));
      expect(links[0]).toHaveAttribute('target', '_blank');
      expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
      expect(links[0]).toHaveAttribute('tabindex', '-1');
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
      expect(row).not.toHaveTextContent(/interpolad/i);
    });

    it('searches the street alone, and blames no height, when the query had no number', () => {
      renderList([streetItem()]);
      const [row] = options();
      expect(within(row).getByRole('link')).toHaveAttribute('href', buildMapsTextUrl('RIVADAVIA', 'Recreo'));
      expect(row).not.toHaveTextContent('No se pudo ubicar la altura');
    });

    it.each<[number | null, number | null, string | null]>([
      [100, 1999, 'Alturas 100 a 1999'],
      [0, 9699, 'Alturas 0 a 9699'],
      [null, null, null],
      // Georef never sends half a range; if one arrived, it would say nothing rather than guess.
      [100, null, null],
      [null, 1999, null],
    ])('tells the height range %s-%s as %j', (alturaMin, alturaMax, text) => {
      renderList([streetItem({ alturaMin, alturaMax })]);
      const [row] = options();
      if (text === null) expect(row).not.toHaveTextContent(/alturas/i);
      else expect(within(row).getByText(text)).toBeInTheDocument();
    });

    it('renders no link when the text URL cannot be built', () => {
      renderList([streetItem({ nombre: 'X'.repeat(250) })]);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('active row', () => {
    const items = [catalogItem(Category.SameBlock, makeRef('Sobre San Martin 8500')), addressItem(), streetItem()];

    it.each([0, 1, 2])('marks only row %d as selected', (activeIndex) => {
      renderList(items, { activeIndex });
      options().forEach((option, index) => {
        expect(option).toHaveAttribute('aria-selected', String(index === activeIndex));
        if (index === activeIndex) expect(option).toHaveClass('result', 'is-active');
        else expect(option).not.toHaveClass('is-active');
      });
    });

    it('selects nothing without an active row', () => {
      renderList(items);
      expect(options().every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
    });

    it('reports the key of the row the mouse moves over, unless it is already active', () => {
      const { onHover } = renderList(items, { activeIndex: 0 });
      const move = (index: number) => options()[index].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      move(0);
      expect(onHover).not.toHaveBeenCalled();
      move(1);
      expect(onHover).toHaveBeenLastCalledWith('g:Santa Fe|SAN MARTIN 2500, La Capital, Santa Fe');
      move(2);
      expect(onHover).toHaveBeenLastCalledWith('s:Recreo|RIVADAVIA');
      expect(onHover).toHaveBeenCalledTimes(2);
    });
  });

  it('renders an empty listbox for no rows', () => {
    renderList([]);
    expect(screen.getByRole('listbox', { name: 'Resultados' })).toBeEmptyDOMElement();
  });
});
