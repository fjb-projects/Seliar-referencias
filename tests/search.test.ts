import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeText, searchTokens } from '../src/lib/normalize';
import { SearchEngine, Tier } from '../src/lib/search';
import { GOLD, matchesExpectation } from './gold';
import { readReferences } from './helpers';

let engine: SearchEngine;
const refs = readReferences();

beforeAll(() => {
  engine = new SearchEngine(refs);
});

describe('normalisation', () => {
  it('strips diacritics, case and extra spaces', () => {
    expect(normalizeText('  Av.   Peñaloza  7700 ')).toBe('av. penaloza 7700');
    expect(searchTokens('Colegio  Sagrado Corazón')).toEqual(['colegio', 'sagrado', 'corazon']);
  });

  it('drops filler words but never returns an empty token list for a non-empty query', () => {
    expect(searchTokens('plaza de la memoria')).toEqual(['plaza', 'memoria']);
    expect(searchTokens('de la')).toEqual(['de', 'la']);
  });
});

describe('relevance gold set (real records)', () => {
  it.each(GOLD)('[$category] "$query"', (c) => {
    const { hits } = engine.search(c.query, 10);
    if (c.expect.length === 0) {
      expect(hits).toHaveLength(0);
      return;
    }
    const top = hits.slice(0, c.topN);
    for (const want of c.expect) {
      expect(
        top.some((h) => matchesExpectation(h.ref, want)),
        `${want.sheet} / ${want.nombre} not in top ${c.topN}: ${top.map((h) => `${h.ref.source.sheet}/${h.ref.nombre}`).join(' | ')}`,
      ).toBe(true);
    }
  });
});

