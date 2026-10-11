// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { buildMapsTextUrl, buildMapsUrl } from '../src/lib/maps';
import { rankResults } from '../src/lib/categorize';
import { searchGeoref, searchGeorefStreets, type GeorefHit, type GeorefStreet } from '../src/lib/georef';
import { SearchEngine } from '../src/lib/search';
import { readCatalog } from './helpers';

vi.mock('../src/lib/georef', async () => ({
  ...(await vi.importActual<typeof import('../src/lib/georef')>('../src/lib/georef')),
  searchGeoref: vi.fn(async () => []),
  searchGeorefStreets: vi.fn(async () => []),
}));

// The real ranking, wrapped only so that one test can take a row out of its answer.
vi.mock('../src/lib/categorize', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/categorize')>('../src/lib/categorize');
  return { ...actual, rankResults: vi.fn(actual.rankResults) };
});

const geoMock = vi.mocked(searchGeoref);
const streetsMock = vi.mocked(searchGeorefStreets);
const rankMock = vi.mocked(rankResults);
const catalog = readCatalog();
const MALVINA_URL = 'https://www.google.com/maps/search/?api=1&query=-31.566827%2C-60.70427';

let openSpy: ReturnType<typeof vi.fn>;
let realRankResults: typeof rankResults;

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('../src/lib/categorize')>('../src/lib/categorize');
  realRankResults = actual.rankResults;
  rankMock.mockReset();
  rankMock.mockImplementation(realRankResults);
  geoMock.mockReset();
  geoMock.mockImplementation(async () => []);
  streetsMock.mockReset();
  streetsMock.mockImplementation(async () => []);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
  );
  openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);
  window.open = openSpy as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  const user = userEvent.setup();
  render(<App />);
  const input = await screen.findByRole('combobox', { name: /buscar referencia/i });
  await waitFor(() => expect(screen.queryByText(/cargando referencias/i)).not.toBeInTheDocument());
  return { user, input };
}

