# Architecture

[Back to README](../README.md)

## Data model

- Notebook exports use `omd-notebook` version 3; individual pages use `omd` version 1. Blocks include text, headings, checklists, tabs, expandable blocks, accordions, reminders, kanban, dividers, Mermaid and Excalidraw. Checklist items have optional recursive `children` arrays with at most 4 levels including root items; flat documents retain their existing shape. Item IDs are unique across the page, and checklist moves/removal carry entire subtrees.
- Horizontal tabs may contain vertical tabs; vertical tabs may contain horizontal tabs. At most two tab groups per ancestor path, including through other containers.
- No application quotas on numbers of blocks, tabs, list items, columns, cards, text length, or import size. Browser storage and device resources impose their own physical limits.
- One validated command path for UI and agents. Invalid operations are atomic.
- Transactional IndexedDB records, Zustand selectors, revision checks across windows, patch-based undo/redo, validated JSON import/export. Failed writes keep the previous state; corrupt saved data is never silently overwritten.
- Reminders include persisted delivery records and are found in hidden containers too.

Notebook exports use version 3 with a flat page collection and persistent parent links. Version 1 single-page and version 2 flat notebooks import/migrate as root pages. Automatic upgrades retain the original bytes under `.v1-backup` or `.v2-backup`; failed writes preserve the original notebook. Page hierarchy traversal and cycle checks are iterative, with a maximum of 32 levels. Each page's block schema stays unchanged.

## Rendering and persistence

Only the active page, selected tab panels, expanded toggles and open accordion sections mount their content. Mermaid/Excalidraw engines import on first visible use. Switching tabs or closing sections discards their DOM and renderer caches, unmounts React canvases and cancels pending diagram timers. Canvas edits flush before navigation. Full-page canvas commands reveal any inactive or closed ancestors first.

Blocks and content lists reconcile by stable IDs. A changed leaf rebuilds its own block while preserving ancestor headers and unrelated inputs/canvases. Reordering updates affected controls; adding a sibling does not rebuild every block. Local typing keeps its existing input, cursor and composition state. Diagram source/scene changes and theme changes update the appropriate engines; unrelated commands do not call React render. Hidden-tab data edits do not mount its content. Container event handlers retain metadata, not descendant scenes.

Zustand vanilla holds normalized records for the active page, plus lightweight metadata for every page. Switching pages reads only the new page and releases the previous payload and materializer cache. Mounted blocks and lists subscribe to their own records; a commit batches the affected DOM updates before returning. Inactive tab/closed-section renderers are released, but their data remains in the active page's records. JavaScript modules imported by the browser remain cached.

IndexedDB stores page metadata, block records, container order, canvas scenes and image-file maps separately. Drawing edits leave unchanged image bytes out of record writes and undo patches. Edits use immutable structural sharing, validate the affected page, and write only changed records in a transaction with a notebook revision check. Canvas title edits do not write scene data. Undo/redo keeps only journal IDs in RAM, with forward/inverse record patches in IndexedDB; history navigation remains session-local. Abandoned redo branches, reset history and closed sessions delete their journals. Web Lock leases preserve live tabs’ history and reclaim journals left by killed documents when reopening; browsers without Web Locks perform normal lifecycle cleanup but cannot safely reclaim a killed tab’s journals automatically. Reminder delivery uses an indexed summary across pages and a durable delivery ledger, without hydrating inactive pages. Failed transactions publish no state or history changes. BroadcastChannel reloads other windows; revision checks prevent stale writes.

Migration accepts old localStorage v1/v2/v3 notebooks, initializes IndexedDB atomically, and retains the original localStorage bytes for recovery. Normal edits never serialize the whole notebook or mirror it to localStorage. Full JSON materialization occurs only for explicit import/export/read operations. Validation and record traversal still scan the affected page, and the active page's content remains in RAM; this is not out-of-viewport data eviction. No content quantity quotas are introduced.

## Canvas persistence

Canvas changes start an IndexedDB save immediately; while a transaction is in flight, only the newest pending scene is retained. Navigation, export and agent actions await pending saves. “Saved” appears after the transaction completes. Native Excalidraw undo remains available; external notebook undo updates the mounted scene. Runtime library assets and fonts are precached for offline editing.

## View preferences

Content width and desktop sidebar preferences persist separately in browser storage under `omd.view.v1`, without modifying notebook content or undo history. Mobile drawers start closed. View preferences are device-specific and do not enter notebook JSON exports. WebMCP `omd_get_view` and `omd_set_view` share the UI's validated preference path.
