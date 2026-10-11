import { describe, expect, it, vi } from 'vitest';
import { GEOREF_LOCALIDADES, looksLikeAddress, searchGeoref } from '../src/lib/georef';

const SAMPLE = {
  cantidad: 2,
  total: 2,
  direcciones: [
    {
      nomenclatura: 'SAN MARTIN 2500, La Capital, Santa Fe',
      localidad_censal: { id: '82063180', nombre: 'Santo Tomé' },
      ubicacion: { lat: -31.6637, lon: -60.7668 },
    },
    {
      nomenclatura: 'SAN MARTIN 2500, La Capital, Santa Fe',
      localidad_censal: { id: '82063170', nombre: 'Santa Fe' },
      ubicacion: { lat: -31.6, lon: -60.7 },
    },
  ],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function mockFetch(response: Response | (() => Response)) {
  return vi.fn<typeof fetch>(async () => (typeof response === 'function' ? response() : response));
}

/** A fetch that never resolves on its own and rejects when its signal aborts. */
function hangingFetch() {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

describe('GEOREF_LOCALIDADES', () => {
  it('lists exactly the nine allowed localities', () => {
    expect(GEOREF_LOCALIDADES).toEqual({
      '82063170': 'Santa Fe',
      '82063140': 'Recreo',
      '82063100': 'Monte Vera',
      '82063060': 'Candioti',
      '82063010': 'Angel Gallardo',
      '82063160': 'San José del Rincón',
      '82063030': 'Arroyo Leyes',
      '82063180': 'Santo Tomé',
      '82063190': 'Sauce Viejo',
    });
  });
});

describe('looksLikeAddress', () => {
  it.each([
    'san martin 2500',
    'bv pellegrini 1500',
    '  rivadavia 1500  ',
    'san martin y juan de garay',
    'San Martin Y Juan de Garay',
    'calle 4',
  ])('is true for "%s"', (query) => {
    expect(looksLikeAddress(query)).toBe(true);
  });

  it.each(['', '   ', 'a', 'ab', 'comisaria', 'hospital iturraspe', 'y', 'san martin y', 'y garay'])(
    'is false for "%s"',
    (query) => {
      expect(looksLikeAddress(query)).toBe(false);
    },
  );
});

describe('searchGeoref', () => {
  it('builds the request with the fixed filters and an encoded address', async () => {
    const fetchImpl = mockFetch(jsonResponse({ direcciones: [] }));
    await searchGeoref('san martín 2500', undefined, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://apis.datos.gob.ar/georef/api/direcciones');
    expect(url.searchParams.get('direccion')).toBe('san martín 2500');
    expect(url.searchParams.get('provincia')).toBe('82');
    expect(url.searchParams.get('max')).toBe('5');
    expect(url.searchParams.get('localidad_censal')).toBe(Object.keys(GEOREF_LOCALIDADES).join(','));
    expect(url.searchParams.get('localidad_censal')?.split(',')).toHaveLength(9);
    expect(url.search).toContain('direccion=san+mart%C3%ADn+2500');
  });

  it('maps API directions to hits', async () => {
    const hits = await searchGeoref('san martin 2500', undefined, { fetchImpl: mockFetch(jsonResponse(SAMPLE)) });
    expect(hits).toEqual([
      {
        label: 'SAN MARTIN 2500, La Capital, Santa Fe',
        localidad: 'Santo Tomé',
        latitude: -31.6637,
        longitude: -60.7668,
      },
      {
        label: 'SAN MARTIN 2500, La Capital, Santa Fe',
        localidad: 'Santa Fe',
        latitude: -31.6,
        longitude: -60.7,
      },
    ]);
  });

  it('drops entries with null or non-finite coordinates', async () => {
    const body = {
      direcciones: [
        { nomenclatura: 'A', localidad_censal: { nombre: 'X' }, ubicacion: { lat: null, lon: null } },
        { nomenclatura: 'B', localidad_censal: { nombre: 'X' }, ubicacion: { lat: -31, lon: null } },
        { nomenclatura: 'C', localidad_censal: { nombre: 'X' }, ubicacion: { lat: 'x', lon: -60 } },
        { nomenclatura: 'D', localidad_censal: { nombre: 'X' } },
        { nomenclatura: 'E', localidad_censal: { nombre: 'X' }, ubicacion: { lat: -31.5, lon: -60.5 } },
      ],
    };
    const hits = await searchGeoref('x 1', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(hits.map((h) => h.label)).toEqual(['E']);
  });

  it('returns an empty array when the API finds nothing', async () => {
    const hits = await searchGeoref('x 1', undefined, {
      fetchImpl: mockFetch(jsonResponse({ cantidad: 0, direcciones: [], total: 0 })),
    });
    expect(hits).toEqual([]);
  });

  it('returns [] on a non-2xx response', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(SAMPLE, { status: 500 }));
    expect(await searchGeoref('x 1', undefined, { fetchImpl })).toEqual([]);
  });

  it.each([['not json'], ['{"direcciones": 5}'], ['null'], ['[]']])('returns [] for malformed body %s', async (text) => {
    const fetchImpl = mockFetch(() => new Response(text, { status: 200 }));
    expect(await searchGeoref('x 1', undefined, { fetchImpl })).toEqual([]);
  });

  it('returns [] when fetch rejects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network down');
    });
    expect(await searchGeoref('x 1', undefined, { fetchImpl })).toEqual([]);
  });

  it('returns [] when the timeout elapses', async () => {
    const fetchImpl = hangingFetch();
    expect(await searchGeoref('x 1', undefined, { fetchImpl, timeoutMs: 20 })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the caller aborts mid-flight', async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    const pending = searchGeoref('x 1', controller.signal, { fetchImpl, timeoutMs: 5000 });
    controller.abort();
    expect(await pending).toEqual([]);
  });

  it('returns [] without throwing when the signal is already aborted', async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    expect(await searchGeoref('x 1', controller.signal, { fetchImpl })).toEqual([]);
  });
});
