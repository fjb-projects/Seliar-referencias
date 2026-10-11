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
- [x] T2 `maps.ts`: `buildMapsTextUrl` + separate `isSafeMapsTextUrl` (`isSafeMapsUrl` intentionally left strict/coordinate-only); tests in `tests/maps.test.ts`.
- [x] T2b Test hardening from native review R3-001..003 (tests only, no source changes): assert `fetchImpl` not called on already-aborted signal; cover non-string `nomenclatura` drop and empty-`localidad` fallback; cover control-char and whitespace-only `localidad` in `buildMapsTextUrl`. Files: `tests/georef.test.ts`, `tests/maps.test.ts`.
- NOTE: T3 and T4 are delegated to ONE writer (state and rendering are tightly coupled). New component file `src/components/GeorefResults.tsx` (keeps `ResultList.tsx` untouched). Georef state simplified to idle|loading|done(hits) because `searchGeoref` cannot distinguish error from empty (both -> `[]` -> fallback link). Keyboard: with no local hits, ↑↓ move between Georef hits, Enter opens only an explicitly picked one.
- [x] T3 `App.tsx`: georef state machine (idle|loading|ok|empty|error), debounce, only when local hits are empty and query looks like an address; no auto-select.
- [x] T4 `ResultList.tsx` (or sibling component) + CSS: Georef block with label, locality, fallback link; component tests.
- [x] T4b Native review R3-001/R3-002 (user accepted): `useGeoref` must not report stale cached hits as `done` after being disabled and re-enabled (must be `loading` until a fresh answer); add tests for that and for ArrowUp / wrap-around in Georef mode. Files: `src/App.tsx`, `tests/App.test.tsx`.
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

- T2 done (delegated writer, 2 files). RED observed, maps tests 61/61, `npm test` 235/235, typecheck clean, lint only the 2
  pre-existing warnings (parent replaced the control-char regex with `hasControlChars` to avoid a new no-control-regex warning).
  Design change vs plan: separate validator instead of widening `isSafeMapsUrl`, so coordinate links keep strict validation.
  `isSafeMapsUrl` has no callers outside maps.ts. Review assess: medium, under_budget (accumulated ~440 lines on branch).

- Native review of T1+T2 slice (main..50ba6bd): medium risk, consent granted, 1 lens (reliability) -> approved, acknowledged
  (lineage review-5204b13c71104d83, authority burned). Reviewed boundary is now 50ba6bd.
  Non-blocking advisory findings (not yet accepted as scope):
  - R3-001 tests/georef.test.ts:163-168: already-aborted-signal test does not assert `fetchImpl` was not called.
  - R3-002 src/lib/georef.ts:52-56: untested branches (non-string nomenclatura dropped; empty localidad fallback).
  - R3-003 src/lib/maps.ts:89-90: no test for control chars / whitespace-only `localidad` in buildMapsTextUrl.

- T2b done (delegated writer, tests only; user accepted R3-001..003 as scope). Mutation check: removing the aborted-signal
  early return made the new assertion fail (1 failed, 30 passed), line restored, `git diff -- src` empty. georef+maps tests 94/94,
  `npm test` 239/239, typecheck clean, lint only the 2 pre-existing warnings. Parent spot check: 94/94, src untouched.

- T3+T4 done (one delegated writer; trigger: 5 files, state/render coupled). RED observed (component module missing; 8/10 new App tests failed),
  App+GeorefResults tests 33/33, `npm test` 257/257, typecheck clean, build OK, lint only the 2 pre-existing warnings,
  `git diff -- src/lib src/components/ResultList.tsx` empty. Parent spot check: 33/33 + diff read (Georef gated on zero local hits,
  abort on query change, Enter without explicit pick never opens, local keyboard branch untouched).
  Deviation: ResultList.tsx untouched; new `GeorefResults.tsx` instead of editing it.

- Native review of T2b+T3+T4 slice (50ba6bd..d931d1c): medium, consent granted, reliability lens -> approved, acknowledged (lineage review-07e1e6efc2ba6d3a, authority burned). Reviewed boundary is now d931d1c.
  Non-blocking advisory findings (not yet accepted as scope):
  - R3-001 src/App.tsx:57-58: `useGeoref` keeps its last result after being disabled; returning to a previously searched address shows the cached hits as `done` while a fresh request is also issued, and the newer answer can shift the list under an explicit ArrowDown pick. Untested.
  - R3-002 src/App.tsx:142-146: ArrowUp / wrap-around in Georef mode has no test.
- T4b done (delegated writer; user accepted R3-001/R3-002). RED observed for the stale-hits regression test; fix is `setResult(null)` in the effect cleanup (lints clean). 5 new App tests (ArrowUp, wrap-around, Enter after ArrowUp, regression). App tests 29/29, `npm test` 261/261, typecheck clean, build OK, lint only the 2 pre-existing warnings. Parent spot check: App tests 29/29 + diff read (+2 lines in src/App.tsx).

## Next step
T5 (README + final full checks).
