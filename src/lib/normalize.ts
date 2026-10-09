/** Words that carry no discriminating value in this dataset ("Sobre Calle", "Plaza de Mayo"). */
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'por', 'sobre', 'al']);

/** Lowercase, strip diacritics ("Peñaloza" -> "penaloza") and collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits on anything that is not a letter or digit, then normalises. */
export function splitTokens(input: string): string[] {
  return normalizeText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/** Search tokens: normalised, stopwords removed (unless that would leave nothing). */
export function searchTokens(input: string): string[] {
  const all = splitTokens(input);
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length > 0 ? meaningful : all;
}
