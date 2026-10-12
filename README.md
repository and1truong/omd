# omd

**oh my day** — a simple, local-first, single-page notebook.

This first layer defines the shared document model and write-through browser storage. The next stacked PR builds the interface; the final layer adds installable offline PWA behavior and WebMCP.

## Model

- Plain JSON, versioned as `omd` version 1. Text, headings, checklists, tabs, expandable blocks, accordions, reminders, kanban, and dividers.
- Horizontal tabs may contain vertical tabs; vertical tabs may contain horizontal tabs. At most two tab groups per ancestor path, including through other containers.
- No application quotas on numbers of blocks, tabs, list items, columns, cards, text length, or import size. Browser storage and device resources impose their own physical limits.
- One validated command path for UI and agents. Invalid operations are atomic.
- Write-through localStorage, revision checks across windows, undo/redo, validated JSON import/export. Failed writes keep the previous state; corrupt saved data is never silently overwritten.
- Reminders include persisted delivery records and are found in hidden containers too.

## Verification

Node 22 or newer. Run `npm test`. No runtime dependencies.

## Product constraints

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.
