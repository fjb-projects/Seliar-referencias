import { displayBarrio } from './format';
import { buildMapsUrlFor } from './maps';
import type { Reference } from './types';

export type ShareOutcome =
  /** The device's share sheet took the data. */
  | 'shared'
  /** No share sheet (or it failed): the text with the link went to the clipboard. */
  | 'copied'
  /** The user dismissed the share sheet. */
  | 'cancelled'
  /** Neither sharing nor copying is possible in this browser/context. */
  | 'unavailable'
  /** The reference has no valid coordinates, so there is nothing safe to share. */
  | 'invalid';

/** Only what the sharing logic needs from `navigator`, so it can be tested without a browser. */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

/** Name, barrio and (when there is one) address, plus the Google Maps pin of the stored coordinates. */
export function buildSharePayload(
  ref: Pick<Reference, 'nombre' | 'barrio' | 'direccion' | 'latitude' | 'longitude'>,
): SharePayload | null {
  const url = buildMapsUrlFor(ref);
  if (!url) return null;
  const where = ref.direccion && ref.direccion !== ref.nombre ? ` (${ref.direccion})` : '';
  return { title: ref.nombre, text: `${ref.nombre} · ${displayBarrio(ref.barrio)}${where}`, url };
}

/**
 * Shares a reference through the native share sheet; falls back to copying
 * "text + link" to the clipboard. Must be called from a user gesture (a click).
 */
export async function shareReference(
  ref: Pick<Reference, 'nombre' | 'barrio' | 'direccion' | 'latitude' | 'longitude'>,
  nav: ShareNavigator = navigator,
): Promise<ShareOutcome> {
  const payload = buildSharePayload(ref);
  if (!payload) return 'invalid';

  if (typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(payload))) {
    try {
      await nav.share(payload);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other failure (policy, no targets): try the clipboard instead of giving up.
    }
  }

  if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(`${payload.text}\n${payload.url}`);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }
  return 'unavailable';
}