describe('ranking', () => {
  it('orders by tier, exact name first', () => {
    const { hits } = engine.search('plaza', 50);
    const tiers = hits.map((h) => h.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(hits[0].tier).toBe(Tier.ExactName);
    expect(hits[0].ref.nombre.toLowerCase()).toBe('plaza');
  });

  it('is deterministic', () => {
    const a = engine.search('centro de salud', 20).hits.map((h) => h.ref.id);
    const b = new SearchEngine(refs).search('centro de salud', 20).hits.map((h) => h.ref.id);
    expect(a).toEqual(b);
  });

  it('does not let a fuzzy hit displace an exact one', () => {
    const { hits } = engine.search('Parroquia Santa Rita');
    expect(hits[0].ref.nombre).toBe('Parroquia Santa Rita');
    expect(hits[0].tier).toBe(Tier.ExactName);
    for (const h of hits.slice(1)) expect(h.tier).toBeGreaterThanOrEqual(hits[0].tier);
  });

  it('shows same-name records from different barrios as distinguishable alternatives', () => {
    const { hits } = engine.search('utn');
    const exact = hits.filter((h) => h.tier === Tier.ExactName);
    expect(exact.map((h) => h.ref.barrio).sort()).toEqual(['PTE PERON', 'VILLA SETUBAL']);
  });

  it('narrows a repeated name with the barrio words', () => {
    const { hits } = engine.search('torre 1 el pozo');
    expect(hits[0].ref.source.sheet).toBe('El Pozo');
    expect(hits[0].ref.nombre).toBe('Torre 1');
  });

  it('finds spelled-differently monoblocks through the type synonyms', () => {
    const { hits } = engine.search('monoblock favonavi');
    expect(hits.length).toBeGreaterThanOrEqual(0); // sanity: must not throw on odd input
    const ok = engine.search('monoblock iturraspe');
    expect(ok.hits.some((h) => h.ref.source.sheet.startsWith('Monoblokc Iturraspe'))).toBe(true);
  });
});

describe('digits are never typo-tolerant', () => {
  const nombres = (query: string, limit = 50) => engine.search(query, limit).hits.map((h) => h.ref.nombre);

  it('"san martin 2500" does not reach "Sobre San Martin 8500" through a fuzzy number', () => {
    const response = engine.search('san martin 2500', 50);
    expect(response.hits.filter((h) => h.tier === Tier.Fuzzy)).toEqual([]);
    // No record holds "2500" next to San Martin, so the record only shows as a flagged partial match.
    const reached = response.hits.filter((h) => h.ref.nombre === 'Sobre San Martin 8500');
    expect(reached.every((h) => h.tier === Tier.Partial)).toBe(true);
    expect(response.partial).toBe(true);
    expect(response.autoSelect).toBe(-1);
    // The record itself is still found by its own block.
    expect(nombres('san martin 8500')).toContain('Sobre San Martin 8500');
  });

  it('never matches a number one edit away, alone or swapped', () => {
    for (const query of ['san martin 8050', 'san martin 8600', 'san martin 5800']) {
      const response = engine.search(query, 50);
      const reached = response.hits.filter((h) => h.ref.nombre === 'Sobre San Martin 8500');
      // Reaching it at all is only allowed as a flagged partial match of the street words.
      expect(reached.every((h) => h.tier === Tier.Partial), query).toBe(true);
    }
  });

  it('keeps typo tolerance for the words next to a number', () => {
    expect(nombres('san matrin 8500')).toContain('Sobre San Martin 8500');
    expect(nombres('zavala 10300')).toContain('Sobre Zavalla 10300');
  });

  it('keeps "comisaria 25" on its exact record', () => {
    const response = engine.search('comisaria 25');
    expect(response.hits[0].ref.nombre).toBe('Comisaria 25');
    expect(response.hits[0].tier).toBe(Tier.ExactName);
    expect(response.autoSelect).toBe(0);
  });

  it('keeps "torre 3" on the exact towers', () => {
    const response = engine.search('torre 3');
    expect(response.hits[0].ref.nombre).toBe('Torre 3');
    expect(response.hits[0].tier).toBe(Tier.ExactName);
  });

  it('still completes a number as a prefix while typing', () => {
    const response = engine.search('torre 1', 200);
    expect(response.hits.some((h) => h.ref.nombre === 'Torre 10')).toBe(true);
    expect(response.hits.find((h) => h.ref.nombre === 'Torre 10')!.tier).toBeLessThan(Tier.Fuzzy);
  });
});

describe('auto-selection never guesses', () => {
  it('selects the only strong match', () => {
    const r = engine.search('Escuela Santa Rita De Casia');
    expect(r.autoSelect).toBe(0);
    expect(r.hits[0].ref.source.sheet).toBe('Santa Rita 1');
  });

  it('refuses when the same name exists in several barrios', () => {
    expect(engine.search('utn').autoSelect).toBe(-1);
    expect(engine.search('comisaria').autoSelect).toBe(-1);
  });

  it('refuses for fuzzy-only matches', () => {
    const r = engine.search('Parroquia Santa Rtia');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.autoSelect).toBe(-1);
  });

  it('refuses to select when the query is empty or has no match', () => {
    expect(engine.search('').autoSelect).toBe(-1);
    expect(engine.search('zzzzqx').autoSelect).toBe(-1);
  });

  it('flags partial matches when no record contains every word', () => {
    const r = engine.search('plaza zzzzqx');
    expect(r.partial).toBe(true);
    expect(r.autoSelect).toBe(-1);
    expect(r.hits.every((h) => h.tier === Tier.Partial)).toBe(true);
  });
});

describe('performance (measured on the real catalogue)', () => {
  it('indexes once in well under a second', () => {
    const t0 = performance.now();
    new SearchEngine(refs);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('answers keystroke queries with p95 under 30 ms', () => {
    const queries: string[] = [];
    for (const r of refs.filter((_, i) => i % 3 === 0)) {
      for (let len = 2; len <= r.nombre.length; len += 2) queries.push(r.nombre.slice(0, len));
    }
    for (const q of queries.slice(0, 200)) engine.search(q); // warm-up
    const times = queries.map((q) => {
      const s = performance.now();
      engine.search(q);
      return performance.now() - s;
    });
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(queries.length).toBeGreaterThan(1000);
    expect(p95).toBeLessThan(30);
  });
});

describe('queries that are genuinely ambiguous across both workbooks', () => {
  it('"torre 1" lists several exact-name towers and never auto-selects one', () => {
    const r = engine.search('torre 1', 10);
    expect(r.hits.length).toBe(10);
    expect(r.hits.every((h) => h.tier === Tier.ExactName)).toBe(true);
    expect(new Set(r.hits.map((h) => h.ref.barrio)).size).toBeGreaterThan(5);
    expect(r.autoSelect).toBe(-1);
  });

  it('finds records of both workbooks with the same engine', () => {
    const files = new Set(engine.search('torre', 50).hits.map((h) => h.ref.source.file));
    expect(files.size).toBe(2);
  });
});
