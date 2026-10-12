# Using omd

[Back to README](../README.md)

## Workspace

Use the collapsible sidebar to create and switch pages. Click **Fixed / Fluid** in the top bar to switch page width: **Fixed** centers the page with a maximum width of 900px; **Fluid** fills the available workspace while keeping comfortable side padding. The choice applies across pages and is remembered on this device, without changing notebook content or backups. Both layouts fit smaller screens. The page menu provides JSON import/export and settings. Block actions appear on hover or keyboard focus and remain reachable on touch devices. Mobile navigation opens as a drawer; Escape or a click outside closes it.

## Adding blocks

Hover above the first block or between existing blocks to reveal **+ Add block** and insert at that position. Keyboard focus also reveals the control; it stays visible on touch devices. Each block's **…** menu also offers **Insert block before** and **Insert block after**. These controls work inside tabs, expandable blocks and accordion sections; **Add a block** at the bottom still appends. After choosing a block type, focus moves to the new block. Undo removes the insertion.

## Pages and subpages

Press Cmd+K on macOS or Ctrl+K elsewhere, or click the page button. Search and switch with arrows/Enter, create a named page, or use the per-page arrows to reorder the notebook. Each page has its own title, content and reminder preferences. All pages and their order/selection export together. Existing single-page storage upgrades automatically, preserving the original bytes in a v1 backup key.

Each browser tab chooses its own page. Switching pages does not change another tab or create an undo entry; content edits still synchronize across tabs sharing this browser profile and origin. Page URLs use `/page/:id` (or `/omd/page/:id` on GitHub Pages), so refresh, browser Back/Forward and copied links return to the selected page. Sidebar, breadcrumb and palette links support opening in a new tab. A missing or deleted page opens an existing page with a notice, without creating a replacement page.

Pages can contain subpages up to 32 levels, counting root pages as level 1. Use a sidebar page menu's **Add subpage**, the current page menu's **New subpage**, or choose **Create under** in Cmd/Ctrl+K. Sidebar branches expand/collapse; breadcrumbs navigate to ancestors. Collapsed branches discard their navigation DOM, while command-palette search still finds every page. Selecting a hidden page reveals its ancestors. Collapse preferences persist separately on this device.

**Move to…** chooses a new parent, **Move to notebook** promotes a page to the root, and up/down actions reorder siblings. Moving a parent carries its entire subtree. The destination picker excludes the moving page and its descendants; the model independently rejects cycles. Deleting a page deletes its subtree after UI confirmation, preserves at least one page, selects a surviving parent when needed, and supports undo.

## Writing and Markdown

Text blocks use Tiptap: type Markdown shortcuts such as `## ` for a heading, `- ` for a list, or `**bold**`, and use the formatting toolbar for bold, italic, strikethrough, inline code, headings, lists, quotes and code blocks. Pasting plain Markdown renders its formatting; pasting into a code block keeps literal code. The toolbar appears on hover or focus on desktop and stays visible on mobile.

Click or tap a link to open it in a new tab without leaving your notebook. To edit linked text, move the cursor into it with the arrow keys or drag to select it; Shift+click extends a selection without opening the link.

**Enter** creates a paragraph inside the current text block. **Shift+Enter** creates an empty text block immediately after the current text or heading block and moves the cursor to its start. The original block keeps all its content, including text after the cursor. This also works inside tabs, expandable blocks and accordion sections. Undo removes the insertion; redo restores it. While editing a text block, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z use notebook undo/redo.

Focus the text or heading editor before using **Shift+Enter**; the shortcut does not create blocks from the formatting toolbar or page title. While an input method is composing text (for example, Vietnamese preedit), block creation is suppressed to protect the unfinished text. Finish composition first, such as by committing the word with Space, then press **Shift+Enter**. With some input methods, the first press only commits composition; press again after it finishes.

Text content is saved as Markdown in JSON backups and WebMCP's `text` field. Existing text loads without a storage migration or automatic rewrite. Editor libraries are bundled and cached for offline writing. Switching pages or hiding a section releases its editor and retains the saved content.

## Checklists

Checklist items can contain children up to 4 levels, counting root items as level 1. Open an item's **…** menu to **Add child checklist item**, **Indent checklist item** under its previous sibling, or **Outdent checklist item** after its parent. While editing item text, Tab indents and Shift+Tab outdents when available; Enter adds the next sibling and focuses it. These shortcuts wait until text composition finishes.

Up/down arrows reorder siblings. Moving or deleting an item carries its children; undo restores the whole branch. Nesting actions are disabled when any descendant would exceed level 4. Each checkbox is independent, and progress counts all items, including children. Existing flat checklists remain compatible; nested items persist offline and in JSON backups.

WebMCP `checklist_add` accepts optional `parentId` and sibling `index`. `checklist_move` accepts optional `parentId`: omit it to keep the current parent, or use an empty string to move to the checklist root. Updates and removal find items at any depth. The shared validator rejects cycles and branches deeper than 4 levels.

## Tables

Choose **Table** in the add-block menu, including inside tabs, expandable blocks and accordion sections. The initial grid has 3 rows and 3 columns; all cells, including the optional first header row, are editable plain text. **+ Row** and **+ Column** append blank cells. Each numbered column and each row has an **…** menu to insert before/after (above/below) that position or delete it. Deletion asks for confirmation and is reversible with notebook undo/redo. At least one row and column remain.

