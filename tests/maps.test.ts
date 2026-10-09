import { describe, expect, it } from 'vitest';
import { buildMapsUrl, buildMapsUrlFor, isSafeMapsUrl, MAPS_LINK_PROPS } from '../src/lib/maps';
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
