import { describe, expect, it } from 'vitest';
import {
  buildDirectionsUrl,
  buildDirectionsUrlFor,
  buildMapsTextUrl,
  buildMapsUrl,
  buildMapsUrlFor,
  isSafeMapsTextUrl,
  isSafeMapsUrl,
  MAPS_LINK_PROPS,
} from '../src/lib/maps';
import { readReferences } from './helpers';

describe('buildMapsUrl', () => {
  it('follows the official format with an encoded comma', () => {
    expect(buildMapsUrl(-31.567358, -60.702192)).toBe(
      'https://www.google.com/maps/search/?api=1&query=-31.567358%2C-60.702192',
    );
  });

  it('does not round coordinates', () => {
    expect(buildMapsUrl(-31.6189738, -60.7055972)).toContain('query=-31.6189738%2C-60.7055972');
  });

  it.each([
    [NaN, 0],
    [0, Infinity],
    [91, 0],
    [0, 181],
    [-91, 10],
  ])('returns null for unusable coordinates (%s, %s)', (lat, lon) => {
    expect(buildMapsUrl(lat, lon)).toBeNull();
  });

  it('returns null for missing values coming from untyped data', () => {
    expect(buildMapsUrlFor({ latitude: undefined as unknown as number, longitude: 1 })).toBeNull();
  });

  it('produces a valid link for every reference of the catalogue', () => {
    for (const ref of readReferences()) {
      const url = buildMapsUrlFor(ref);
      expect(url, ref.id).not.toBeNull();
      expect(isSafeMapsUrl(url!), ref.id).toBe(true);
      const q = new URL(url!).searchParams.get('query');
      expect(q).toBe(`${ref.latitude},${ref.longitude}`);
    }
  });
});

