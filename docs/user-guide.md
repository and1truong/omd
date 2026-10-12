# Using omd

[Back to README](../README.md)

## Workspace

Use the collapsible sidebar to create and switch pages. The page menu provides reading/full-width layout, JSON import/export and settings. Block actions appear on hover or keyboard focus and remain reachable on touch devices. Mobile navigation opens as a drawer; Escape or a click outside closes it.

## Adding blocks

Hover above the first block or between existing blocks to reveal **+ Add block** and insert at that position. Keyboard focus also reveals the control; it stays visible on touch devices. Each block's **…** menu also offers **Insert block before** and **Insert block after**. These controls work inside tabs, expandable blocks and accordion sections; **Add a block** at the bottom still appends. After choosing a block type, focus moves to the new block. Undo removes the insertion.

## Pages and subpages

Press Cmd+K on macOS or Ctrl+K elsewhere, or click the page button. Search and switch with arrows/Enter, create a named page, or use the per-page arrows to reorder the notebook. Each page has its own title, content and reminder preferences. All pages and their order/selection export together. Existing single-page storage upgrades automatically, preserving the original bytes in a v1 backup key.

Pages can contain subpages up to 32 levels, counting root pages as level 1. Use a sidebar page menu's **Add subpage**, the current page menu's **New subpage**, or choose **Create under** in Cmd/Ctrl+K. Sidebar branches expand/collapse; breadcrumbs navigate to ancestors. Collapsed branches discard their navigation DOM, while command-palette search still finds every page. Selecting a hidden page reveals its ancestors. Collapse preferences persist separately on this device.

**Move to…** chooses a new parent, **Move to notebook** promotes a page to the root, and up/down actions reorder siblings. Moving a parent carries its entire subtree. The destination picker excludes the moving page and its descendants; the model independently rejects cycles. Deleting a page deletes its subtree after UI confirmation, preserves at least one page, selects a surviving parent when needed, and supports undo.

## Writing and Markdown

Text blocks use Tiptap: type Markdown shortcuts such as `## ` for a heading, `- ` for a list, or `**bold**`, and use the formatting toolbar for bold, italic, strikethrough, inline code, headings, lists, quotes and code blocks. Pasting plain Markdown renders its formatting; pasting into a code block keeps literal code. The toolbar appears on hover or focus on desktop and stays visible on mobile.

**Enter** creates a paragraph inside the current text block. **Shift+Enter** creates an empty text block immediately after the current text or heading block and moves the cursor to its start. The original block keeps all its content, including text after the cursor. This also works inside tabs, expandable blocks and accordion sections. Undo removes the insertion; redo restores it. While editing a text block, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z use notebook undo/redo.

Text content is saved as Markdown in JSON backups and WebMCP's `text` field. Existing text loads without a storage migration or automatic rewrite. Editor libraries are bundled and cached for offline writing. Switching pages or hiding a section releases its editor and retains the saved content.

## Checklists

Checklist items can contain children up to 4 levels, counting root items as level 1. Open an item's **…** menu to **Add child checklist item**, **Indent checklist item** under its previous sibling, or **Outdent checklist item** after its parent. While editing item text, Tab indents and Shift+Tab outdents when available; Enter adds the next sibling and focuses it. These shortcuts wait until text composition finishes.

Up/down arrows reorder siblings. Moving or deleting an item carries its children; undo restores the whole branch. Nesting actions are disabled when any descendant would exceed level 4. Each checkbox is independent, and progress counts all items, including children. Existing flat checklists remain compatible; nested items persist offline and in JSON backups.

WebMCP `checklist_add` accepts optional `parentId` and sibling `index`. `checklist_move` accepts optional `parentId`: omit it to keep the current parent, or use an empty string to move to the checklist root. Updates and removal find items at any depth. The shared validator rejects cycles and branches deeper than 4 levels.

## Diagrams

Add **Mermaid** for editable raw diagram definitions or fenced Mermaid Markdown, with live preview, syntax errors kept beside the source, and theme-aware rendering. Source remains editable/saved even if a diagram has syntax errors.

Add **Excalidraw** for a real editable canvas, including drawing, text, shapes and image files. **Full page** expands the same canvas across the webpage and retains the notebook page title/description. **Back to notebook** restores the embedded canvas. Cmd/Ctrl+K works in canvas mode; changing pages closes it and saves pending edits. Scene elements, image files and viewport settings are part of notebook storage and JSON exports.

## Install and offline use

After the first online load, the service worker caches the app shell. Install from Chrome/Edge's browser menu, or Safari's Share → Add to Home Screen. When an install prompt is available, Settings also shows an install button. Closing the browser/PWA and reopening keeps the notebook in IndexedDB. Offline edits persist too.

Builds fingerprint the service-worker cache. Network-first app assets allow upgrades; cached assets provide offline fallback. Mermaid, Excalidraw, React and their fonts/chunks are bundled into the static output and cached with the app. No CDN is required at runtime. No backend service, account, analytics or AI API key is needed by omd.

## Backups and reminders

Data stays in this browser profile and origin. Clearing site data or using a different device does not preserve it; export provides a portable backup. Reminders can run while the page is open and catch up when reopened. A browser-only service worker cannot guarantee a scheduled notification after the app has closed.

View preferences, including sidebar state, content width and collapsed page branches, stay on this device and are excluded from notebook JSON exports.

## WebMCP

Client-side tools cover reading the entire notebook, creating/editing/moving/removing all blocks and their items, selecting tabs, checklists, toggles/accordions, reminders, kanban columns/cards, themes/settings, undo/redo and import/export. UI and agents use the same validators and persistent store. Tool results include stable IDs for follow-up operations. Registration uses `document.modelContext`, with feature-detected compatibility for older `navigator.modelContext` implementations, and AbortSignal cleanup.

Settings shows actual support and registration failures. Unsupported browsers retain full manual functionality; omd does not pretend a custom JavaScript bridge is native WebMCP.

To use a Gemini-enabled test extension, enable Chrome's WebMCP testing flag and open omd directly. See [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). The Model Context Tool Inspector and Example Agentic Chrome Extension are separate from Gemini in Chrome. Model API credentials, when needed, belong to the extension, never this app.

Notification permission, persistent-storage requests, and PWA installation are user-click flows. Tools named `prepare_*` open these flows and return `awaiting_user_action`; they never claim a permission was granted. Agent imports validate first and require an in-page replacement confirmation plus a backup download. Other document operations can be reversed through undo.

Examples of prompts: “Create a work checklist in a vertical tab under Personal.” “Move the Launch card to Done.” “Remind me tomorrow at 4 PM Brisbane time.” The agent should read the notebook and use its IDs and explicit timezone when creating reminders.

### Page hierarchy tools

WebMCP `page_add` accepts optional `parentId`; `page_move` accepts optional `parentId` and sibling `index`. Empty parent ID means notebook root, omission preserves the parent when moving. `list_pages` returns tree order, parent IDs, depth, sibling positions and child/descendant counts. `page_remove` deletes the whole subtree. `set_view` can set `collapsedPageIds`.
