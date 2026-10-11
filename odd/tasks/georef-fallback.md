# Feature: georef-fallback

## Objective
When the local MiniSearch catalog finds nothing for an address-shaped query, fall back to the Georef API
(restricted to 9 localities of La Capital, Santa Fe) and show the result as an approximate address,
clearly distinct from verified references.

## Constraints
- `SearchEngine` stays pure and synchronous; no fetch inside it.
- Georef results are NEVER auto-selected (Enter does not open them without an explicit pick).
- Visible label "Dirección aproximada · Georef" and the locality on every Georef result.
- Timeout ~1.5 s; on failure/empty, offer a Google Maps text-search link.
- Call Georef directly from the browser (CORS verified: `Access-Control-Allow-Origin: *`, curl only).
- UI copy is Spanish (matches the existing app); code/comments in English.

## Localities (localidad_censal, all in La Capital 82063)
Santa Fe 82063170 · Recreo 82063140 · Monte Vera 82063100 · Candioti 82063060 · Angel Gallardo 82063010 ·
San José del Rincón 82063160 · Arroyo Leyes 82063030 · Santo Tomé 82063180 · Sauce Viejo 82063190.
Excluded by the user: Colonia San José.

## Known API facts (verified 2026-10-11)
- Comma-separated `localidad_censal` is accepted and filters correctly.
- Same street+number can come back in several localities (dedupe is NOT done; show locality).
- Gaps: "libertad 500", "av. 7 jefes 1000" return 0; "bv pellegrini" returned 0 earlier.
- Open question: "rivadavia 1500"/"belgrano 1000" did not return Santa Fe capital (not investigated).

## Authorized scope
`src/lib/georef.ts`, `src/lib/maps.ts`, `src/App.tsx`, `src/components/ResultList.tsx`, `src/index.css`,
`tests/*`, `README.md`, `odd/tasks/georef-fallback.md`. No changes to `search.ts`, import scripts or data.

## Tasks
- [x] T1 `src/lib/georef.ts` + `tests/georef.test.ts`: locality list, `looksLikeAddress`, `searchGeoref` (timeout, abort, mapping, errors). Route: delegated writer (2 non-trivial files).
- [ ] T2 `maps.ts`: text-search fallback URL builder + extend `isSafeMapsUrl`; tests in `tests/maps.test.ts`.
- [ ] T3 `App.tsx`: georef state machine (idle|loading|ok|empty|error), debounce, only when local hits are empty and query looks like an address; no auto-select.
- [ ] T4 `ResultList.tsx` (or sibling component) + CSS: Georef block with label, locality, fallback link; component tests.
- [ ] T5 README section + final `typecheck`, `lint`, `test`, `build`.

## Acceptance criteria
- Local results behave exactly as before (existing tests stay green).
- Address-shaped query with zero local hits shows Georef results labeled approximate, with locality.
- Enter never opens a Georef result without an explicit selection.
- Georef timeout/error/empty shows the Maps text-search link, never a blank state.

## Delivery
Strategy: ask-on-risk. Forecast ~350-450 authored changed lines; slice boundaries to be recorded here.

## Progress / evidence
- T1 done (delegated writer, trigger: 2 non-trivial files). RED observed (module missing), GREEN: georef tests 29/29,
  `npm test` 205/205, typecheck clean, lint 2 pre-existing warnings only. Parent spot check: georef tests 29/29.
  Extra: `looksLikeAddress` needs >=3 chars and `\S+ y \S+`; already-aborted signal returns [] without fetching.
  Commit: see `git log` (feat(georef): add address lookup restricted to La Capital localities).

## Next step
T2.
