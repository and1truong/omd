# omd

**oh my day** — a simple, local-first, single-page notebook.

One page with editable text and headings, checklists, horizontal and vertical tabs, expandable blocks, accordions, reminders, and kanban boards. System-aware light/dark themes. Keyboard and touch-friendly ordering controls alongside drag-and-drop.

## Run

Node 22 or newer. Run `npm start` and open localhost port 3000. No dependency installation or runtime dependencies. Serve the repository root from any static HTTPS host for production. Offline PWA and WebMCP integration are in the next stacked PR.

## Model

- Plain JSON, versioned as `omd` version 1. Text, headings, checklists, tabs, expandable blocks, accordions, reminders, kanban, and dividers.
- Horizontal tabs may contain vertical tabs; vertical tabs may contain horizontal tabs. At most two tab groups per ancestor path, including through other containers.
- No application quotas on numbers of blocks, tabs, list items, columns, cards, text length, or import size. Browser storage and device resources impose their own physical limits.
- One validated command path for UI and agents. Invalid operations are atomic.
- Write-through localStorage, revision checks across windows, undo/redo, validated JSON import/export. Failed writes keep the previous state; corrupt saved data is never silently overwritten.
- Reminders include persisted delivery records and are found in hidden containers too.

## Verification

Run `npm test`. Tests cover atomic actions, tabs, unlimited content quantities, import/export, storage failures, cross-window conflicts, reminder catch-up, single delivery under Web Locks, and undo/redo.

## Product constraints

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.
