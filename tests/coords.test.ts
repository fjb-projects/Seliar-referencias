import { describe, expect, it } from 'vitest';
import { haversineKm, parseCoordinate } from '../scripts/lib/coords';

describe('parseCoordinate', () => {
  it('parses the workbook format and keeps the original text', () => {
    const r = parseCoordinate('-31.579852, -60.683891');
    expect(r).toEqual({ ok: true, latitude: -31.579852, longitude: -60.683891, raw: '-31.579852, -60.683891' });
  });

  it('keeps 7-decimal precision untouched', () => {
    const r = parseCoordinate('-31.6189738, -60.7055972');
    expect(r.ok && r.latitude).toBe(-31.6189738);
    expect(r.ok && r.longitude).toBe(-60.7055972);
  });

  it('tolerates surrounding and non-breaking spaces', () => {
    expect(parseCoordinate(' -31.579314, -60.682537  ').ok).toBe(true);
  });

  it('accepts comma decimals only with an unambiguous semicolon separator', () => {
    const r = parseCoordinate('-31,579852; -60,683891');
    expect(r.ok && r.latitude).toBe(-31.579852);
    expect(parseCoordinate('-31,579852, -60,683891').ok).toBe(false);
  });

  it.each([
    ['', 'vacia'],
    ['c', 'no_numerica'],
    ['Mendoza 3949', 'no_numerica'],
    ['Av. Ángel V. Peñaloza 7561', 'no_numerica'],
    ['-31.5', 'formato_no_reconocido'],
    ['-131.579852, -60.683891', 'fuera_de_rango'],
    ['-95.5, -60.6', 'fuera_de_rango'],
  ])('rejects %j (%s) instead of guessing', (input, reason) => {
    const r = parseCoordinate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('flags out-of-range values', () => {
    const r = parseCoordinate('-91.123456, -60.683891');
    expect(r).toEqual({ ok: false, reason: 'fuera_de_rango' });
  });
});

describe('haversineKm', () => {
  it('is ~0 for the same point and sensible for the known stray cell', () => {
    expect(haversineKm(-31.58, -60.71, -31.58, -60.71)).toBe(0);
    // The stray coordinate found in "Gremio Solidario" is ~30 km from the dataset median.
    const km = haversineKm(-31.58649, -60.711795, -31.821746, -60.854709);
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(40);
  });
});
