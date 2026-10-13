# OMD Desktop preview

OMD is the main notebook window; Coconut supplies the trusted agent sidebar and local MCP host. The build downloads the curated [Orchard v0.1.0 release](https://github.com/and1truong/orchad/releases/tag/orchard-v0.1.0), verifies its SHA-256 and source revision, and applies the small OMD integration in `desktop/customize.mjs`. It does not clone or copy the Orchard monorepo. `desktop/orchard.json` pins every downloaded artifact and the bundled Node runtime.

## Build or run

Building requires Node 24+, Rust stable and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Linux needs WebKitGTK 4.1 and GTK 3. Windows needs WebView2; macOS uses system WKWebView.

```sh
npm ci
npm run desktop:prepare
npm run desktop:dev
# Or build the installer for the current platform:
npm run desktop:build
```

Preparation generates `.desktop/coconut-desktop-kit`; rerun it after changing OMD source. Installers are under `.desktop/target/release/bundle`. The Desktop preview workflow builds Linux `.deb`, macOS `.dmg` and Windows NSIS `.exe` artifacts. These are unsigned previews: signing, notarization and automatic updates are not configured. A merged PR does not publish an OMD release automatically.

Installed OMD includes its asset server, browser assets and Node 24.19.0. Users do not need Node/npm. OMD opens `http://127.0.0.1:33181` inside its native guest; Coconut MCP binds `http://127.0.0.1:33182/mcp`. Both servers start and stop with the native process. A second running instance or occupied port fails rather than silently changing the notebook origin.

## Notebook and agent

The native WebView's IndexedDB profile owns the notebook. Browser OMD and desktop OMD have separate profiles: export JSON from the browser and import it in desktop to move your data. Keep exports as backups. Closing waits for editor drafts and pending IndexedDB writes; a failed or timed-out save keeps the window open. Reminders run while OMD is open and catch up on reopening.

Ordinary editing requires no agent credentials. To use the sidebar, configure a local OpenAI-compatible gateway at `http://127.0.0.1:4311`, its model and credential, then explicitly consent to sending context. The default model is a development placeholder; no model service is bundled. Gateway credentials entered in the sidebar stay in memory. Every agent write requires a trusted approval card and a pinned notebook revision. Read consent is scoped to the current notebook and tool catalog. MCP clients must first pair from the sidebar; pairing tokens are temporary and revocable.

OMD exposes `window.agentBridgeV1` using the released Bridge contract. Agent edits go through the same validated commands as the UI, with atomic revision checks and durable idempotency receipts in the notebook's IndexedDB transaction. Retries survive restarts; conflicting keys and stale revisions fail safely. Full notebook imports and UI navigation are not agent tools. Large reads can use `omd_list_blocks` and `omd_get_block`; wire limits do not limit ordinary notebook size.

## Lime in Chrome/Edge

Lime is a browser extension, so it runs in Chrome/Edge alongside browser OMD. Native WebKit/WebView2 does not load Chrome extensions; desktop uses Coconut for the same Bridge tools.

`npm run desktop:prepare` also verifies and downloads `.desktop/downloads/orchard-lime-extension-0.1.0.zip`; CI includes this ZIP beside the installer. Extract it, enable Developer mode at `chrome://extensions` (or `edge://extensions`), choose **Load unpacked**, and select the extracted directory. Open OMD in that browser and pin the tab in Lime. Read consent and approval live in Lime's trusted side panel. See the [Lime guide](https://github.com/and1truong/orchad/blob/orchard-v0.1.0/lime/README.md) for gateway setup and optional MCP companion.

## Validate

```sh
npm run typecheck
npm test
npm run build
npm run check:static
# Requires Playwright browsers:
npm run test:bridge:browser
# Linux: build debug native binary, then run against an isolated test profile:
npm run desktop:build -- --debug --no-bundle
xvfb-run -a npm run test:desktop
```

Native acceptance drives the actual Tauri guest and real authenticated MCP, including approval/denial, retry/conflict/stale checks, restart persistence and sidecar cleanup. Its TCP driver is available only in debug builds with `COCONUT_SMOKE=1`; it is absent from release builds. macOS and Windows installer builds and upstream native policy tests run in CI; OMD's interactive acceptance currently runs on Linux.
