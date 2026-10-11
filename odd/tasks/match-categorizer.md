# Feature: match-categorizer

Branch `feat/match-categorizer`, stacked on `feat/georef-fallback` (not merged, not pushed).

## Objective
Grade every result of a street/address query with an explicit category, rank catalog and Georef results in ONE
hierarchy, query Georef always (not only when the catalog is empty), and show the operator why each result is where it is.

## Problem (verified on real data, 2026-10-11)
- Georef only fires with zero local hits, but weak local hits almost always exist, so it never fires.
- House numbers are fuzzy/prefix matched (`src/lib/search.ts` options): "san martin 2500" returns "Sobre San Martin 8500".
- The catalog is a block-level street gazetteer: 630 of 1062 records are `tipo: 'calle'` such as "Sobre San Martin 8500".
  User-confirmed: each one marks the WHOLE BLOCK (8500-8599). They carry the popular street name plus the Google Maps
  name as alias (`detalles["En Google Maps figura como"]`), which often differs ("Pje Segundo 4800" -> "F Aguayo").
- Georef returns no score. `/calles` is fuzzy+prefix and returns height ranges per locality. `/direcciones` can return 0
  for a street that `/calles` lists ("rivadavia 1500" in Santa Fe capital), so empty != street missing.

## Decisions (user)
1. Street and house number are graded separately; overall category; source is a separate axis.
2. House number is compared BY BLOCK (hundred), never fuzzy/prefix.
3. Street name matches against popular name AND Google alias; both are shown.
4. Georef is ALWAYS queried; the categorizer ranks everything.
5. Initial hierarchy and initial thresholds below are provisional ("para iniciar y probar").

## Hierarchy (one list, best first)
| # | Category | Source | Rule |
|---|---|---|---|
| 0 | Reference | catalog | Non-street record with a confident engine match (non-partial, tier <= AllPrefixes). Same as today. |
| 1 | ConfirmedBlock | catalog+Georef | Category 2 AND a Georef address hit within 300 m (the Georef hit is folded into this row). |
| 2 | SameBlock | catalog | Street grade >= strong AND same block as the query number. |
| 3 | Interpolated | Georef | `/direcciones` hit whose street grades >= strong and was not folded into a category 1 row. |
| 4 | NeighbourBlock | catalog | Street grade >= strong AND block distance 100..200. |
| 5 | SameStreet | catalog | Street grade >= strong AND (no query number, or block distance > 200, or record without block). |
| 6 | StreetExists | Georef | `/calles` hit grading >= strong, for a locality with no category 3 row and whose range can hold the typed number (out-of-range localities are dropped). Shows the height range. |
| 7 | Similar | both | Street grade weak (either source), or non-confident engine hits. |

Similar visibility (user decision 2026-10-11): category 7 rows are shown ONLY when categories 0-6 are all empty ("cuando no haya nada mejor"); category 6 is enough to hide them. Inside Similar: weak street-name rows first (catalog, then Georef), then non-confident engine hits; cap 5. Edge: Georef answers later than the catalog, so Similar rows may be visible first and then hidden; a Similar row the operator explicitly picked stays visible (`pinnedKey`).

Initial thresholds (to validate): neighbour = block distance <= 200; agreement = 300 m; typo tolerance for street-name
tokens = 0 edits under 4 chars, 1 edit for 4-7, 2 edits for 8+ (Damerau, a transposition is one edit); digits never tolerant.
Street grades: `exact` (same tokens), `strong` (every query token matched within tolerance, candidate has no unmatched
tokens other than single-letter initials; an initial matches a token starting with that letter), `weak` (all query tokens
matched but the candidate has extra tokens, or the last query token only matches as a prefix of >= 3 chars), `none`.
Via-type words (sobre, calle, av, avda, avenida, bv, boulevard, pje, pasaje, cjon, callejon) and stopwords are ignored when grading.

Street mode is active when the parsed query has a number or an intersection, or when any catalog segment / Georef street
grades >= strong. Outside street mode the app behaves exactly as today. Disagreement: a category 2 row with a Georef hit in
locality "Santa Fe" farther than 300 m gets a visible discrepancy note and the Georef hit stays as category 3.
Auto-select (Enter without a pick): only a single category 0 row as today, or a single category 1/2 row with no category 0
rival. Georef-only rows are never auto-selected. The pick is tracked by stable key, so late Georef answers cannot move it.

## Authorized scope
`src/lib/address.ts` (new), `src/lib/categorize.ts` (new), `src/lib/georef.ts`, `src/lib/search.ts`, `src/App.tsx`,
`src/components/*`, `src/index.css`, `tests/*`, `README.md`, `reports/technical-decisions.md`, this file.
Not in scope: import scripts, `public/data`, fixing catalog typos (the owner keeps them).

