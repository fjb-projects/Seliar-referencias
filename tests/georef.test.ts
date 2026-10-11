import { describe, expect, it, vi } from 'vitest';
import { GEOREF_LOCALIDADES, looksLikeAddress, searchGeoref, searchGeorefStreets } from '../src/lib/georef';

const SAMPLE = {
  cantidad: 2,
  total: 2,
  direcciones: [
    {
      nomenclatura: 'SAN MARTIN 2500, La Capital, Santa Fe',
      calle: { nombre: 'SAN MARTIN', id: '8206301000001', categoria: 'CALLE' },
      altura: { valor: 2500, unidad: null },
      localidad_censal: { id: '82063180', nombre: 'Santo Tomé' },
      ubicacion: { lat: -31.6637, lon: -60.7668 },
    },
    {
      nomenclatura: 'SAN MARTIN 2500, La Capital, Santa Fe',
      calle: { nombre: 'SAN MARTIN', id: '8206317000002', categoria: 'CALLE' },
      altura: { valor: '2500', unidad: null },
      localidad_censal: { id: '82063170', nombre: 'Santa Fe' },
      ubicacion: { lat: -31.6, lon: -60.7 },
    },
  ],
};

/** A `/calles` entry shaped like the live API response. */
function street(nombre: unknown, localidad: unknown, altura?: unknown) {
  return {
    nombre,
    categoria: 'CALLE',
    localidad_censal: { id: '82063170', nombre: localidad },
    ...(altura === undefined ? {} : { altura }),
  };
}

