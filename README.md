# omd

**oh my day** — a simple, local-first notebook with multiple pages.

A single-page web app with multiple notebook pages and editable text and headings, checklists, horizontal and vertical tabs, expandable blocks, accordions, reminders, and kanban boards. System-aware light/dark themes. Keyboard and touch-friendly ordering controls alongside drag-and-drop.

## App interface

A full-window notebook workspace with a compact fixed app bar, collapsible page sidebar, neutral system typography and consistent SVG icons. Switch/create pages from the sidebar or Cmd/Ctrl+K; per-page menus reorder the notebook. Mobile navigation becomes a native modal drawer with keyboard focus containment, Escape/backdrop dismissal and automatic closure after selection.

The page menu contains reading/full-width layout, JSON import/export and settings. Block actions appear on hover/focus on desktop and remain reachable on touch; their menus support keyboard navigation and expose move/delete actions. Text flows continuously, with no artificial page breaks or decorative site header/footer. Full-page Excalidraw retains the notebook header.

Content width and desktop sidebar preferences persist separately in browser storage under `omd.view.v1`, without modifying notebook content or undo history. Mobile drawers start closed. View preferences are device-specific and do not enter notebook JSON exports. WebMCP `omd_get_view` and `omd_set_view` share the UI's validated preference path.

## Run

