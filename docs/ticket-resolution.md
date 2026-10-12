# Open ticket fixes (2026-10-12)

This change addresses issues [#22](https://github.com/and1truong/omd/issues/22), [#34](https://github.com/and1truong/omd/issues/34), [#37](https://github.com/and1truong/omd/issues/37), [#41](https://github.com/and1truong/omd/issues/41) and [#45](https://github.com/and1truong/omd/issues/45).

## Shift+Enter input transfer (#22)

Trusted keyboard events reproduced split input on Chromium 151, including root and active-tab editors. In the original implementation, an immediate `W` arrived while IndexedDB insertion was pending and changed the source to `Source stays wholeW`; the sibling received `ebKit typing`. A 150 ms insertion delay also split typing paced at 20–40 ms. Zero-delay automation alone does not establish realistic typing, so the regression additionally waits 10, 20 or 40 ms after Enter and between characters while holding the insertion acknowledgement.

The new editor receives focus synchronously in the Enter handler. It owns a normal Tiptap view and accepts editing before persistence completes. Once insertion succeeds, that same DOM/view, text and caret are adopted by the stored sibling. Active IME composition finishes on the original view before adoption. A failed insertion retains its editor and offers retry; normal flush/navigation rejects until it is saved. The insertion callback skips waiting on its own transition to avoid a circular wait.

`npm run test:transition` records trusted key/input/focus timestamps, block order and exported Markdown in `test-results/editor-transition-*.json`. Each of 16 root/tab × initial/inter-key timing × delayed/ordinary insertion cases verifies persistence after reload. Failure/retry and composition-during-insertion cases supplement the existing editor suite. Chromium and WebKit run at `/` and `/omd`. Composition lifecycle is simulated; Safari macOS/iOS and actual OS IME were unavailable in this Linux environment.

## Native Ctrl/Cmd+click (#34)

Use full Chromium's headless mode (`channel: 'chromium'`) instead of Headless Shell. Prior independent investigation in [PR #35](https://github.com/and1truong/omd/pull/35) recorded a genuine third Chrome page target at the destination while Playwright exposed only the original two pages. Full Chromium passed that investigation's 100 root + 100 project-path comparisons. This supports a driver exposure problem; it does not establish the precise internal Playwright race.

The route test retains the actual trusted Ctrl/Cmd primary click, checks modifiers/focus/default prevention, verifies destination page/URL and unchanged source page/URL, and reports native input and visible page URLs on failure. Shared-revision polling uses synchronous predicates. No timeout/retry increase, synthetic `window.open`, routing/schema change or skipped native assertion is used.

For repeated runs with slow-tab coverage:

```sh
OMD_ROUTE_REPEATS=5 OMD_ROUTE_CPU_SLOWDOWN=4 npm run test:browser
OMD_BASE_PATH=/omd OMD_ROUTE_REPEATS=5 OMD_ROUTE_CPU_SLOWDOWN=4 npm run test:browser
```

## Dependency advisories (#37)

A fresh installation of the previous graph reported 14 affected package entries (6 high, 6 moderate, 2 low). This counts packages and transitive effects, not distinct exploitable OMD paths. Fresh `npm ci` and `npm audit --json` with the checked-in lockfile now report **0 advisories**.

Exact overrides target vulnerable upstream pins without changing the Excalidraw/Mermaid versions or downgrading their majors:

| Dependency | Previous | Resolved | Compatibility verification |
| --- | --- | --- | --- |
| Excalidraw's Nanoid | 3.3.3 | 3.3.20 | Same 3.x branch; canvas scene IDs, files, import/export |
| Mermaid-to-Excalidraw's Nanoid | 4.0.2 | 5.1.16 | 4.x has no fixed release; ESM named `nanoid` API and default/integer-size calls remain supported; shipped flow/sequence/class conversion and unique generated IDs tested |
| KaTeX | 0.16.47 | 0.18.2 | Fixed release; shipped `renderToString`, fractions/roots/MathML, inherited-prototype `trust` regression, offline loading |
| lodash-es | 4.17.23 | 4.18.1 | Same major; both Mermaid parsers/conversion and canvas integration |
| Sass | 1.51.0 | 1.105.1 | Same major; removes old Chokidar/Braces path; build/static/release checks |

Production esbuild metafile confirms these emitted JavaScript contributions: Nanoid 3.3.20 (169 bytes), Nanoid 5.1.16 (180 bytes), KaTeX 0.18.2 (267062 bytes), lodash-es 4.18.1 (31888 bytes). Sass, Braces and Chokidar have no emitted production JavaScript. The patched dependency closure is recorded in packaged `DEPENDENCIES.json` and `THIRD_PARTY_NOTICES.txt`; archives receive new checksums.

The old Nanoid paths used default sizes or a fixed positive integer; no user-controlled size/custom-generator exploit was established. The KaTeX advisory required prior prototype/options influence. OMD still rejects dangerous scene prototype keys and uses Mermaid strict rendering. In particular, OMD's `htmlLabels:false` flowchart labels retain `$$...$$` as text; the suite separately exercises the actual shipped KaTeX chunk and Mermaid-to-Excalidraw converter, rather than changing security configuration to make a math fixture render.

`npm run test:diagrams` tests the actual emitted converter and KaTeX modules plus Mermaid diagrams, Excalidraw scenes/images/fonts, JSON import/export, full-page canvas and reloading/rendering after shutting down the real origin. Run on Chromium/WebKit × `/` and `/omd`. The versions above are deliberate, tested compatibility overrides; they should be removed when upstream manifests adopt fixed versions. Audit results remain a point-in-time report, not a promise against future advisories.

Reproduce the production graph without changing build conditions:

```sh
npm ci
npm audit --json
npm ls nanoid katex lodash-es sass --all
OMD_BUILD_METAFILE=/tmp/omd-bundle.json npm run build
npm run typecheck
npm test
npm run check:static
npm run package:release
npm run test:release
```

## Native v4 metadata and startup cleanup (#41, #45)

Every saved metadata page and the hierarchy are validated before page hydration, even on same-revision reloads. This retains lazy residency and reads no inactive scene/image payload. Malformed native v4 data produces an actionable recovery error; startup does not delete, clear, initialize over, rename or repair it.

The store cleans up the database, history lease and BroadcastChannel on errors anywhere after opening the repository, including owner-ID generation, a metadata change while awaiting lease grant, and later channel initialization. Metadata validation precedes history pruning. Normal close and other tabs' undo/history remain intact.

`tests/native-v4-baseline.js` records real schema/key/value snapshots produced by production `createStore` and `store.import` at `bf24961f43f010f505e5a54e8993207a07d55536`, then normal `store.close`: empty inactive root and empty inactive child. These fixtures are transported intact into Node/fake-indexeddb and real Chromium/WebKit IndexedDB tests. The previous validator rejected non-string IDs, so separate metadata-corruption cases cover those rather than claiming the baseline imported them.

Tests assert prompt rejection, exact schema/data/history/ledger/localStorage preservation, failed-startup resource release and explicit same-database repair/retry. Existing v1/v2/v3 migration rollback, special IDs, tab-local selection and lazy residency checks continue to run.