describe('isSafeMapsUrl', () => {
  it.each([
    'http://www.google.com/maps/search/?api=1&query=-31.5%2C-60.7',
    'https://evil.example/maps/search/?api=1&query=-31.5%2C-60.7',
    'https://www.google.com/maps/search/?api=1&query=Santa+Fe',
    'https://www.google.com/maps/search/?query=-31.5%2C-60.7',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => {
    expect(isSafeMapsUrl(u)).toBe(false);
  });
});

describe('link attributes', () => {
  it('opens in a new tab without leaking the opener', () => {
    expect(MAPS_LINK_PROPS).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});

describe('buildDirectionsUrl', () => {
  it('follows the official directions format with only a destination', () => {
    expect(buildDirectionsUrl(-31.567358, -60.702192)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-31.567358%2C-60.702192',
    );
  });

  it('never sends an origin, so Google Maps starts from the device location', () => {
    const url = new URL(buildDirectionsUrl(-31.5, -60.7)!);
    expect(url.searchParams.has('origin')).toBe(false);
    expect(url.searchParams.get('destination')).toBe('-31.5,-60.7');
  });

  it('does not round coordinates', () => {
    expect(buildDirectionsUrl(-31.6189738, -60.7055972)).toContain('destination=-31.6189738%2C-60.7055972');
  });

  it.each([[NaN, 0], [0, Infinity], [91, 0], [0, 181]])('returns null for unusable coordinates (%s, %s)', (lat, lon) => {
    expect(buildDirectionsUrl(lat, lon)).toBeNull();
  });

  it('produces a valid, safe link for every reference of the catalogue', () => {
    for (const ref of readReferences()) {
      const url = buildDirectionsUrlFor(ref);
      expect(url, ref.id).not.toBeNull();
      expect(isSafeMapsUrl(url!), ref.id).toBe(true);
      expect(new URL(url!).searchParams.get('destination'), ref.id).toBe(`${ref.latitude},${ref.longitude}`);
    }
  });
});

describe('isSafeMapsUrl with directions links', () => {
  it.each([
    'https://www.google.com/maps/dir/?api=1&destination=Santa+Fe',
    'https://www.google.com/maps/dir/?destination=-31.5%2C-60.7',
    'https://www.google.com/maps/dir/?api=1&query=-31.5%2C-60.7',
    'https://www.google.com/maps/dir/?api=1&destination=-31.5%2C-60.7%2C99',
    'https://evil.example/maps/dir/?api=1&destination=-31.5%2C-60.7',
    'https://www.google.com/maps/place/?api=1&destination=-31.5%2C-60.7',
  ])('rejects %s', (u) => {
    expect(isSafeMapsUrl(u)).toBe(false);
  });

  it('accepts the directions URL built by this module', () => {
    expect(isSafeMapsUrl(buildDirectionsUrl(-31.5, -60.7)!)).toBe(true);
  });
});

describe('buildMapsTextUrl', () => {
  const base = 'https://www.google.com/maps/search/?api=1&query=';

  it('builds a text search scoped to Santa Fe, Argentina', () => {
    expect(buildMapsTextUrl('Ruta 11 km 5')).toBe(`${base}Ruta%2011%20km%205%2C%20Santa%20Fe%2C%20Argentina`);
  });

  it('adds the localidad and encodes accents, spaces and commas', () => {
    expect(buildMapsTextUrl('San Martín 2500', 'Santo Tomé')).toBe(
      `${base}San%20Mart%C3%ADn%202500%2C%20Santo%20Tom%C3%A9%2C%20Santa%20Fe%2C%20Argentina`,
    );
  });

  it('encodes ampersands so they cannot split the query', () => {
    const url = new URL(buildMapsTextUrl('Mitre & Belgrano, 1')!);
    expect(url.searchParams.get('query')).toBe('Mitre & Belgrano, 1, Santa Fe, Argentina');
    expect(url.searchParams.get('api')).toBe('1');
  });

  it('trims the text', () => {
    expect(buildMapsTextUrl('  Ruta 11  ')).toBe(buildMapsTextUrl('Ruta 11'));
  });

  it.each([[''], ['   '], ['\t\n'], ['a'.repeat(201)], ['calle\u0000x'], ['calle\nx'], ['calle\u007fx']])(
    'returns null for unusable text %j',
    (t) => {
      expect(buildMapsTextUrl(t)).toBeNull();
    },
  );

  it('accepts text of exactly 200 characters', () => {
    expect(buildMapsTextUrl('a'.repeat(200))).not.toBeNull();
  });

  it('produces a URL accepted by isSafeMapsTextUrl and rejected by isSafeMapsUrl', () => {
    const url = buildMapsTextUrl('San Martín 2500', 'Santo Tomé')!;
    expect(isSafeMapsTextUrl(url)).toBe(true);
    expect(isSafeMapsUrl(url)).toBe(false);
  });
});

describe('isSafeMapsTextUrl', () => {
  it('accepts a plain text query', () => {
    expect(isSafeMapsTextUrl('https://www.google.com/maps/search/?api=1&query=Santa+Fe')).toBe(true);
  });

  it.each([
    'http://www.google.com/maps/search/?api=1&query=Santa+Fe',
    'https://evil.example/maps/search/?api=1&query=Santa+Fe',
    'https://www.google.com/maps/dir/?api=1&query=Santa+Fe',
    'https://www.google.com/maps/search/?query=Santa+Fe',
    'https://www.google.com/maps/search/?api=2&query=Santa+Fe',
    'https://www.google.com/maps/search/?api=1',
    'https://www.google.com/maps/search/?api=1&query=',
    'https://www.google.com/maps/search/?api=1&query=-31.5%2C-60.7',
    'https://www.google.com/maps/search/?api=1&query=-31.5%2C%20-60.7',
    `https://www.google.com/maps/search/?api=1&query=${'a'.repeat(301)}`,
    'https://www.google.com/maps/search/?api=1&query=a%00b',
    'https://www.google.com/maps/search/?api=1&query=a%0Ab',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => {
    expect(isSafeMapsTextUrl(u)).toBe(false);
  });

  it('accepts a query of exactly 300 characters', () => {
    expect(isSafeMapsTextUrl(`https://www.google.com/maps/search/?api=1&query=${'a'.repeat(300)}`)).toBe(true);
  });
});

describe('isSafeMapsUrl with text links', () => {
  it('still rejects a text search URL', () => {
    expect(isSafeMapsUrl('https://www.google.com/maps/search/?api=1&query=San%20Mart%C3%ADn%202500')).toBe(false);
  });
});
