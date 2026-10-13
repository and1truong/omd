# PR #56 runtime screenshots

Captured on 2026-10-13 from OMD commit `b33dda2372a02bc6be73e6d1b2b101b89b8dc3a7`.

Environment: Debian 12 Linux container, ordinary UID 1000, Xvfb 1600×1000 with Openbox, GTK 3.24.38, WebKitGTK 2.50.6, Tauri 2.12.1 and bundled Node 24.19.0. Native images are X11 screen captures (`import -window root`) of the real Tauri application. Each run used an isolated notebook profile.

- `00-installed-desktop.png`: freshly installed release `.deb`, launched as an ordinary user from a temporary directory. No system Node or source checkout is needed by the app. Assets/MCP respond, unauthenticated MCP returns 401, the debug port stays closed, and child servers stop with the app.
- `02-native-approval.png`: actual Coconut trusted sidebar displaying an authenticated MCP client's pending OMD mutation. The acceptance driver submits and decides through the native debug interface; this is not a simulated browser UI. Denial, approved write, durable retry, conflict, stale revision, service failure and close cleanup all pass.
- `03-native-reopened.png`: real native window after close/restart of the same profile; the inserted `Native durable bridge` note and idempotency receipt remain. Replaying the old request does not create another block.
- `04-lime-approval.png`: released Lime extension loaded in Chromium, pinned to OMD and showing the actual approval card. This extension test uses a scripted local gateway, not a live model provider. Approve adds one note; Deny leaves the revision unchanged.

Measured native layout: 1440×900 window → 1080×900 notebook + 360×900 sidebar. A real X11 resize to 1200×800 → 840×800 notebook + 360×800 sidebar. Screenshot inspection exposed Linux's vertical GtkBox packing; the source fix now uses horizontal GTK packing, explicit host bounds on other engines and a native size regression check.

The final Linux package SHA-256 is `79abe634f7608054f670c161d858ac2fa6b99238aaf51661c98137185f4c6580` (`OMD_0.0.4_amd64.deb`). Five upstream Rust policy tests and OMD's actual native acceptance passed again after the layout fix. macOS/Windows installer builds and browser checks run separately in the source PR's CI; these screenshots document Linux native and Chromium extension execution.

Re-run source checks with `npm run desktop:prepare`, `npm run desktop:build -- --debug --no-bundle` and `xvfb-run -a npm run test:desktop`. Installed-package acceptance is `xvfb-run -a node desktop/test-package.mjs /usr/bin/omd-desktop` after installing the generated `.deb`.
