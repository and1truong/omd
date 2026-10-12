# omd product contract

Interprets “PWD friendly” as PWA friendly. No application quotas on content quantities or import size. Native storage capacity and device resources remain browser constraints.

| Requirement | Implementation |
| --- | --- |
| PWA / single page / paper notebook | Relative static app, standalone manifest, cache-fingerprinted service worker, editable notebook canvas |
| All features exposed to WebMCP | 48 feature-detected tools, same action/store path as UI, runtime schemas and validation |
| Dark/light awareness | OS-following system mode, explicit light/dark choices, persisted preference |
| Text editing | Tiptap Markdown, formatting toolbar, Markdown paste, Shift+Enter adds the next text block and transfers the cursor; Enter adds a paragraph |
| Checklist | Add, edit, check, remove and reorder nested items (max 4 levels including root); Enter adds next sibling; Tab/Shift+Tab indent/outdent |
| Horizontal and vertical tabs | Create, rename, select, remove and reorder; keyboard arrows, Home, End |
| Horizontal contains vertical, or vertical contains horizontal | Two tab groups per ancestor path; opposite orientations, also checked through toggles and accordions |
| No tab in tab in tab | Third tab group rejected atomically by actions and import validation |
| Expandable block | Title, open state, arbitrary child content |
| Collapsible list / accordion | Editable sections, open state, child blocks, add/remove/reorder; sections can be independently expanded |
| Reminder / browser alert or notification | Local timezone picker; ISO timestamps with timezone; delivery records; selectable notification/alert/in-page modes; permission UI |
| Kanban columns | Add, edit, remove, reorder by buttons or drag-and-drop; removing a column removes its cards, undo available |
| Kanban cards | Add, edit title/description, remove, reorder, move across columns with drag-and-drop or a select menu |
| Browser storage survives app closure | Versioned localStorage document, write-through saves, revision conflict checks, failed-write notices |
| Export/import | JSON downloads; schema validation; replace confirmation; pre-import backup; full notebook and settings restored |

## Explicit limits of a browser-only implementation

- Browser closure suspends JavaScript timers. Service workers cannot keep an arbitrary scheduled alarm running. Reminders catch up when reopened; guaranteed closed-app delivery would need a separate push/scheduling service or native extension.
- OS notifications require permission. iOS may require installing the PWA and enabling platform notification support. Permission denied/unavailable falls back to the visible in-page reminder.
- WebMCP is experimental. Supporting builds may need a Chrome flag or origin trial, and extension support is independent of the app exposing tools. Gemini-enabled test extensions do not imply Gemini in Chrome support.
- Different devices/profiles/origins do not share localStorage. Clearing browser storage removes it; exports are the portable backup.
- Multi-window reminder serialization uses Web Locks when available. The fallback persists delivery state and checks revisions, but cannot promise atomic cross-window delivery in browsers without locks.

## Architecture

`model.js` is a pure validated action layer. `store.js` commits to localStorage before exposing a change. `app.js` renders DOM with textContent/inputs and dispatches commands. `webmcp.js` provides schemas and real agent callbacks. `reminders.js` schedules and records delivery. `pwa.js` and the service worker own installation/offline behavior. Core storage remains dependency-free; diagram rendering uses pinned Mermaid, Excalidraw and React bundled locally.

This is intentionally a personal notebook, with plain text editing and local data. Rich text, cloud sync, accounts, collaboration and AI model hosting are outside the requested scope.

## Multi-page and diagram extension

Cmd/Ctrl+K lists, filters, switches, creates and reorders pages. All page data/order/selection export together; v1 storage is migrated with an original-byte backup. Reminders search every page. Mermaid accepts source or fenced Markdown and provides a theme-aware preview. Excalidraw is the real upstream canvas; full-webpage mode keeps the current notebook page header and retains the same React canvas instance. Pending edits flush before page switches, export, agent operations and closure. All rendering dependencies/fonts/chunks are cached from the same static origin.