describe('App', () => {
  it('shows a loading state and then focuses the search box', async () => {
    render(<App />);
    expect(screen.getByText(/cargando referencias/i)).toBeInTheDocument();
    const input = await screen.findByRole('combobox');
    // Focus is there from the first paint: the operator can type while the catalogue loads.
    expect(input).toHaveFocus();
    await waitFor(() => expect(screen.queryByText(/cargando referencias/i)).not.toBeInTheDocument());
  });

  it('searches while typing, without pressing Enter', async () => {
    const { user, input } = await setup();
    await user.type(input, 'gran malv');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Plaza Gran Malvina');
    expect(options[0]).toHaveTextContent('Barrio Favaloro');
  });

  it('opens Google Maps for the single strong match with Enter', async () => {
    const { user, input } = await setup();
    await user.type(input, 'plaza gran malvina{Enter}');
    expect(openSpy).toHaveBeenCalledWith(MALVINA_URL, '_blank', 'noopener,noreferrer');
  });

  it('does not open anything for an ambiguous query until the operator picks one', async () => {
    const { user, input } = await setup();
    await user.type(input, 'utn{Enter}');
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/varias coincidencias/i);

    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-31\.\d+%2C-60\.\d+$/);
  });

  it('moves with the arrow keys, wrapping around', async () => {
    const { user, input } = await setup();
    await user.type(input, 'comisaria');
    const selected = () => screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(-1);
    await user.keyboard('{ArrowDown}');
    expect(selected()).toBe(0);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe(2);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(1);
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
  });

  it('Escape clears the selection first, then the query', async () => {
    const { user, input } = await setup();
    await user.type(input, 'comisaria{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(input).toHaveValue('comisaria');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('Ctrl+K focuses the search box from anywhere', async () => {
    const { user, input } = await setup();
    (document.activeElement as HTMLElement).blur();
    expect(input).not.toHaveFocus();
    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
  });

  it('shows the no-match state', async () => {
    const { user, input } = await setup();
    await user.type(input, 'zzzzqx');
    expect(screen.getByRole('status')).toHaveTextContent(/sin coincidencias/i);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('renders safe Google Maps links for mouse users', async () => {
    const { user, input } = await setup();
    await user.type(input, 'gran malvina');
    const link = await screen.findByRole('link', { name: /abrir en google maps/i });
    expect(link).toHaveAttribute('href', MALVINA_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers "Cómo llegar" with a destination-only directions link', async () => {
    const { user, input } = await setup();
    await user.type(input, 'gran malvina');
    const link = await screen.findByRole('link', { name: /cómo llegar a plaza gran malvina/i });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=-31.566827%2C-60.70427',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shares through the native share sheet with the pin link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      const { user, input } = await setup();
      await user.type(input, 'gran malvina');
      await user.click(await screen.findByRole('button', { name: /compartir plaza gran malvina/i }));
      expect(share).toHaveBeenCalledWith({
        title: 'Plaza Gran Malvina',
        text: 'Plaza Gran Malvina · Barrio Favaloro',
        url: MALVINA_URL,
      });
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
  });

  it('copies the link and says so when the browser has no share sheet', async () => {
    const { user, input } = await setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.type(input, 'gran malvina');
    await user.click(await screen.findByRole('button', { name: /compartir plaza gran malvina/i }));
    expect(writeText).toHaveBeenCalledWith(`Plaza Gran Malvina · Barrio Favaloro
${MALVINA_URL}`);
    expect(screen.getByRole('status')).toHaveTextContent(/enlace copiado/i);
  });

  it('clears the "copied" notice as soon as the query changes', async () => {
    const { user, input } = await setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.type(input, 'gran malvina');
    await user.click(await screen.findByRole('button', { name: /compartir plaza gran malvina/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/enlace copiado/i);
    await user.type(input, 'x');
    expect(screen.getByRole('status')).not.toHaveTextContent(/enlace copiado/i);
  });

  it('limits the visible results to 10', async () => {
    const { user, input } = await setup();
    await user.type(input, 'ca');
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(10);
  });

  it('reports a load failure with a retry button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    render(<App />);
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});

describe('App with Georef and the ranked list', () => {
  const SAN_MARTIN_8500 = catalog.references.find((ref) => ref.nombre === 'Sobre San Martin 8500')!;
  const NOWHERE = 'xqzv 98765';

  function address(calle: string, altura: number, overrides: Partial<GeorefHit> = {}): GeorefHit {
    return {
      label: `${calle} ${altura}, La Capital, Santa Fe`,
      localidad: 'Santa Fe',
      latitude: -31.6,
      longitude: -60.7,
      calle,
      altura,
      ...overrides,
    };
  }
  const NOWHERE_HITS = [
    address('XQZV', 98765),
    address('XQZV', 98765, { localidad: 'Recreo', latitude: -31.5, longitude: -60.75 }),
  ];
  const SAN_MARTIN_2500 = [
    address('SAN MARTIN', 2500, { latitude: -31.6486, longitude: -60.7087 }),
    address('SAN MARTIN', 2500, { localidad: 'Santo Tomé', latitude: -31.66, longitude: -60.76 }),
  ];

  /** Georef lookups that stay pending until the test answers them, one entry per call. */
  function deferred<T>(mock: { mockImplementation: (impl: (text: string, signal?: AbortSignal) => Promise<T[]>) => unknown }) {
    const calls: { text: string; signal?: AbortSignal; resolve: (value: T[]) => void }[] = [];
    mock.mockImplementation(
      (text, signal) =>
        new Promise<T[]>((resolve) => {
          calls.push({ text, signal, resolve });
        }),
    );
    return calls;
  }

  const options = () => screen.queryAllByRole('option');
  const headings = () => screen.queryAllByRole('presentation').map((heading) => heading.textContent);
  const names = () => options().map((option) => option.querySelector('.result-name')?.textContent);
  const rowNamed = (name: string) => {
    const row = options().find((option) => option.querySelector('.result-name')?.textContent === name);
    if (!row) throw new Error(`no row named "${name}"`);
    return row;
  };
  const badgesOf = (row: HTMLElement) => [...row.querySelectorAll('.badge')].map((badge) => badge.textContent);
  const selectedName = () =>
    options()
      .find((option) => option.getAttribute('aria-selected') === 'true')
      ?.querySelector('.result-name')?.textContent;
  const status = () => screen.getByRole('status');
  const georefAnswered = () => waitFor(() => expect(status()).not.toHaveTextContent('Buscando en Georef…'));

  describe('a street address', () => {
    it('ranks the catalog block at once, while Georef is still being asked', async () => {
      deferred(geoMock);
      const { user, input } = await setup();
      await user.type(input, 'san martin 8540');
      const row = rowNamed('Sobre San Martin 8500');
      expect(badgesOf(row)).toEqual(['Calle', 'Misma cuadra', 'Catálogo']);
      expect(headings()[0]).toBe('Misma cuadra');
      expect(headings()).toEqual(['Misma cuadra', 'Cuadra vecina', 'Misma calle']);
      expect(status()).toHaveTextContent('Buscando en Georef…');
      expect(status()).not.toHaveTextContent(/sin coincidencias/i);
      expect(screen.getByRole('listbox', { name: 'Resultados' })).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-expanded', 'true');
      // The only block row is the suggestion, as a single strong match is in the plain list.
      expect(row).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', row.id);
    });

    it('confirms the block when Georef places the address on it', async () => {
      const { latitude, longitude } = SAN_MARTIN_8500;
      geoMock.mockResolvedValue([address('SAN MARTIN', 8540, { latitude, longitude })]);
      const { user, input } = await setup();
      await user.type(input, 'san martin 8540');
      await waitFor(() => expect(headings()[0]).toBe('Cuadra confirmada'));
      const row = rowNamed('Sobre San Martin 8500');
      expect(badgesOf(row)).toEqual(['Calle', 'Cuadra confirmada', 'Catálogo + Georef']);
      expect(row).toHaveTextContent('Georef coincide a 0 m');
      // The agreeing Georef address is folded into the row: it gets none of its own.
      expect(headings()).not.toContain('Dirección interpolada');
      expect(status()).not.toHaveTextContent('Buscando en Georef…');

      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(buildMapsUrl(latitude, longitude), '_blank', 'noopener,noreferrer');
    });

    it('asks Georef even when the catalog has rows, once, with the final text', async () => {
      const { user, input } = await setup();
      await user.type(input, 'san martin 8540');
      expect(options().length).toBeGreaterThan(0);
      await waitFor(() => expect(streetsMock).toHaveBeenCalled());
      await georefAnswered();
      expect(geoMock).toHaveBeenCalledTimes(1);
      expect(geoMock.mock.calls[0][0]).toBe('san martin 8540');
      expect(streetsMock).toHaveBeenCalledTimes(1);
      expect(streetsMock.mock.calls[0][0]).toBe('san martin');
      // Both lookups share the signal that a new query aborts.
      expect(geoMock.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
      expect(streetsMock.mock.calls[0][1]).toBe(geoMock.mock.calls[0][1]);
    });

    it('lists interpolated addresses above the far blocks of the street, and picks none of them', async () => {
      geoMock.mockResolvedValue(SAN_MARTIN_2500);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      await waitFor(() => expect(headings()).toEqual(['Dirección interpolada', 'Misma calle']));
      const rows = options();
      expect(names().slice(0, 3)).toEqual(['SAN MARTIN 2500', 'SAN MARTIN 2500', 'Sobre San Martin 8500']);
      expect(badgesOf(rows[0])).toEqual(['Dirección interpolada', 'Georef']);
      expect(rows[0]).toHaveTextContent('Santa Fe');
      expect(rows[1]).toHaveTextContent('Santo Tomé');
      expect(badgesOf(rows[2])).toEqual(['Calle', 'Misma calle', 'Catálogo']);
      expect(rows[2]).toHaveTextContent('A 60 cuadras de la altura buscada');
      expect(rows.every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
      expect(input).not.toHaveAttribute('aria-activedescendant');

      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
      expect(status()).toHaveTextContent('Hay varias coincidencias posibles: elegí una con ↑ ↓ y Enter.');
      expect(options().every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
    });

    it('opens the Georef address picked with ArrowDown and Enter', async () => {
      geoMock.mockResolvedValue(SAN_MARTIN_2500);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      await waitFor(() => expect(headings()[0]).toBe('Dirección interpolada'));
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(options()[1]).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', options()[1].id);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(buildMapsUrl(-31.66, -60.76), '_blank', 'noopener,noreferrer');
    });

    it('opens the catalog record picked among the ranked rows', async () => {
      geoMock.mockResolvedValue(SAN_MARTIN_2500);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      await waitFor(() => expect(headings()[0]).toBe('Dirección interpolada'));
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
      expect(selectedName()).toBe('Sobre San Martin 8500');
      expect(openSpy).toHaveBeenCalledWith(
        buildMapsUrl(SAN_MARTIN_8500.latitude, SAN_MARTIN_8500.longitude),
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('searches Maps by name for a street Georef knows but could not place', async () => {
      const street: GeorefStreet = { nombre: 'RIVADAVIA', localidad: 'Santa Fe', alturaMin: 0, alturaMax: 9699 };
      streetsMock.mockResolvedValue([street]);
      const { user, input } = await setup();
      await user.type(input, 'rivadavia 1500');
      await waitFor(() => expect(headings()).toContain('La calle existe'));
      const row = rowNamed('RIVADAVIA');
      expect(badgesOf(row)).toEqual(['La calle existe', 'Georef']);
      expect(row).toHaveTextContent('Alturas 0 a 9699');
      expect(row).toHaveTextContent('No se pudo ubicar la altura');
      const url = buildMapsTextUrl('RIVADAVIA 1500', 'Santa Fe');
      expect(within(row).getByRole('link', { name: 'Buscar en Google Maps' })).toHaveAttribute('href', url);

      // It is the last row: ArrowUp without a pick wraps to it.
      await user.keyboard('{ArrowUp}');
      expect(row).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(url).not.toBeNull();
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    });

    it('keeps the pick on its row when a late Georef answer inserts rows above it', async () => {
      const pending = deferred(geoMock);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      const before = names();
      expect(before.length).toBeGreaterThan(1);
      await user.keyboard('{ArrowUp}');
      const pickedName = before[before.length - 1];
      expect(selectedName()).toBe(pickedName);
      expect(options()[before.length - 1]).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve(SAN_MARTIN_2500);
      await waitFor(() => expect(options()).toHaveLength(before.length + 2));
      expect(names()).toEqual(['SAN MARTIN 2500', 'SAN MARTIN 2500', ...before]);
      // Same record, two places further down: the pick followed the row, not the position.
      expect(selectedName()).toBe(pickedName);
      const row = options()[before.length + 1];
      expect(row).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', row.id);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      const picked = catalog.references.filter((ref) => ref.nombre === pickedName);
      expect(picked.map((ref) => buildMapsUrl(ref.latitude, ref.longitude))).toContain(openSpy.mock.calls[0][0]);
    });

    it('selects the row under the mouse', async () => {
      geoMock.mockResolvedValue(SAN_MARTIN_2500);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      await waitFor(() => expect(headings()[0]).toBe('Dirección interpolada'));
      fireEvent.mouseMove(options()[1]);
      expect(options()[1]).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledWith(buildMapsUrl(-31.66, -60.76), '_blank', 'noopener,noreferrer');
    });

    it('moves over the ranked rows with the arrow keys, wrapping around', async () => {
      geoMock.mockResolvedValue(NOWHERE_HITS);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(options()).toHaveLength(2));
      const selected = () => options().findIndex((option) => option.getAttribute('aria-selected') === 'true');
      expect(selected()).toBe(-1);
      await user.keyboard('{ArrowUp}');
      expect(selected()).toBe(1);
      await user.keyboard('{ArrowDown}');
      expect(selected()).toBe(0);
      await user.keyboard('{ArrowUp}');
      expect(selected()).toBe(1);
      expect(input).toHaveAttribute('aria-activedescendant', options()[1].id);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledWith(buildMapsUrl(-31.5, -60.75), '_blank', 'noopener,noreferrer');
    });

    it('Escape clears the pick first, then the query', async () => {
      geoMock.mockResolvedValue(NOWHERE_HITS);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(options()).toHaveLength(2));
      await user.keyboard('{ArrowDown}{Escape}');
      expect(input).toHaveValue(NOWHERE);
      expect(input).not.toHaveAttribute('aria-activedescendant');
      expect(options()).toHaveLength(2);
      await user.keyboard('{Escape}');
      expect(input).toHaveValue('');
      expect(options()).toHaveLength(0);
    });

    it('drops the pick and the notice when the query changes', async () => {
      geoMock.mockResolvedValue(SAN_MARTIN_2500);
      const { user, input } = await setup();
      await user.type(input, 'san martin 2500');
      await waitFor(() => expect(headings()[0]).toBe('Dirección interpolada'));
      await user.keyboard('{Enter}');
      expect(status()).toHaveTextContent('Hay varias coincidencias posibles');
      await user.keyboard('{ArrowDown}');
      expect(status()).not.toHaveTextContent('Hay varias coincidencias posibles');
      expect(selectedName()).toBe('SAN MARTIN 2500');
      await user.type(input, '1');
      expect(selectedName()).toBeUndefined();
      await user.keyboard('{Backspace}{Enter}');
      expect(status()).toHaveTextContent('Hay varias coincidencias posibles');
      await user.type(input, '1');
      expect(status()).not.toHaveTextContent('Hay varias coincidencias posibles');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('a street name without a number', () => {
    it('asks Georef for the street only', async () => {
      const { user, input } = await setup();
      await user.type(input, 'san martin');
      expect(headings()).toContain('Misma calle');
      await waitFor(() => expect(streetsMock).toHaveBeenCalledTimes(1));
      await georefAnswered();
      expect(streetsMock.mock.calls[0][0]).toBe('san martin');
      expect(geoMock).not.toHaveBeenCalled();
    });

    it('sends the street as typed, small words included, and the whole text as the address', async () => {
      const { user, input } = await setup();
      await user.type(input, '  Av. 9 de Julio 2500 y Salta ');
      await waitFor(() => expect(streetsMock).toHaveBeenCalledTimes(1));
      expect(streetsMock.mock.calls[0][0]).toBe('av 9 de julio');
      expect(geoMock).toHaveBeenCalledTimes(1);
      expect(geoMock.mock.calls[0][0]).toBe('Av. 9 de Julio 2500 y Salta');
    });

    it('asks nothing for a text too short to name a street', async () => {
      const { user, input } = await setup();
      await user.type(input, 'ab 12');
      await new Promise((r) => setTimeout(r, 600));
      expect(streetsMock).not.toHaveBeenCalled();
      expect(geoMock).not.toHaveBeenCalled();
      expect(status()).not.toHaveTextContent('Buscando en Georef…');
    });

    it('shows a street only Georef knows once it answers', async () => {
      streetsMock.mockResolvedValue([{ nombre: 'XQZVW', localidad: 'Recreo', alturaMin: null, alturaMax: null }]);
      const { user, input } = await setup();
      await user.type(input, 'xqzvw');
      // Until then it is a plain query that matched nothing.
      expect(status()).toHaveTextContent('Sin coincidencias para «xqzvw».');
      const row = await screen.findByRole('option');
      expect(badgesOf(row)).toEqual(['La calle existe', 'Georef']);
      expect(row).not.toHaveTextContent('No se pudo ubicar la altura');
      expect(row).not.toHaveTextContent(/alturas/i);
      expect(status()).not.toHaveTextContent(/sin coincidencias/i);
      expect(screen.queryByRole('link', { name: /buscar «xqzvw» en google maps/i })).not.toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
      await user.keyboard('{ArrowDown}{Enter}');
      expect(openSpy).toHaveBeenCalledWith(buildMapsTextUrl('XQZVW', 'Recreo'), '_blank', 'noopener,noreferrer');
    });
  });

  describe('a place name', () => {
    it('keeps the plain list and its rules', async () => {
      const { user, input } = await setup();
      await user.type(input, 'utn');
      await waitFor(() => expect(streetsMock).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 50));
      expect(streetsMock.mock.calls[0][0]).toBe('utn');
      expect(geoMock).not.toHaveBeenCalled();
      expect(headings()).toEqual([]);
      expect(document.querySelector('.category-badge, .source-badge')).toBeNull();
      expect(names()).toContain('UTN');
      expect(status()).not.toHaveTextContent('Buscando en Georef…');

      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
      expect(status()).toHaveTextContent(/varias coincidencias/i);
      await user.keyboard('{ArrowDown}{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('still opens the single strong match with Enter after Georef answered', async () => {
      const { user, input } = await setup();
      await user.type(input, 'plaza gran malvina');
      await waitFor(() => expect(streetsMock).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 50));
      expect(headings()).toEqual([]);
      expect(options()[0]).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledWith(MALVINA_URL, '_blank', 'noopener,noreferrer');
    });

    it('keeps a numbered reference on top and opens it with Enter', async () => {
      const { user, input } = await setup();
      await user.type(input, 'comisaria 25');
      expect(headings()).toEqual(['Referencia']);
      expect(badgesOf(rowNamed('Comisaria 25'))).toEqual(['Referencia', 'Referencia', 'Catálogo']);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('a plain list that becomes ranked when Georef answers late', () => {
    const unknownRange = (nombre: string): GeorefStreet => ({ nombre, localidad: 'Recreo', alturaMin: null, alturaMax: null });
    const engineHits = (text: string) => new SearchEngine(catalog.references).search(text, 10).hits.map((hit) => hit.ref);
    const urlOf = (ref: { latitude: number; longitude: number }) => buildMapsUrl(ref.latitude, ref.longitude);

    it('keeps the pick on the same reference, and Enter opens it', async () => {
      const pending = deferred(streetsMock);
      const picked = engineHits('utn')[1];
      const { user, input } = await setup();
      await user.type(input, 'utn');
      expect(headings()).toEqual([]);
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(options()[1]).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve([unknownRange('UTN')]);
      await waitFor(() => expect(headings()).toEqual(['Referencia', 'La calle existe']));
      expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
      expect(selectedName()).toBe(picked.nombre);
      expect(input).toHaveAttribute('aria-activedescendant', options()[1].id);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(urlOf(picked), '_blank', 'noopener,noreferrer');
    });

    it('keeps a picked row that the ranked list would otherwise hide', async () => {
      // "martin" only resembles «Sobre San Martin 8500»: once Georef knows a street called MARTIN,
      // rows like it are hidden, except the one the operator picked.
      const pending = deferred(streetsMock);
      const picked = engineHits('martin')[0];
      expect(picked.nombre).toBe('Sobre San Martin 8500');
      const { user, input } = await setup();
      await user.type(input, 'martin');
      expect(headings()).toEqual([]);
      await user.keyboard('{ArrowDown}');
      expect(options()[0]).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve([unknownRange('MARTIN')]);
      await waitFor(() => expect(headings()).toContain('La calle existe'));
      expect(headings()[headings().length - 1]).toBe('Parecido');
      expect(selectedName()).toBe('Sobre San Martin 8500');
      const row = options()[options().length - 1];
      expect(row).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', row.id);
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(urlOf(picked), '_blank', 'noopener,noreferrer');
    });

    it('selects nothing and opens nothing when the picked reference is not in the ranked list', async () => {
      // The real ranking keeps every engine hit (a picked one is pinned), so no query over the real
      // catalog loses the picked row. The ranking is wrapped to drop it, and to suggest another row.
      const [picked, other] = engineHits('utn');
      rankMock.mockImplementation((input) => {
        const output = realRankResults(input);
        if (!output.streetMode) return output;
        return { ...output, items: output.items.filter((item) => item.key !== `c:${picked.id}`), autoSelect: 0 };
      });
      const pending = deferred(streetsMock);
      const { user, input } = await setup();
      await user.type(input, 'utn');
      expect(headings()).toEqual([]);
      await user.keyboard('{ArrowDown}');
      expect(options()[0]).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve([unknownRange('UTN')]);
      await waitFor(() => expect(headings()).toEqual(['Referencia', 'La calle existe']));
      expect(options()).toHaveLength(3);
      expect(options().every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
      expect(input).not.toHaveAttribute('aria-activedescendant');
      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
      expect(status()).toHaveTextContent('Hay varias coincidencias posibles: elegí una con ↑ ↓ y Enter.');
      expect(options().every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);

      // The operator can still choose among the rows that are there.
      await user.keyboard('{ArrowDown}{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(urlOf(other), '_blank', 'noopener,noreferrer');
    });

    it('still opens the single strong match with Enter when the operator picked nothing', async () => {
      const pending = deferred(streetsMock);
      const { user, input } = await setup();
      await user.type(input, 'plaza gran malvina');
      expect(headings()).toEqual([]);
      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve([unknownRange('PLAZA GRAN MALVINA')]);
      await waitFor(() => expect(headings()).toEqual(['Referencia', 'La calle existe']));
      expect(rowNamed('Plaza Gran Malvina')).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(MALVINA_URL, '_blank', 'noopener,noreferrer');
    });
  });

  describe('rows that only resemble the query', () => {
    it('hides them when there is anything better', async () => {
      const { user, input } = await setup();
      await user.type(input, 'san martin 8540');
      await georefAnswered();
      expect(options().length).toBeGreaterThan(0);
      expect(headings()).not.toContain('Parecido');
      expect(screen.queryByText('Parecido')).not.toBeInTheDocument();
    });

    it('shows them when there is nothing better', async () => {
      const { user, input } = await setup();
      await user.type(input, 'martin 2500');
      await waitFor(() => expect(streetsMock).toHaveBeenCalled());
      await georefAnswered();
      expect(headings()).toEqual(['Parecido']);
      const rows = options();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(5);
      for (const row of rows) expect(badgesOf(row)).toEqual(['Calle', 'Parecido', 'Catálogo']);
      expect(names()).toContain('Sobre San Martin 8500');
      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('hides them when Georef finds the street, except the one the operator picked', async () => {
      const pending = deferred(geoMock);
      const { user, input } = await setup();
      await user.type(input, 'martin 2500');
      expect(headings()).toEqual(['Parecido']);
      await user.keyboard('{ArrowDown}');
      const pickedName = selectedName();
      expect(pickedName).toBe(names()[0]);

      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0].resolve([address('MARTIN', 2500)]);
      await waitFor(() => expect(headings()).toEqual(['Dirección interpolada', 'Parecido']));
      expect(names()).toEqual(['MARTIN 2500', pickedName]);
      expect(selectedName()).toBe(pickedName);
      expect(input).toHaveAttribute('aria-activedescendant', options()[1].id);
    });
  });

  describe('nothing found', () => {
    it('says so and offers a Maps text search once Georef answered with nothing', async () => {
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      expect(status()).toHaveTextContent('Buscando en Georef…');
      expect(status()).not.toHaveTextContent(/sin coincidencias/i);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();

      const link = await screen.findByRole('link', { name: `Buscar «${NOWHERE}» en Google Maps` });
      expect(link).toHaveAttribute('href', buildMapsTextUrl(NOWHERE));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(status()).toHaveTextContent(`Sin coincidencias para «${NOWHERE}».`);
      expect(status()).not.toHaveTextContent('Buscando en Georef…');
      expect(options()).toHaveLength(0);
      expect(input).toHaveAttribute('aria-expanded', 'false');
      await user.keyboard('{Enter}');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('offers the same Maps text search for a plain query with no match', async () => {
      const { user, input } = await setup();
      await user.type(input, 'qqzzxxww');
      expect(status()).toHaveTextContent('Sin coincidencias para «qqzzxxww».');
      const link = screen.getByRole('link', { name: 'Buscar «qqzzxxww» en Google Maps' });
      expect(link).toHaveAttribute('href', buildMapsTextUrl('qqzzxxww'));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('omits the link when no safe Maps URL can be built', async () => {
      const { user, input } = await setup();
      const long = 'qz'.repeat(101);
      expect(buildMapsTextUrl(long)).toBeNull();
      await user.click(input);
      await user.paste(long);
      expect(status()).toHaveTextContent(/sin coincidencias/i);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('offers no link while there is something to show or nothing typed', async () => {
      const { user, input } = await setup();
      expect(screen.queryByRole('link', { name: /buscar «/i })).not.toBeInTheDocument();
      await user.type(input, 'san martin 8540');
      await georefAnswered();
      expect(screen.queryByRole('link', { name: /buscar «/i })).not.toBeInTheDocument();
    });
  });

  describe('request lifecycle', () => {
    it('debounces: only the final text is sent', async () => {
      geoMock.mockResolvedValue(NOWHERE_HITS);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(options()).toHaveLength(2));
      expect(geoMock).toHaveBeenCalledTimes(1);
      expect(geoMock.mock.calls[0][0]).toBe(NOWHERE);
      expect(streetsMock).toHaveBeenCalledTimes(1);
      expect(streetsMock.mock.calls[0][0]).toBe('xqzv');
    });

    it('aborts both requests and ignores their answer when the query changes', async () => {
      const addresses = deferred(geoMock);
      const streets = deferred(streetsMock);
      const { user, input } = await setup();
      await user.type(input, 'xqzv 9876');
      await waitFor(() => expect(addresses).toHaveLength(1));
      expect(streets).toHaveLength(1);
      await user.type(input, '5');
      expect(addresses[0].signal?.aborted).toBe(true);
      expect(streets[0].signal?.aborted).toBe(true);
      await waitFor(() => expect(addresses).toHaveLength(2));
      expect(addresses[1].signal?.aborted).toBe(false);

      // The answer to the previous text arrives late: nothing of it is shown.
      addresses[0].resolve([address('XQZV', 9876, { localidad: 'Monte Vera' })]);
      streets[0].resolve([{ nombre: 'XQZV', localidad: 'Candioti', alturaMin: null, alturaMax: null }]);
      await new Promise((r) => setTimeout(r, 50));
      expect(options()).toHaveLength(0);
      expect(status()).toHaveTextContent('Buscando en Georef…');

      addresses[1].resolve([NOWHERE_HITS[1]]);
      streets[1].resolve([]);
      await waitFor(() => expect(options()).toHaveLength(1));
      expect(names()).toEqual(['XQZV 98765']);
      expect(options()[0]).toHaveTextContent('Recreo');
      expect(screen.queryByText('Monte Vera')).not.toBeInTheDocument();
      expect(screen.queryByText('Candioti')).not.toBeInTheDocument();
    });

    it('waits for both lookups before showing either answer', async () => {
      const streets = deferred(streetsMock);
      geoMock.mockResolvedValue(NOWHERE_HITS);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(streets).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 50));
      expect(options()).toHaveLength(0);
      expect(status()).toHaveTextContent('Buscando en Georef…');
      streets[0].resolve([]);
      await waitFor(() => expect(options()).toHaveLength(2));
    });

    it('does not reuse the previous answer when the same text is typed again', async () => {
      const addresses = deferred(geoMock);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(addresses).toHaveLength(1));
      addresses[0].resolve(NOWHERE_HITS);
      await waitFor(() => expect(options()).toHaveLength(2));

      await user.clear(input);
      expect(options()).toHaveLength(0);
      await user.type(input, NOWHERE);
      expect(status()).toHaveTextContent('Buscando en Georef…');
      expect(options()).toHaveLength(0);
      await waitFor(() => expect(addresses).toHaveLength(2));
      expect(options()).toHaveLength(0);
      addresses[1].resolve([NOWHERE_HITS[1]]);
      await waitFor(() => expect(options()).toHaveLength(1));
    });

    it('aborts both requests on unmount', async () => {
      const addresses = deferred(geoMock);
      const streets = deferred(streetsMock);
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await waitFor(() => expect(addresses).toHaveLength(1));
      expect(streets).toHaveLength(1);
      expect(addresses[0].signal?.aborted).toBe(false);
      cleanup();
      expect(addresses[0].signal?.aborted).toBe(true);
      expect(streets[0].signal?.aborted).toBe(true);
    });

    it('traces the lookups, their answer and each ranking in the console', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const lines = () => log.mock.calls.map((call) => String(call[0]));
        const { latitude, longitude } = SAN_MARTIN_8500;
        geoMock.mockResolvedValue([address('SAN MARTIN', 8540, { latitude, longitude })]);
        const { user, input } = await setup();
        await user.type(input, 'san martin 8540');
        await waitFor(() => expect(lines().some((line) => line.includes('Cuadra confirmada'))).toBe(true));
        // One line per event and no more. The mocked answer is instant, so the order of the local
        // ranking and the answer is not asserted: over the network the local ranking comes first.
        expect(lines()).toHaveLength(4);
        expect(lines()).toEqual(
          expect.arrayContaining([
            '[georef] querying /calles «san martin» and /direcciones «san martin 8540»',
            '[rank] «san martin 8540» (georef loading) -> 1 Misma cuadra, 1 Cuadra vecina, 2 Misma calle; auto-select 0',
            expect.stringMatching(/^\[georef\] «san martin 8540» -> 1 address\(es\), 0 street\(s\) in \d+ ms$/),
            '[rank] «san martin 8540» (georef done) -> 1 Cuadra confirmada, 1 Cuadra vecina, 2 Misma calle; auto-select 0',
          ]),
        );
        expect(lines()[0]).toMatch(/^\[georef\] querying/);
        expect(lines()[3]).toMatch(/^\[rank\] .*georef done/);

        // A text typed over it: its answer is dropped, and the new query is traced once it settles.
        log.mockClear();
        const pending = deferred(streetsMock);
        await user.clear(input);
        await user.type(input, 'utn');
        await waitFor(() => expect(pending).toHaveLength(1));
        await user.type(input, 'x');
        pending[0].resolve([]);
        await waitFor(() => expect(lines().some((line) => line.startsWith('[rank] «utnx»'))).toBe(true));
        expect(lines()).toEqual([
          '[georef] querying /calles «utn» (no number or cross street: /direcciones not asked)',
          '[rank] «utn» (georef loading) -> not a street query, 3 engine hit(s)',
          '[georef] discarded «utn» (query changed or aborted)',
          '[georef] querying /calles «utnx» (no number or cross street: /direcciones not asked)',
          expect.stringMatching(/^\[rank\] «utnx» \(georef loading\) -> not a street query, \d+ engine hit\(s\)$/),
        ]);
      } finally {
        log.mockRestore();
      }
    });

    it('never sends the request of a text replaced before the debounce ran out', async () => {
      const { user, input } = await setup();
      await user.type(input, NOWHERE);
      await user.clear(input);
      await new Promise((r) => setTimeout(r, 600));
      expect(geoMock).not.toHaveBeenCalled();
      expect(streetsMock).not.toHaveBeenCalled();
    });
  });
});