## Tasks
- [x] T1 `src/lib/address.ts` + `tests/address.test.ts`: `parseAddressQuery`, `parseCatalogStreet`, `gradeStreetName`, `blockOf`, `haversineMeters`. Route: delegated writer.
- [x] T1b `src/lib/address.ts` + tests, data shapes found in the real catalog (user decision 2026-10-11: a decimal passage name such as "Pje 38.50" / "Pje 34,50" / "Pje 169.5" is the street NAME and must be read whole; 34 records): decimal token `d+[.,]d+` is one name token (comma == dot), never a block or house number; a via-type word or a decimal name counts as the name before a house number ("pje 38.50 1200" -> street [38.50], number 1200); double blocks "8300 / 8400" mean the record covers both blocks (`blocks: number[]`); an alias "A / B" with letters on both sides is two names. Route: delegated writer.
- [x] T1c `src/lib/address.ts` + tests, from native review: R3-001 a query made only of single-letter tokens must grade `none` (an initial may only assist a match that also has a full-word token); R3-002 pin the current "san martin 2500 depto 3" behavior with a test. Plus the decimal-precision decision if the user takes it. Route: delegated writer.
- [x] T2 `src/lib/georef.ts` + tests: `GeorefHit` gains `calle` and `altura`; new `searchGeorefStreets` (`/calles`, height ranges); never throws. Route: delegated writer.
- [x] T3 `src/lib/categorize.ts` + tests, and `src/lib/search.ts`: no fuzzy on tokens containing digits; pure `rankResults(...)` implementing the hierarchy, folding, discrepancy, caps and auto-select. Route: delegated writer.
- [ ] T4 UI: `App.tsx` queries Georef always (address -> `/direcciones` + `/calles` in parallel; name only -> `/calles`), new unified result list with category + source labels, both street names, stable-key pick; remove the superseded zero-hit-only `GeorefResults`; keep the Maps text-search fallback. Route: delegated writer.
- [ ] T5 README + `reports/technical-decisions.md` + full checks + live probe against real data and the real API.

## Acceptance criteria
- "san martin 2500" no longer shows "Sobre San Martin 8500" as a match; it is category 5 (or absent if capped) and Georef rows appear.
- "san martin 8540" shows "Sobre San Martin 8500" as category 1 or 2.
- "comisaria 25", "torre 3", place names: same results and auto-select behavior as today.
- Every row in street mode shows category and source; Georef-only rows are never auto-selected.
- Existing tests stay green, or are changed deliberately with the reason recorded here.

## Follow-ups (not in this iteration)
- Query Georef with the Google alias when the popular name differs.
- Validate thresholds with the operator; tune caps.
- "S/N" (sin nombre) passages: treat "s/n" as one token so they stay matchable by name.
- Ordinals ("1ro de Mayo" vs "1 de mayo") and trailing text after the house number ("depto 3").

## Delivery
Strategy: ask-on-risk. Forecast ~1200-1500 authored changed lines (well above 400). Chain strategy: feature-branch-chain (user, 2026-10-11): each task is a small PR targeting the previous one; `main` receives everything at the end. Slice boundaries = one PR per task commit (T1, T1b, T2, T3, T4, T5). No PR created yet; nothing pushed.
Skill registry `.atl/skill-registry.md`: not present. Engram mirror `odd/match-categorizer/tasks`: condensed copy + this locator.

## Progress / evidence
- T1 done (delegated writer; trigger: 2 non-trivial files). RED observed (module missing), address tests 75/75, `npm test` 336/336, typecheck clean, lint only the 2 pre-existing warnings. Parent spot check: 75/75. ~480 lines (it.each tables).
  Real catalog: 630/630 calle records parse; 629 have a block (the one without is "Falcon").
  Literal readings to revisit: typo budget uses the shorter token; a query with more tokens than the candidate grades none; house number is the last 1-5 digit token ("san martin 2500 depto 3" -> 3); ordinals ("1ro de Mayo") need exact match; "S/N" becomes [s, n]. Decimals, double blocks and slash aliases are handled in T1b.
- T1b done (delegated writer). RED observed (39 failed), address tests 117/117, `npm test` 378/378, typecheck clean, lint only the 2 pre-existing warnings. Parent spot check: 117/117 + live probe ("pje 32.50 8350" -> street [32.50], number 8350, catalog "Pje 32,50 8300 / 8400" -> blocks [8300, 8400], grade exact).
  `CatalogStreet` is now `{ names, blocks: number[] }`. Real catalog: 34 decimal-name records, 12 double-block records, 2 slash aliases; 628/630 have a block (without: "Falcon", "Pje 173,70").
  Open literal readings: decimals are not padded, so "40,5" and "40,50" are different names (some aliases differ from their main name only by precision); slash split applies to aliases only ("Alsina/ martinet 9900" stays one name); "S/N" is protected from the slash split.
