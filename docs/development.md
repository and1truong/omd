# Development and releases

[Back to README](../README.md)

## Requirements and local server

Use Node.js 22 or newer. Install dependencies once, then start the app:

```sh
npm install
npm start
```

Open [localhost:3000](http://localhost:3000/). `npm start` builds before serving. Application modules and the service worker are TypeScript; build scripts use Node ESM.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run check:static
```

Type checks cover browser and worker environments in strict mode. Source tests run through tsx and cover the data model, migrations, persistence failures, cross-window conflicts, reminders, undo/redo, WebMCP and offline asset completeness. Static checks verify emitted imports and precached assets.

### Native browser integration

After installing dependencies and building:

```sh
npx playwright install chromium
npm run test:browser
npm run test:checklist
npm run test:editor
```

The browser suite enables Chrome's native WebMCP feature and executes tools through the real registry. It also checks mobile layout, themes, reminders, import confirmation, persistent edits and offline reopening. An unavailable browser binary or unsupported native API is a verification failure. Adapter tests alone do not verify a Gemini integration; that requires a real extension session.

CI runs the native suite at both the origin root and `/omd/`, including lazy library/font URLs and canvas behavior.

Route regression coverage uses two tabs sharing IndexedDB and native WebMCP to check independent selection/URLs, shared content, refresh, new-tab links, history, pending edits, invalid/deleted/imported pages and offline deep links. It also loads the generated static fallback with an HTTP 404 response; this simulates GitHub Pages, not a live deployment check.

The checklist browser suite checks four-level nesting, sibling ordering, Enter/Tab/Shift+Tab, composition, focus, independent checkboxes, undo/redo, persistence and touch controls. CI runs it on Chromium and WebKit at both the origin root and `/omd/`.

The editor browser suite covers Tiptap Markdown rendering, formatting, paste, Shift+Enter insertion and cursor transfer, ordinary Enter, nested containers, history, selection, composition, safe rendering, persistence and touch controls. It stops the real server to verify offline reopening and editing with cached libraries. CI runs it on Chromium and WebKit at the origin root and `/omd/`.

## Static hosting and GitHub Pages

Run `npm run build` and serve `dist` from a static HTTPS host. Relative asset, manifest and worker URLs support deployment beneath a subpath.

The local server falls back to `index.html` for `/page/:id` document requests, while missing scripts/styles remain 404s. The build emits `404.html` for GitHub Pages deep links. On other static hosts, configure an equivalent document fallback. The shell derives its base before loading assets; the service worker serves the cached shell for offline page routes. Deep links require notebook data in the same browser profile/origin: sharing a URL alone does not transfer local data.

The GitHub Pages workflow runs only for pushes to `main` or a manual run on `main`. Both build and deploy jobs require `refs/heads/main`; a manual run selecting another branch skips them. Pull requests and feature branches use the separate Checks workflow. Set **Settings → Pages → Source** to **GitHub Actions**. Main then publishes to [omd](https://and1truong.github.io/omd/), unless a custom domain is configured. Generated files and a publishing branch are not committed.

The deploy job uses the `github-pages` environment and Pages/OIDC permissions. Build checks include strict TypeScript, source tests and static-artifact integrity.

## Release packaging

```sh
npm run build
npm run check:static
npm run package:release
npm run test:release
```

Packaging creates ZIP, tar.gz and `SHA256SUMS.txt` in `release`, with a dependency-free local launcher, dependency inventory and available third-party notices. Package tests extract each archive outside the checkout, start the server without `node_modules`, and verify every asset against the build.

Pushing a `release/vVERSION` branch whose version matches `package.json` explicitly publishes that version. The Release workflow checks types, source tests, native browsers at root and `/omd/`, and extracted packages before creating a draft with assets and publishing it. It tags the tested commit and can also be run manually from the matching release branch. If publication fails, rerunning refreshes the assets and resumes only an unpublished draft targeting the same tested commit; published releases, unrelated existing tags and mismatched drafts cannot be overwritten. Update `docs/releases/vVERSION.md` for each release. Publishing a release is independent of merging changes into main; main remains the GitHub Pages source.
