# omd

**oh my day** — a local-first notebook for notes, checklists, diagrams and everyday planning.

[Open omd](https://and1truong.github.io/omd/) · [Download a release](https://github.com/and1truong/omd/releases) · [User guide](https://github.com/and1truong/omd/blob/main/docs/user-guide.md)

Your notebook stays in your browser. No account, analytics or AI API key is required. After the first online load, you can keep editing offline.

## Features

- **Pages and subpages:** organize a notebook with a sidebar, breadcrumbs and Cmd/Ctrl+K search.
- **Flexible blocks:** Tiptap Markdown text, headings, nested checklists, horizontal/vertical tabs, expandable blocks, accordions and dividers. Shift+Enter continues into a new text block.
- **Planning:** editable tables with row/column insertion and pinned headers/columns, reminders and kanban boards.
- **Diagrams:** Mermaid with live preview and Excalidraw with an editable full-page canvas.
- **Everyday controls:** undo/redo, JSON import/export, keyboard and touch-friendly reordering, and system-aware light/dark themes.
- **WebMCP:** supported browsers can let agents read and edit the notebook through the same validated commands as the UI.
- **Desktop preview:** OMD with a Coconut agent sidebar, plus the same Bridge tools for Lime in Chrome/Edge. [Build and data guide](docs/desktop.md).

## Run locally

Requires **Node.js 22 or newer**.

### From a release

Download the named ZIP or tar.gz from [GitHub Releases](https://github.com/and1truong/omd/releases), extract it, and run this inside the extracted folder:

```sh
node start.mjs
```

Open [localhost:3000](http://localhost:3000/). The package includes all browser libraries, fonts and assets; no dependency installation or build is needed.

### From source

```sh
git clone https://github.com/and1truong/omd.git
cd omd
npm install
npm start
```

Open [localhost:3000](http://localhost:3000/). `npm start` builds before serving. For static hosting, run `npm run build` and serve `dist` over HTTP/HTTPS. Relative URLs support subpaths, including GitHub Pages.

## Getting started

1. Create or switch pages from the sidebar or **Cmd/Ctrl+K**.
2. Use **+ Add block** above or between blocks, or **Add a block** at the bottom. Each block's **…** menu also offers insertion and move/delete actions.
3. Use the page menu for layout, settings and JSON import/export.

Install through Chrome/Edge's browser menu or Safari's **Share → Add to Home Screen**. Settings also shows an install button when the browser offers one. Localhost or HTTPS enables service workers and offline reopening; opening `index.html` directly does not.

## Data and reminders

Notebook data is stored in IndexedDB for the current browser profile and origin. Export JSON for a portable backup or to move between devices or hosted/local copies. Clearing site data removes the local notebook.

Reminders run while the app is open and catch up when reopened. Notifications at a scheduled time are not guaranteed after the app closes.

## Development

After installing dependencies:

```sh
npm run typecheck
npm test
npm run build
npm run check:static
```

See [development and releases](https://github.com/and1truong/omd/blob/main/docs/development.md) for browser tests, static hosting, GitHub Pages and release packaging.

## Documentation

- [User guide](https://github.com/and1truong/omd/blob/main/docs/user-guide.md): pages, blocks, diagrams, offline use and WebMCP setup.
- [Architecture](https://github.com/and1truong/omd/blob/main/docs/architecture.md): data formats, rendering, persistence, migrations and undo history.
- [Development and releases](https://github.com/and1truong/omd/blob/main/docs/development.md): checks, deployment and packaging.