- Native review of slice d931d1c..09a1c6a (T4b fix, README, logging, T1, T1b; 871 lines, medium): consent granted, reliability lens -> approved, acknowledged (lineage review-14093f2c036bbe61, authority burned). Reviewed boundary is now 09a1c6a. Review was run after T1b instead of after T1 because T1b corrected the same unit.
  Advisory findings: R3-001 WARNING src/lib/address.ts:250 single-letter query token grades every street with that initial as `strong` (would flood categories 2-6) -> accepted as T1c, it is a defect inside this feature. R3-002 SUGGESTION address.ts:124 "depto 3" behavior unpinned -> T1c test. R3-003 SUGGESTION src/App.tsx:92-96 unconditional console.log in production -> NOT applied: the logs were an explicit user request; revisit at T4.
- T1c done (delegated writer). User decision 2026-10-11: "40,5" and "40,50" are the same passage -> decimals canonicalized without trailing zeros ("40.5") in `tokenize`. RED observed (29 failures), address tests 137/137, `npm test` 398/398, typecheck clean, lint only the 2 pre-existing warnings. Parent spot check: 137/137.
  Real catalog: 34 decimal records canonical; 2 records collapsed alias into main name ("Pje 40,50 8800/8900").
  Consequences to know: (a) the 6 "Pje S/N <block>" records have only the name [s, n] and can no longer be matched by street name (all-single-letter rule); (b) the 21 records with a one-letter alias "c" no longer match the query "c"; (c) `gradeStreetName` does not canonicalize its inputs, so Georef street names in T2/T3 MUST go through the address.ts tokenizer.
- T2 done (delegated writer). RED observed (50 failed), georef tests 78/78, `npm test` 445/445, typecheck clean, lint only the 2 pre-existing warnings. Parent spot check: 78/78 + live API probe: `searchGeoref` returns calle+altura ("SAN MARTIN 2500 @ Santa Fe"); `searchGeorefStreets("rivadavia")` returns 6 localities with ranges (Santa Fe 0-9699) while `/direcciones` "rivadavia 1500" has no Santa Fe hit; "san matrin" -> SAN MARTIN (fuzzy); nonsense -> 0.
  Notes for T3: `GeorefHit.calle` is upper-case official name and must go through the address.ts tokenizer; `alturaMin/Max` can be null independently, both null when 0/0; `searchGeoref` param order changed (values identical).
- Native review of slice 09a1c6a..81d845f (T1c + T2, 519 lines, medium): consent granted, reliability lens -> approved, acknowledged (authority burned). Reviewed boundary is now 81d845f.
  Advisory findings, both accepted into T3 because they are defects inside this feature: R3-001 src/lib/georef.ts:118-121 inverted range (inicio > fin) yields alturaMin > alturaMax -> take min/max over all four finite side values; R3-002 georef.ts:72 `Number()` accepts "0x10"/"1e3" as altura -> require digits only.
- T3 done (delegated writer + parent refinement). RED observed per part; `npm test` 556/556, typecheck clean, build OK, lint only the 2 pre-existing warnings; gold set 38/38 unchanged. ~1,270 changed lines (mostly tests; not split, the categorizer is one unit).
  Parent refinement after a live probe: `/calles` rows for localities whose range cannot hold the number were pure noise ("SAN MARTIN @ Recreo [0-1599]" for 8540) -> dropped before de-duplication; `outOfRange` field removed; 3 tests adjusted.
  Live probe (real catalog + real Georef): "san martin 8540" -> ConfirmedBlock «Sobre San Martin 8500» +Georef at 12 m, autoSelect 0; "san martin 2500" -> Interpolated Santa Fe / Santo Tomé first, catalog 8500-8900 as SameStreet; "pje 32.50 8350" -> SameBlock «Pje 32,50 8300 / 8400»; "comisaria 25" -> single Reference row, autoSelect 0.
  Behaviors to know: (a) Georef ranges are min/max over all four side values, so both bounds are null together or set together; (b) «Av Peñaloza 7700» loses auto-select because «MONOBLOCK 11» is also a confident engine hit (ambiguous -> no auto-select); (c) any trailing number puts the query in street mode ("comisaria 25", "torre 3" render through the unified list, results unchanged); (d) non-confident engine hits fill Similar with unrelated records ("San Jose 8500" for "san martin 8540"), candidate tuning: hide them when street rows exist.
- Native review of slice 81d845f..8c2d2b1 (T3, 1623 lines, medium): consent granted, reliability lens -> approved, acknowledged (lineage review-8da874e6971ee1fb, authority burned). Reviewed boundary is now 8c2d2b1.
  Findings, both applied inline by the parent (small, same files): R3-001 WARNING src/lib/georef.ts:122-125 pooled bounds turned a one-ended range into a known range that the out-of-range filter then dropped -> with one end missing that bound stays null; all four values are pooled only when both ends are known (3 test expectations restored to unknown bounds). R3-002 SUGGESTION wall-clock assertion loosened from 30 ms to 250 ms with a comment. `npm test` 556/556 after the fix.
  This supersedes behavior note (a) above: bounds can again be null independently.

## Next step
T4.