**Header row** switches the first row's semantic header role without changing its text. **Pin header** keeps that row visible during vertical scrolling. **Pin first columns** keeps the selected number of leading columns visible during horizontal scrolling. Wide/tall grids scroll inside the table, not the page; on small screens, pin fewer columns to leave space for other cells.

Tab/Shift+Tab move between cells; Enter moves down one row; Shift+Enter adds a line break; Ctrl/⌘ + arrow keys move to adjacent cells without changing normal arrow-key text editing. Commands do not run during text composition. Cells save through the existing queue, capturing their page, block, row and column IDs; failed writes keep the draft and report an error. Navigation and dimension changes wait for composition/pending edits to finish. Offline storage, JSON backups and notebook undo/redo preserve cells, row/column order and pin settings. Existing notebook versions need no conversion.

Limits: 100 rows, 20 columns, 10,000 characters per cell. The UI, JSON import and WebMCP share grid validation (rectangular cells, unique IDs, plain text and dimensions). This is not a spreadsheet: no formulas, merged cells, sorting/filtering or CSV/Excel import.

WebMCP `add_block` accepts `type: "table"`, optional `rowCount`, `columnCount`, `headerRow`, `pinnedHeader` and `pinnedColumns`. Read the grid with `get_page`/`get_notebook`; `table_cell_update` uses `rowId` + `columnId` + `text`. `table_row_add`/`table_column_add` take a zero-based `index` (omit to append); insert next to a known row/column by deriving its index from that snapshot. Removal takes the corresponding stable ID. `update_block` changes title/header/pin settings. All five table tools accept `pageId` for inactive pages, using the same store as the UI.

## Diagrams

Add **Mermaid** for editable raw diagram definitions or fenced Mermaid Markdown, with live preview, syntax errors kept beside the source, and theme-aware rendering. Source remains editable/saved even if a diagram has syntax errors.

Add **Excalidraw** for a real editable canvas, including drawing, text, shapes and image files. **Full page** expands the same canvas across the webpage and retains the notebook page title/description. **Back to notebook** restores the embedded canvas. Cmd/Ctrl+K works in canvas mode; changing pages closes it and saves pending edits. Scene elements, image files and viewport settings are part of notebook storage and JSON exports.

## Install and offline use

After the first online load, the service worker caches the app shell. Install from Chrome/Edge's browser menu, or Safari's Share → Add to Home Screen. When an install prompt is available, Settings also shows an install button. Closing the browser/PWA and reopening keeps the notebook in IndexedDB. Offline edits persist too.

Builds fingerprint the service-worker cache. Network-first app assets allow upgrades; cached assets provide offline fallback. Mermaid, Excalidraw, React and their fonts/chunks are bundled into the static output and cached with the app. No CDN is required at runtime. No backend service, account, analytics or AI API key is needed by omd.

## Backups and reminders

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.

View preferences, including theme, sidebar state, content width and collapsed page branches, stay on this device and are excluded from notebook JSON exports.

Settings → Appearance → Theme selects one **Light**, **Dark** or **System** mode for the whole app, not individual pages. It persists on this browser/site and updates other open same-origin tabs without switching their pages. **System** follows OS appearance changes while the app is open; explicit Light/Dark ignore them. The shell, Mermaid and embedded/full-page Excalidraw canvases use the same appearance. The first upgrade retains the active old page's mode; old per-page theme fields remain in backups but switching or importing pages no longer changes appearance. Changing theme never adds notebook undo history. WebMCP uses `get_view.theme` and `set_view.theme`; older `set_page.theme` calls change this same global preference.

## WebMCP

Client-side tools cover reading the entire notebook, creating/editing/moving/removing all blocks and their items, selecting tabs, checklists, toggles/accordions, reminders, kanban columns/cards, themes/settings, undo/redo and import/export. UI and agents use the same validators and persistent store. Tool results include stable IDs for follow-up operations. Registration uses `document.modelContext`, with feature-detected compatibility for older `navigator.modelContext` implementations, and AbortSignal cleanup.

Settings shows actual support and registration failures. Unsupported browsers retain full manual functionality; omd does not pretend a custom JavaScript bridge is native WebMCP.

To use a Gemini-enabled test extension, enable Chrome's WebMCP testing flag and open omd directly. See [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). The Model Context Tool Inspector and Example Agentic Chrome Extension are separate from Gemini in Chrome. Model API credentials, when needed, belong to the extension, never this app.

Notification permission, persistent-storage requests, and PWA installation are user-click flows. Tools named `prepare_*` open these flows and return `awaiting_user_action`; they never claim a permission was granted. Agent imports validate first and require an in-page replacement confirmation plus a backup download. Other document operations can be reversed through undo.

Examples of prompts: “Create a work checklist in a vertical tab under Personal.” “Move the Launch card to Done.” “Remind me tomorrow at 4 PM Brisbane time.” The agent should read the notebook and use its IDs and explicit timezone when creating reminders.

### Page hierarchy tools

WebMCP `page_add` accepts optional `parentId`; `page_move` accepts optional `parentId` and sibling `index`. Empty parent ID means notebook root, omission preserves the parent when moving. `list_pages` returns tree order, parent IDs, depth, sibling positions and child/descendant counts. `page_remove` deletes the whole subtree. `set_view` can set `collapsedPageIds`.
