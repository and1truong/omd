# omd

**oh my day** — a simple, local-first notebook with multiple pages.

A single-page web app with multiple notebook pages and editable text and headings, checklists, horizontal and vertical tabs, expandable blocks, accordions, reminders, and kanban boards. System-aware light/dark themes. Keyboard and touch-friendly ordering controls alongside drag-and-drop.

## Run

Node 22 or newer. Run `npm start` (builds first) and open localhost port 3000. Run `npm install` once to install the pinned diagram libraries and build tools. For production, run `npm run build` and serve `dist` from any static HTTPS host. Relative URLs support deployment at a subpath, including GitHub Pages.

## Pages

Press Cmd+K on macOS or Ctrl+K elsewhere, or click the page button. Search and switch with arrows/Enter, create a named page, or use the per-page arrows to reorder the notebook. Each page has its own title, content and reminder preferences. All pages and their order/selection export together. Existing single-page storage upgrades automatically, preserving the original bytes in a v1 backup key.

## Diagram blocks

Add **Mermaid** for editable raw diagram definitions or fenced Mermaid Markdown, with live preview, syntax errors kept beside the source, and theme-aware rendering. Source remains editable/saved even if a diagram has syntax errors. Rendering uses Mermaid 12.1.0 in strict mode, disabling interactive links and protecting security configuration from source directives.

Add **Excalidraw** for a real editable canvas, including drawing, text, shapes and image files. **Full page** expands the same canvas across the webpage and retains the notebook page title/description. **Back to notebook** restores the embedded canvas. Cmd/Ctrl+K works in canvas mode; changing pages closes it and saves pending edits. Scene elements, image files and viewport settings are part of notebook storage and JSON exports. Excalidraw 0.18.1 is the upstream security-patched release.

Canvas changes save after a short debounce and flush before navigation, export, agent actions and page closure. Native Excalidraw undo remains available; external notebook undo updates the mounted scene. Runtime library assets and fonts are precached for offline editing.

## Rendering and memory

Only the active page, selected tab panels, expanded toggles and open accordion sections mount their content. Mermaid/Excalidraw engines import on first visible use. Switching tabs or closing sections discards their DOM and renderer caches, unmounts React canvases and cancels pending diagram timers. Canvas edits flush before navigation. Full-page canvas commands reveal any inactive or closed ancestors first.

Blocks and content lists reconcile by stable IDs. A changed leaf rebuilds its own block while preserving ancestor headers and unrelated inputs/canvases. Reordering updates affected controls; adding a sibling does not rebuild every block. Local typing keeps its existing input, cursor and composition state. Diagram source/scene changes and theme changes update the appropriate engines; unrelated commands do not call React render. Hidden-tab data edits do not mount its content. Container event handlers retain metadata, not descendant scenes.

This frees rendered content, not the notebook's JSON or the browser's imported module cache. The localStorage store still loads the complete notebook and serializes it on edits; undo history also remains in memory. Very large notebooks can therefore still hit storage and state-management costs. No application quantity limits are introduced.

## Install and offline use

After the first online load, the service worker caches the app shell. Install from Chrome/Edge's browser menu, or Safari's Share → Add to Home Screen. When an install prompt is available, Settings also shows an install button. Closing the browser/PWA and reopening keeps the notebook in localStorage. Offline edits persist too.

Builds fingerprint the service-worker cache. Network-first app assets allow upgrades; cached assets provide offline fallback. Mermaid, Excalidraw, React and their fonts/chunks are bundled into the static output and cached with the app. No CDN is required at runtime. No server, account, analytics or AI API key is needed by omd.

## WebMCP

48 client-side tools cover reading the entire notebook, creating/editing/moving/removing all blocks and their items, selecting tabs, checklists, toggles/accordions, reminders, kanban columns/cards, themes/settings, undo/redo and import/export. UI and agents use the same validators and persistent store. Tool results include stable IDs for follow-up operations. Registration uses `document.modelContext`, with feature-detected compatibility for older `navigator.modelContext` implementations, and AbortSignal cleanup.

The footer/Settings show actual support and registration failures. Unsupported browsers retain full manual functionality; omd does not pretend a custom JavaScript bridge is native WebMCP.

To use a Gemini-enabled test extension, enable Chrome's WebMCP testing flag and open omd directly. See [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). The Model Context Tool Inspector and Example Agentic Chrome Extension are separate from Gemini in Chrome. Model API credentials, when needed, belong to the extension, never this app.

Notification permission, persistent-storage requests, and PWA installation are user-click flows. Tools named `prepare_*` open these flows and return `awaiting_user_action`; they never claim a permission was granted. Agent imports validate first and require an in-page replacement confirmation plus a backup download. Other document operations can be reversed through undo.

Examples of prompts: “Create a work checklist in a vertical tab under Personal.” “Move the Launch card to Done.” “Remind me tomorrow at 4 PM Brisbane time.” The agent should read the notebook and use its IDs and explicit timezone when creating reminders.

## Model

- Plain JSON, versioned as `omd` version 1. Text, headings, checklists, tabs, expandable blocks, accordions, reminders, kanban, and dividers.
- Horizontal tabs may contain vertical tabs; vertical tabs may contain horizontal tabs. At most two tab groups per ancestor path, including through other containers.
- No application quotas on numbers of blocks, tabs, list items, columns, cards, text length, or import size. Browser storage and device resources impose their own physical limits.
- One validated command path for UI and agents. Invalid operations are atomic.
- Write-through localStorage, revision checks across windows, undo/redo, validated JSON import/export. Failed writes keep the previous state; corrupt saved data is never silently overwritten.
- Reminders include persisted delivery records and are found in hidden containers too.

## Verification

Run `npm test` (no installation required) and `npm run build`. Tests cover atomic actions, tabs, unlimited content quantities, import/export, storage failures, cross-window conflicts, reminder catch-up, single delivery under Web Locks, undo/redo, WebMCP registration/cleanup, valid and invalid tool execution, cancellation, and offline asset completeness.

For native browser integration, install the development dependency with `npm install`, install Chromium with `npx playwright install chromium`, build, then run `npm run test:browser`. The browser test enables Chrome's native WebMCP feature, discovers and executes tools through the real registry (no polyfill), checks visible UI results and invalid inputs, then verifies mobile layout, themes, reminders, import confirmation, persistent edits and offline reopening. CI runs both sets of checks and uploads the static app and screenshots. An unavailable browser binary or unsupported native API is a verification failure, not a mocked success.

Local verification: 32 model, multi-page migration, scene, reminder, asset and WebMCP adapter tests pass; JavaScript syntax checks pass. Diagram bundling and native browser verification run in CI. Browser/extension compatibility requires the native browser check and a real extension session; adapter tests alone do not verify a Gemini integration.

## PR stack

- #1: `codex/omd-01-state` → main: validated data model and local storage.
- #2: `codex/omd-02-notebook` → `codex/omd-01-state`: notebook UI and embedded blocks.
- #3: `codex/omd-03-pwa-webmcp` → `codex/omd-02-notebook`: PWA, WebMCP and CI.
- #5: `codex/omd-04-pages` → `codex/omd-03-pwa-webmcp`: multiple pages and command palette.
- #6: `codex/omd-05-diagrams` → `codex/omd-04-pages`: Mermaid and Excalidraw, including full-page canvas.
- Rendering follow-up: `codex/omd-06-lazy-render` → `codex/omd-05-diagrams`: lazy visible content and block-scoped DOM reconciliation.

The final branch contains the complete app. Review the incremental diffs; merge bottom to top and retarget each remaining PR after its predecessor merges.

## Product constraints

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.