function range(inicioDerecha: unknown, inicioIzquierda: unknown, finDerecha: unknown, finIzquierda: unknown) {
  return {
    inicio: { derecha: inicioDerecha, izquierda: inicioIzquierda },
    fin: { derecha: finDerecha, izquierda: finIzquierda },
  };
}

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
        calle: 'SAN MARTIN',
        altura: 2500,
      },
      {
        label: 'SAN MARTIN 2500, La Capital, Santa Fe',
        localidad: 'Santa Fe',
        latitude: -31.6,
        longitude: -60.7,
        calle: 'SAN MARTIN',
        altura: 2500,
      },
    ]);
  });

  it.each([
    ['a number', { valor: 1500 }, 1500],
    ['a numeric string', { valor: '1500' }, 1500],
    ['a padded numeric string', { valor: ' 1500 ' }, 1500],
    ['zero', { valor: 0 }, 0],
    ['a null value', { valor: null }, null],
    ['a non-numeric string', { valor: 'S/N' }, null],
    ['a hexadecimal string', { valor: '0x10' }, null],
    ['an exponent string', { valor: '1e3' }, null],
    ['a decimal string', { valor: '12.5' }, null],
    ['a signed string', { valor: '-5' }, null],
    ['a blank string', { valor: ' ' }, null],
    ['a zero-padded string', { valor: '0150' }, 150],
    ['an empty string', { valor: '' }, null],
    ['a boolean', { valor: true }, null],
    ['an object without valor', {}, null],
    ['a null altura', null, null],
    ['a missing altura', undefined, null],
  ])('maps altura from %s', async (_label, altura, expected) => {
    const body = {
      direcciones: [
        {
          nomenclatura: 'A',
          calle: { nombre: 'RIVADAVIA' },
          ubicacion: { lat: -31, lon: -60 },
          ...(altura === undefined ? {} : { altura }),
        },
      ],
    };
    const hits = await searchGeoref('x 1', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(hits).toHaveLength(1);
    expect(hits[0].altura).toBe(expected);
  });

  it.each([
    ['a missing calle', undefined],
    ['a null calle', null],
    ['a calle without nombre', {}],
    ['a non-string nombre', { nombre: 7 }],
  ])('maps %s to an empty street name and keeps the entry', async (_label, calle) => {
    const body = {
      direcciones: [
        { nomenclatura: 'A', ubicacion: { lat: -31, lon: -60 }, ...(calle === undefined ? {} : { calle }) },
      ],
    };
    const hits = await searchGeoref('x 1', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(hits.map((h) => [h.label, h.calle])).toEqual([['A', '']]);
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops entries whose nomenclatura is not a string and keeps the valid ones', async () => {
    const body = {
      direcciones: [
        { nomenclatura: 42, localidad_censal: { nombre: 'X' }, ubicacion: { lat: -31, lon: -60 } },
        { localidad_censal: { nombre: 'X' }, ubicacion: { lat: -31, lon: -60 } },
        { nomenclatura: 'OK', localidad_censal: { nombre: 'X' }, ubicacion: { lat: -31.5, lon: -60.5 } },
      ],
    };
    const hits = await searchGeoref('x 1', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(hits.map((h) => h.label)).toEqual(['OK']);
  });

  it('keeps entries with a missing localidad_censal or a non-string nombre, using an empty localidad', async () => {
    const body = {
      direcciones: [
        { nomenclatura: 'A', ubicacion: { lat: -31, lon: -60 } },
        { nomenclatura: 'B', localidad_censal: { nombre: 7 }, ubicacion: { lat: -31, lon: -60 } },
      ],
    };
    const hits = await searchGeoref('x 1', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(hits.map((h) => [h.label, h.localidad])).toEqual([
      ['A', ''],
      ['B', ''],
    ]);
  });
});

describe('searchGeorefStreets', () => {
  it('builds the /calles request with the fixed filters and an encoded name', async () => {
    const fetchImpl = mockFetch(jsonResponse({ calles: [] }));
    await searchGeorefStreets('san martín', undefined, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://apis.datos.gob.ar/georef/api/calles');
    expect(url.searchParams.get('nombre')).toBe('san martín');
    expect(url.searchParams.get('provincia')).toBe('82');
    expect(url.searchParams.get('max')).toBe('20');
    expect(url.searchParams.get('localidad_censal')).toBe(Object.keys(GEOREF_LOCALIDADES).join(','));
    expect(url.searchParams.get('localidad_censal')?.split(',')).toHaveLength(9);
    expect(url.search).toContain('nombre=san+mart%C3%ADn');
    expect([...url.searchParams.keys()].sort()).toEqual(['localidad_censal', 'max', 'nombre', 'provincia']);
  });

  it('passes an abortable signal to fetch', async () => {
    const fetchImpl = mockFetch(jsonResponse({ calles: [] }));
    await searchGeorefStreets('rivadavia', undefined, { fetchImpl });
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a live-shaped response to streets', async () => {
    const body = {
      calles: [
        {
          nombre: 'RIVADAVIA',
          categoria: 'CALLE',
          localidad_censal: { id: '82063170', nombre: 'Santa Fe' },
          altura: { inicio: { derecha: 0, izquierda: 0 }, fin: { derecha: 9698, izquierda: 9699 } },
        },
      ],
      total: 1,
    };
    const streets = await searchGeorefStreets('rivadavia', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(streets).toEqual([{ nombre: 'RIVADAVIA', localidad: 'Santa Fe', alturaMin: 0, alturaMax: 9699 }]);
  });

  it.each([
    ['asymmetric sides', range(101, 100, 1998, 1999), 100, 1999],
    ['asymmetric sides the other way round', range(100, 101, 1999, 1998), 100, 1999],
    ['one finite side per end', range(null, 200, 'x', 900), 200, 900],
    ['a zero start with a real end', range(0, 0, 500, 0), 0, 500],
    ['all zeros (the API "no data" marker)', range(0, 0, 0, 0), null, null],
    ['an inverted range (inicio above fin)', range(9698, 9699, 0, 1), 0, 9699],
    ['an inverted range with asymmetric sides', range(900, 901, 101, 100), 100, 901],
    ['one side inverted only', range(100, 950, 900, 101), 100, 950],
    // Both bounds come from every finite side value, so one known end bounds the street by itself.
    ['no finite start (lower bound stays unknown)', range(null, undefined, 800, 801), null, 801],
    ['no finite end (upper bound stays unknown)', range(100, 101, null, 'x'), 100, null],
    ['a single finite side', range(null, null, 700, null), null, 700],
    ['numeric strings (not numbers)', range('100', '101', '900', '901'), null, null],
    ['missing inicio and fin', {}, null, null],
    ['null inicio and fin', { inicio: null, fin: null }, null, null],
    ['a null altura', null, null, null],
    ['a missing altura', undefined, null, null],
    ['a non-object altura', 5, null, null],
  ])('maps the height range for %s', async (_label, altura, alturaMin, alturaMax) => {
    const body = { calles: [street('A', 'Santa Fe', altura)] };
    const streets = await searchGeorefStreets('a', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(streets).toEqual([{ nombre: 'A', localidad: 'Santa Fe', alturaMin, alturaMax }]);
  });

  it('drops entries without a string nombre and keeps the valid ones', async () => {
    const body = {
      calles: [
        street(42, 'Santa Fe', range(0, 0, 100, 101)),
        { localidad_censal: { nombre: 'Santa Fe' } },
        null,
        'RIVADAVIA',
        street('OK', 'Recreo', range(1, 2, 100, 101)),
      ],
    };
    const streets = await searchGeorefStreets('ok', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(streets).toEqual([{ nombre: 'OK', localidad: 'Recreo', alturaMin: 1, alturaMax: 101 }]);
  });

  it('keeps entries with a missing localidad_censal or a non-string nombre, using an empty localidad', async () => {
    const body = { calles: [{ nombre: 'A' }, street('B', 7), { nombre: 'C', localidad_censal: null }] };
    const streets = await searchGeorefStreets('a', undefined, { fetchImpl: mockFetch(jsonResponse(body)) });
    expect(streets.map((s) => [s.nombre, s.localidad])).toEqual([
      ['A', ''],
      ['B', ''],
      ['C', ''],
    ]);
  });

  it('returns an empty array when the API finds nothing', async () => {
    const fetchImpl = mockFetch(jsonResponse({ cantidad: 0, calles: [], total: 0 }));
    expect(await searchGeorefStreets('zzz', undefined, { fetchImpl })).toEqual([]);
  });

  it.each(['', '   ', '\t\n'])('returns [] without calling fetch for the empty name %j', async (name) => {
    const fetchImpl = mockFetch(jsonResponse({ calles: [street('A', 'Santa Fe')] }));
    expect(await searchGeorefStreets(name, undefined, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns [] without calling fetch when the signal is already aborted', async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    expect(await searchGeorefStreets('rivadavia', controller.signal, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns [] on a non-2xx response', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ calles: [street('A', 'Santa Fe')] }, { status: 500 }));
    expect(await searchGeorefStreets('a', undefined, { fetchImpl })).toEqual([]);
  });

  it.each([['not json'], ['{"calles": 5}'], ['{"direcciones": []}'], ['null'], ['[]']])(
    'returns [] for malformed body %s',
    async (text) => {
      const fetchImpl = mockFetch(() => new Response(text, { status: 200 }));
      expect(await searchGeorefStreets('a', undefined, { fetchImpl })).toEqual([]);
    },
  );

  it('returns [] when fetch rejects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network down');
    });
    expect(await searchGeorefStreets('a', undefined, { fetchImpl })).toEqual([]);
  });

  it('returns [] when the timeout elapses', async () => {
    const fetchImpl = hangingFetch();
    expect(await searchGeorefStreets('a', undefined, { fetchImpl, timeoutMs: 20 })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the caller aborts mid-flight', async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    const pending = searchGeorefStreets('a', controller.signal, { fetchImpl, timeoutMs: 5000 });
    controller.abort();
    expect(await pending).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