For a ready-to-run download, use the named ZIP or tar.gz from [GitHub Releases](https://github.com/and1truong/omd/releases). Extract it and run `node start.mjs` with Node 22+. All browser libraries, fonts and assets are included; no npm install or build is needed. Serve the included `dist` folder on any static HTTP/HTTPS host if you prefer.

Node 22 or newer. Run `npm start` (builds first) and open localhost port 3000. Run `npm install` once to install the pinned libraries and development tools. Application modules and the service worker are TypeScript; `npm run typecheck` checks both browser and worker environments in strict mode. `npm test` runs source-level tests through tsx. Build scripts remain Node ESM. For production, run `npm run build` and serve `dist` from any static HTTPS host. Relative URLs support deployment at a subpath, including GitHub Pages.

## Release packaging

Maintainers run `npm run build`, `npm run check:static`, `npm run package:release` and `npm run test:release`. Packaging creates ZIP, tar.gz and SHA256SUMS.txt in `release`, with a dependency-free local launcher, dependency inventory and available third-party notices. Tests extract each archive outside the checkout, start the packaged server without node_modules, and verify every asset against the build.

Pushing a `release/vVERSION` branch whose version matches package.json explicitly publishes that version. The Release workflow checks types, source tests, native browsers at root and `/omd/`, and extracted packages before creating a draft with assets and publishing it. It tags the tested commit and can also be run manually from the matching release branch. If publication fails, rerunning refreshes the assets and resumes only an unpublished draft targeting the same tested commit; published releases, unrelated existing tags and mismatched drafts cannot be overwritten. Update docs/releases/vVERSION.md for each release. Publishing a release is independent of merging the packaging PR into main; main remains the GitHub Pages source.

## Pages

Press Cmd+K on macOS or Ctrl+K elsewhere, or click the page button. Search and switch with arrows/Enter, create a named page, or use the per-page arrows to reorder the notebook. Each page has its own title, content and reminder preferences. All pages and their order/selection export together. Existing single-page storage upgrades automatically, preserving the original bytes in a v1 backup key.

Pages can contain subpages up to 32 levels, counting root pages as level 1. Use a sidebar page menu's **Add subpage**, the current page menu's **New subpage**, or choose **Create under** in Cmd/Ctrl+K. Sidebar branches expand/collapse; breadcrumbs navigate to ancestors. Collapsed branches discard their navigation DOM, while command-palette search still finds every page. Selecting a hidden page reveals its ancestors. Collapse preferences persist separately on this device.

**Move to…** chooses a new parent, **Move to notebook** promotes a page to the root, and up/down actions reorder siblings. Moving a parent carries its entire subtree. The destination picker excludes the moving page and its descendants; the model independently rejects cycles. Deleting a page deletes its subtree after UI confirmation, preserves at least one page, selects a surviving parent when needed, and supports undo.

Notebook exports use version 3 with a flat page collection and persistent parent links. Version 1 single-page and version 2 flat notebooks import/migrate as root pages. Automatic upgrades retain the original bytes under `.v1-backup` or `.v2-backup`; failed writes preserve the original notebook. Page hierarchy traversal and cycle checks are iterative, with a maximum of 32 levels. Each page's block schema stays unchanged.

WebMCP `page_add` accepts optional `parentId`; `page_move` accepts optional `parentId` and sibling `index`. Empty parent ID means notebook root, omission preserves the parent when moving. `list_pages` returns tree order, parent IDs, depth, sibling positions and child/descendant counts. `page_remove` deletes the whole subtree. `set_view` can set `collapsedPageIds`.

## Diagram blocks

Add **Mermaid** for editable raw diagram definitions or fenced Mermaid Markdown, with live preview, syntax errors kept beside the source, and theme-aware rendering. Source remains editable/saved even if a diagram has syntax errors. Rendering uses Mermaid 12.1.0 in strict mode, disabling interactive links and protecting security configuration from source directives.

Add **Excalidraw** for a real editable canvas, including drawing, text, shapes and image files. **Full page** expands the same canvas across the webpage and retains the notebook page title/description. **Back to notebook** restores the embedded canvas. Cmd/Ctrl+K works in canvas mode; changing pages closes it and saves pending edits. Scene elements, image files and viewport settings are part of notebook storage and JSON exports. Excalidraw 0.18.1 is the upstream security-patched release.

Canvas changes start an IndexedDB save immediately; while a transaction is in flight, only the newest pending scene is retained. Navigation, export and agent actions await pending saves. “Saved” appears after the transaction completes. Native Excalidraw undo remains available; external notebook undo updates the mounted scene. Runtime library assets and fonts are precached for offline editing.

## Rendering and memory

Only the active page, selected tab panels, expanded toggles and open accordion sections mount their content. Mermaid/Excalidraw engines import on first visible use. Switching tabs or closing sections discards their DOM and renderer caches, unmounts React canvases and cancels pending diagram timers. Canvas edits flush before navigation. Full-page canvas commands reveal any inactive or closed ancestors first.

Blocks and content lists reconcile by stable IDs. A changed leaf rebuilds its own block while preserving ancestor headers and unrelated inputs/canvases. Reordering updates affected controls; adding a sibling does not rebuild every block. Local typing keeps its existing input, cursor and composition state. Diagram source/scene changes and theme changes update the appropriate engines; unrelated commands do not call React render. Hidden-tab data edits do not mount its content. Container event handlers retain metadata, not descendant scenes.

Zustand vanilla holds normalized records for the active page, plus lightweight metadata for every page. Switching pages reads only the new page and releases the previous payload and materializer cache. Mounted blocks and lists subscribe to their own records; a commit batches the affected DOM updates before returning. Inactive tab/closed-section renderers are released, but their data remains in the active page's records. JavaScript modules imported by the browser remain cached.

IndexedDB stores page metadata, block records, container order, canvas scenes and image-file maps separately. Drawing edits leave unchanged image bytes out of record writes and undo patches. Edits use immutable structural sharing, validate the affected page, and write only changed records in a transaction with a notebook revision check. Canvas title edits do not write scene data. Undo/redo keeps only journal IDs in RAM, with forward/inverse record patches in IndexedDB; history navigation remains session-local. Abandoned redo branches, reset history and closed sessions delete their journals. Web Lock leases preserve live tabs’ history and reclaim journals left by killed documents when reopening; browsers without Web Locks perform normal lifecycle cleanup but cannot safely reclaim a killed tab’s journals automatically. Reminder delivery uses an indexed summary across pages and a durable delivery ledger, without hydrating inactive pages. Failed transactions publish no state or history changes. BroadcastChannel reloads other windows; revision checks prevent stale writes.

Migration accepts old localStorage v1/v2/v3 notebooks, initializes IndexedDB atomically, and retains the original localStorage bytes for recovery. Normal edits never serialize the whole notebook or mirror it to localStorage. Full JSON materialization occurs only for explicit import/export/read operations. Validation and record traversal still scan the affected page, and the active page's content remains in RAM; this is not out-of-viewport data eviction. No content quantity quotas are introduced.

## GitHub Pages

The GitHub Pages workflow builds and uploads `dist` on pull requests; it deploys only main pushes or a manual run on main. Merge the TypeScript/fix prerequisites and then the Pages PR. With Settings → Pages → Source set to GitHub Actions, main publishes automatically to [omd](https://and1truong.github.io/omd/), unless a custom domain is configured. No generated files or publishing branch are committed.

The deploy job uses the github-pages environment and Pages/OIDC permissions. Build checks include strict TypeScript, source tests and static-artifact integrity. Browser CI runs the complete native suite at both origin root and `/omd/`, including lazy library/font URLs, canvas and offline reopening. Relative asset/manifest/worker URLs keep the app deployable beneath a repository path. `npm run check:static` verifies emitted imports and precached assets after a build.

## Install and offline use

After the first online load, the service worker caches the app shell. Install from Chrome/Edge's browser menu, or Safari's Share → Add to Home Screen. When an install prompt is available, Settings also shows an install button. Closing the browser/PWA and reopening keeps the notebook in IndexedDB. Offline edits persist too.

Builds fingerprint the service-worker cache. Network-first app assets allow upgrades; cached assets provide offline fallback. Mermaid, Excalidraw, React and their fonts/chunks are bundled into the static output and cached with the app. No CDN is required at runtime. No server, account, analytics or AI API key is needed by omd.

## WebMCP

50 client-side tools cover reading the entire notebook, creating/editing/moving/removing all blocks and their items, selecting tabs, checklists, toggles/accordions, reminders, kanban columns/cards, themes/settings, undo/redo and import/export. UI and agents use the same validators and persistent store. Tool results include stable IDs for follow-up operations. Registration uses `document.modelContext`, with feature-detected compatibility for older `navigator.modelContext` implementations, and AbortSignal cleanup.

The footer/Settings show actual support and registration failures. Unsupported browsers retain full manual functionality; omd does not pretend a custom JavaScript bridge is native WebMCP.

To use a Gemini-enabled test extension, enable Chrome's WebMCP testing flag and open omd directly. See [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). The Model Context Tool Inspector and Example Agentic Chrome Extension are separate from Gemini in Chrome. Model API credentials, when needed, belong to the extension, never this app.

Notification permission, persistent-storage requests, and PWA installation are user-click flows. Tools named `prepare_*` open these flows and return `awaiting_user_action`; they never claim a permission was granted. Agent imports validate first and require an in-page replacement confirmation plus a backup download. Other document operations can be reversed through undo.

Examples of prompts: “Create a work checklist in a vertical tab under Personal.” “Move the Launch card to Done.” “Remind me tomorrow at 4 PM Brisbane time.” The agent should read the notebook and use its IDs and explicit timezone when creating reminders.

## Model

- Plain JSON, versioned as `omd` version 1. Text, headings, checklists, tabs, expandable blocks, accordions, reminders, kanban, and dividers.
- Horizontal tabs may contain vertical tabs; vertical tabs may contain horizontal tabs. At most two tab groups per ancestor path, including through other containers.
- No application quotas on numbers of blocks, tabs, list items, columns, cards, text length, or import size. Browser storage and device resources impose their own physical limits.
- One validated command path for UI and agents. Invalid operations are atomic.
- Transactional IndexedDB records, Zustand selectors, revision checks across windows, patch-based undo/redo, validated JSON import/export. Failed writes keep the previous state; corrupt saved data is never silently overwritten.
- Reminders include persisted delivery records and are found in hidden containers too.

## Verification

After `npm install`, run `npm run typecheck`, `npm test` and `npm run build`. Tests cover atomic actions, tabs, unlimited content quantities, import/export, storage failures, cross-window conflicts, reminder catch-up, single delivery under Web Locks, undo/redo, WebMCP registration/cleanup, valid and invalid tool execution, cancellation, and offline asset completeness.

For native browser integration, install the development dependency with `npm install`, install Chromium with `npx playwright install chromium`, build, then run `npm run test:browser`. The browser test enables Chrome's native WebMCP feature, discovers and executes tools through the real registry (no polyfill), checks visible UI results and invalid inputs, then verifies mobile layout, themes, reminders, import confirmation, persistent edits and offline reopening. CI requires strict TypeScript checks before running either set of checks and uploads the static app and screenshots. An unavailable browser binary or unsupported native API is a verification failure, not a mocked success.

Local verification: 68 model, record-store, multi-page migration, scene, reminder, asset and WebMCP adapter tests pass; JavaScript syntax checks pass. Production bundling and native Chromium 151 verification pass in CI, including cross-tab IndexedDB synchronization and active-page residency. Browser/extension compatibility requires the native browser check and a real extension session; adapter tests alone do not verify a Gemini integration.

## PR stack

- #1: `codex/omd-01-state` → main: validated data model and local storage.
- #2: `codex/omd-02-notebook` → `codex/omd-01-state`: notebook UI and embedded blocks.
- #3: `codex/omd-03-pwa-webmcp` → `codex/omd-02-notebook`: PWA, WebMCP and CI.
- #5: `codex/omd-04-pages` → `codex/omd-03-pwa-webmcp`: multiple pages and command palette.
- #6: `codex/omd-05-diagrams` → `codex/omd-04-pages`: Mermaid and Excalidraw, including full-page canvas.
- App shell: `codex/omd-07-app-shell` → `codex/omd-06-lazy-render`: full-window workspace, page sidebar and contextual actions.
- Rendering follow-up: `codex/omd-06-lazy-render` → `codex/omd-05-diagrams`: lazy visible content and block-scoped DOM reconciliation.

- TypeScript: `codex/omd-11-typescript` → main after #11 merged: strict browser/worker type checks, block/command/storage contracts and typed external boundaries.
- Review follow-up: #11 fixes the remaining merged-stack findings; see [audit](docs/review-findings.md).
- Record store: `codex/omd-09-record-store` → `codex/omd-08-page-tree`: Zustand, incremental IndexedDB persistence, lazy page hydration and patch history.
- Page tree: `codex/omd-08-page-tree` → `codex/omd-07-app-shell`: nested pages, tree navigation and subtree moves.

The final branch contains the complete app. Review the incremental diffs; merge bottom to top and retarget each remaining PR after its predecessor merges.

## Product constraints

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.
