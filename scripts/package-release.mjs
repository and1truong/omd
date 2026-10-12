import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Release requires a stable semantic version.');
const name = `omd-v${manifest.version}`;
const output = join(root, 'release');
const folder = join(output, name);
// Build/static checks precede packaging; never ship source or node_modules.
await stat(join(root, 'dist', 'index.html'));
await rm(output, { recursive: true, force: true });
await mkdir(join(folder, 'scripts'), { recursive: true });
await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
await cp(join(root, 'scripts', 'serve.mjs'), join(folder, 'scripts', 'serve.mjs'));
await cp(join(root, 'README.md'), join(folder, 'DOCUMENTATION.md'));
await writeFile(join(folder, 'start.mjs'), "process.env.OMD_STATIC_DIR='dist';\nawait import('./scripts/serve.mjs');\n");
await writeFile(join(folder, 'package.json'), JSON.stringify({
  name: 'omd', version: manifest.version, private: true, type: 'module',
  scripts: { start: 'node start.mjs' }, engines: { node: '>=22' }
}, null, 2) + '\n');
await writeFile(join(folder, 'README.md'), `# omd v${manifest.version}

This ready-to-run package includes the compiled app and all browser dependencies:
Tiptap, ProseMirror, Mermaid, Excalidraw, React, React DOM, Zustand, Immer, their bundled dependencies,
fonts, styles and icons. No npm install, build step or runtime CDN is needed.

## Run locally

Install Node.js 22 or newer once. Extract the entire archive, open a terminal in
this folder and run:

    node start.mjs

Open http://localhost:3000/ in your browser. Keep that terminal running; Ctrl+C stops
the server. The server listens only on this computer. Node itself and the browser
are system prerequisites, not included in this platform-independent archive.

You can also serve the dist folder using any static HTTP server, or publish its
contents on a static HTTPS host. Do not open index.html directly with file://.
Localhost/HTTPS enables service workers, notifications and offline app reopening.
WebMCP needs a browser/extension that supports the native API; editing works without it.

Notebook data stays in browser storage for the origin you use. Use JSON export/import
to transfer your notebook between localhost and https://and1truong.github.io/omd/.
DOCUMENTATION.md contains feature details. DEPENDENCIES.json and
THIRD_PARTY_NOTICES.txt identify third-party packages; bundled legal notices are
also retained in dist.
`);

// Record the installed production dependency closure, preserving available licenses.
// Walking manifests also covers nested versions, optional packages and installed peers.
const seen = new Set(), dependencies = [], notices = [];
async function findPackage(name, from) {
  let directory = from;
  while (directory.startsWith(root)) {
    const path = join(directory, 'node_modules', name, 'package.json');
    try { await stat(path); return path; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(directory); if (parent === directory) break; directory = parent;
  }
  return null;
}
async function visit(name, from, required = true) {
  const path = await findPackage(name, from);
  if (!path) { if (required) throw new Error(`Missing production dependency: ${name}`); return; }
  if (seen.has(path)) return; seen.add(path);
  const pkg = JSON.parse(await readFile(path, 'utf8')), directory = dirname(path);
  dependencies.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? null });
  const texts = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(entry.name)) {
      texts.push(`${entry.name}\n${await readFile(join(directory, entry.name), 'utf8')}`);
    }
  }
  notices.push(`${pkg.name}@${pkg.version}\nLicense: ${JSON.stringify(pkg.license ?? 'See bundled notices')}\n${texts.join('\n\n')}`);
  const optional = pkg.optionalDependencies ?? {};
  for (const child of Object.keys(pkg.dependencies ?? {}).sort()) await visit(child, directory, !(child in optional));
  for (const child of Object.keys(optional).sort()) await visit(child, directory, false);
  for (const child of Object.keys(pkg.peerDependencies ?? {}).sort()) await visit(child, directory, false);
}
for (const dependency of Object.keys(manifest.dependencies).sort()) await visit(dependency, root);
dependencies.sort((a,b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
await writeFile(join(folder, 'DEPENDENCIES.json'), JSON.stringify(dependencies, null, 2) + '\n');
await writeFile(join(folder, 'THIRD_PARTY_NOTICES.txt'), notices.sort().join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(join(folder, 'BUILD.json'), JSON.stringify({ version: manifest.version, commit }, null, 2) + '\n');

// Archive tooling is needed only by maintainers/CI, never by the downloaded app.
execFileSync('tar', ['-czf', `${name}.tar.gz`, name], { cwd: output });
execFileSync('zip', ['-qr', `${name}.zip`, name], { cwd: output });
const sums = [];
for (const extension of ['zip', 'tar.gz']) {
  const filename = `${name}.${extension}`;
  sums.push(`${createHash('sha256').update(await readFile(join(output, filename))).digest('hex')}  ${filename}`);
}
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Packaged ${name}: ZIP, tar.gz, checksums; ${dependencies.length} dependency records.`);
