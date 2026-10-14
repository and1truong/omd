# Cloudflare edition

This package runs OMD on Cloudflare Workers and stores its shared notebook in
Cloudflare D1. There is **no application login**: anyone who can reach its URL
can read, edit, export or replace the notebook. Each deployment has one notebook.
Use a deployment intended for shared/public notes.

Browser and desktop downloads keep their local IndexedDB storage. The Cloudflare
package is separate and never automatically imports local notebooks. To move
content, export JSON from the old app and import it in the cloud edition; an
import replaces the shared notebook after confirmation and a backup download.

## Deploy a downloaded package

Install Node.js 22+ and extract the entire `omd-cloudflare-vVERSION.zip` or tar.gz.
The Worker and frontend are already compiled; no application build is needed.
Wrangler is a deployment tool installed from the included pinned lockfile.
The person deploying needs a Cloudflare account; people using the app do not.

In the extracted folder:

```sh
npm ci
npx wrangler login
npm run db:create
```

Copy the database ID returned by `db:create` into `wrangler.jsonc`, replacing
`00000000-0000-0000-0000-000000000000`. Choose a unique Worker/database name for
another deployment and update the migration command's database name accordingly.
Keep the database bound as `DB` and assets bound as `ASSETS`.

```sh
npm run db:migrate
npm run deploy
```

Open the Workers URL printed by Wrangler. The first API call initializes an empty
shared notebook. Updates to the Worker keep the D1 database and its content.
Apply future migrations before deploying an updated package. Do not delete the
database when updating the Worker. Export JSON for portable backups.

The bundle needs Workers Static Assets and D1. Assets must be served by this
Worker, with `run_worker_first` enabled so `/api/notebook` and page links reach
its router. Missing assets remain 404s. Use a separate origin from any existing
local-first OMD deployment so old service-worker caches cannot select its local
storage build.

## Local preview of a downloaded package

No Cloudflare account or remote database is needed for local preview:

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Wrangler runs the actual Worker/D1 runtime locally. Its `.wrangler` directory
contains preview database state and should not be committed or included in an
updated package.

## From the repository

```sh
npm ci
npm run build:cloudflare
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

Configure `cloudflare/wrangler.jsonc` with a real database ID, then apply migrations
using `npx wrangler d1 migrations apply omd-notebook --config cloudflare/wrangler.jsonc --remote`
and deploy using `npm run cloudflare:deploy`.

## Data and synchronization

Changes are acknowledged as **Saved to cloud** only after D1 commits them.
Notebook records, Markdown, Excalidraw scenes and embedded image data live in D1;
record payloads are split into parts to avoid the per-row size limit. This version
has an 8 MiB API request limit; large imported notebooks or image edits can exceed
it. A rejected write changes no saved data and leaves the current editor draft.
R2 object storage is not required in this implementation.

Open tabs poll for changes every five seconds and refresh when focused. Page
selection, theme and layout stay specific to each tab/device. This is not a
simultaneous collaborative text editor: writes check the notebook revision. If
another device saves first, the stale write is rejected. Copy unsaved text before
reloading, then reapply it against the current notebook. Background refresh does
not replace a pending/composing editor or a draft after a failed save.

The cloud edition needs a connection; it has no offline write queue and does not
fall back to local notebook storage. Existing browser/desktop downloads retain
their offline behavior. Undo/redo belongs to the editing tab, and server history
and request-retry receipts older than seven days are cleaned up on subsequent writes. Durable agent
idempotency receipts and reminder delivery markers remain in D1. Reminders run
while the app is open, not as a scheduled Cloudflare job.

## Three download targets

| Target | Download | Notebook storage |
| --- | --- | --- |
| Browser/local server | `omd-vVERSION.zip` / `.tar.gz` | Local IndexedDB |
| Desktop | `OMD_VERSION_*.deb`, `.dmg`, `*-setup.exe` | Native WebView IndexedDB |
| Cloudflare | `omd-cloudflare-vVERSION.zip` / `.tar.gz` | Shared Cloudflare D1 |

Cloudflare archives contain the compiled frontend and Worker, Wrangler config,
D1 migrations, pinned deployment dependencies, build identity and third-party
notices. Release checksums cover all three targets.
