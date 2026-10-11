// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeorefResults } from '../src/components/GeorefResults';
import { formatCoordinates } from '../src/lib/format';
import type { GeorefHit } from '../src/lib/georef';
import { buildDirectionsUrl, buildMapsTextUrl, buildMapsUrl } from '../src/lib/maps';

afterEach(cleanup);

const HITS: GeorefHit[] = [
  { label: 'SAN MARTIN 1234, SANTA FE', localidad: 'Santa Fe', latitude: -31.6, longitude: -60.7, calle: 'SAN MARTIN', altura: 1234 },
  { label: 'SAN MARTIN 1234, RECREO', localidad: 'Recreo', latitude: -31.5, longitude: -60.75, calle: 'SAN MARTIN', altura: 1234 },
];

function renderResults(hits: GeorefHit[], query = 'san martin 1234', activeIndex = -1, onHover = vi.fn()) {
  render(<GeorefResults hits={hits} query={query} activeIndex={activeIndex} listId="geo" onHover={onHover} />);
  return onHover;
}

describe('GeorefResults', () => {
  it('renders a labelled listbox with one option per hit', () => {
    renderResults(HITS);
    const list = screen.getByRole('listbox', { name: 'Direcciones aproximadas' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
  });

  it('shows label, locality, exact badge, coordinates and the interpolation note', () => {
    renderResults(HITS);
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('SAN MARTIN 1234, SANTA FE');
    expect(within(first).getByText('Santa Fe', { selector: '.georef-localidad' })).toBeInTheDocument();
    expect(within(first).getByText('Dirección aproximada · Georef')).toBeInTheDocument();
    expect(first).toHaveTextContent(formatCoordinates(-31.6, -60.7));
    expect(first).toHaveTextContent(/interpolad/i);
    expect(first).toHaveTextContent(/cuadra/i);
  });

  it('links to Maps and directions using the safe URL builders', () => {
    renderResults(HITS);
    const first = screen.getAllByRole('option')[0];
    const maps = within(first).getByRole('link', { name: 'Abrir en Google Maps' });
    const dirs = within(first).getByRole('link', { name: /cómo llegar/i });
    expect(maps).toHaveAttribute('href', buildMapsUrl(-31.6, -60.7));
    expect(dirs).toHaveAttribute('href', buildDirectionsUrl(-31.6, -60.7));
    for (const link of [maps, dirs]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(maps).toHaveClass('maps-link');
    expect(dirs).toHaveClass('maps-link', 'is-secondary');
  });

  it('marks only the active option as selected and ids them from listId', () => {
    renderResults(HITS, 'q 1', 1);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('id', 'geo-opt-1');
  });

  it('reports hover on a non-active option', () => {
    const onHover = renderResults(HITS);
    screen.getAllByRole('option')[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it('shows the disabled text instead of links when coordinates are unusable', () => {
    renderResults([{ label: 'X 1', localidad: 'Santa Fe', latitude: 999, longitude: 0, calle: 'X', altura: 1 }]);
    expect(screen.getByText('Sin coordenadas válidas')).toHaveClass('maps-link', 'is-disabled');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the empty fallback with a text-search link', () => {
    renderResults([], 'calle falsa 123');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('No encontramos esa dirección en Georef.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Buscar «calle falsa 123» en Google Maps' });
    expect(link).toHaveAttribute('href', buildMapsTextUrl('calle falsa 123'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the fallback link when the text URL cannot be built', () => {
    renderResults([], 'x'.repeat(250));
    expect(screen.getByText('No encontramos esa dirección en Georef.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
