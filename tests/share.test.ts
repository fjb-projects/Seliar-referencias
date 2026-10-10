import { describe, expect, it, vi } from 'vitest';
import { buildSharePayload, shareReference, type ShareNavigator } from '../src/lib/share';
import { readReferences } from './helpers';

// A real record: "Plaza Gran Malvina", Barrio Favaloro (Fonavis workbook, cell B16).
const MALVINA = readReferences().find((r) => r.nombre === 'Plaza Gran Malvina')!;
const MALVINA_PIN = 'https://www.google.com/maps/search/?api=1&query=-31.566827%2C-60.70427';
const abort = () => new DOMException('cancelled', 'AbortError');

describe('buildSharePayload', () => {
  it('carries name, barrio and the pin link of the stored coordinates', () => {
    expect(buildSharePayload(MALVINA)).toEqual({
      title: 'Plaza Gran Malvina',
      text: 'Plaza Gran Malvina · Barrio Favaloro',
      url: MALVINA_PIN,
    });
  });

  it('adds the address when it adds information and omits it when it repeats the name', () => {
    const calle = readReferences().find((r) => r.nombre === 'Sobre F Quiroga 3800')!;
    expect(buildSharePayload(calle)!.text).toBe('Sobre F Quiroga 3800 · Barrio Favaloro (F Quiroga 3800)');
    const alberdi = readReferences().find((r) => r.nombre === 'Alberdi 8200')!;
    expect(buildSharePayload(alberdi)!.text).toBe('Alberdi 8200 · Barrio Los Cipreses');
  });

  it('never builds a payload without valid coordinates', () => {
    expect(buildSharePayload({ ...MALVINA, latitude: NaN })).toBeNull();
  });
});

describe('shareReference', () => {
  it('uses the native share sheet when it exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    const nav: ShareNavigator = { share, clipboard: { writeText } };
    expect(await shareReference(MALVINA, nav)).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Plaza Gran Malvina',
      text: 'Plaza Gran Malvina · Barrio Favaloro',
      url: MALVINA_PIN,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as cancelled, without copying anything', async () => {
    const writeText = vi.fn();
    const nav: ShareNavigator = { share: vi.fn().mockRejectedValue(abort()), clipboard: { writeText } };
    expect(await shareReference(MALVINA, nav)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing fails for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNavigator = {
      share: vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')),
      clipboard: { writeText },
    };
    expect(await shareReference(MALVINA, nav)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(`Plaza Gran Malvina · Barrio Favaloro\n${MALVINA_PIN}`);
  });

  it('copies text plus link when there is no share sheet (desktop browsers)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareReference(MALVINA, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(MALVINA_PIN));
  });

  it('skips the share sheet when canShare rejects the data', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNavigator = { share, canShare: () => false, clipboard: { writeText } };
    expect(await shareReference(MALVINA, nav)).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('reports unavailable when neither sharing nor the clipboard work', async () => {
    expect(await shareReference(MALVINA, {})).toBe('unavailable');
    const failing: ShareNavigator = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } };
    expect(await shareReference(MALVINA, failing)).toBe('unavailable');
  });

  it('refuses to share a reference without valid coordinates', async () => {
    const share = vi.fn();
    const writeText = vi.fn();
    expect(await shareReference({ ...MALVINA, longitude: Infinity }, { share, clipboard: { writeText } })).toBe('invalid');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
