/**
 * Builds every marketing asset: assembles a self-contained HTML page per scene,
 * then screenshots it with headless Chrome.
 *
 *   node marketing/tools/render.mjs              # everything
 *   node marketing/tools/render.mjs hero         # only scenes matching "hero"
 *
 * Why Chrome and not an SVG rasteriser: the compositions lean on backdrop
 * blur, layered gradients, real font shaping and CSS transforms. A browser is
 * the only renderer that agrees with what the product itself is drawn in.
 *
 * Every asset is one page at exactly the export size, captured at 2× device
 * scale, so a 1200×630 OG image lands as a 2400×1260 file.
 */
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KIT = path.join(ROOT, 'kit');
const SCENES = path.join(ROOT, 'scenes');
const HTML = path.join(ROOT, 'html');
const OUT = path.join(ROOT, 'out');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome or Edge found — install one, or point CHROME at a binary.');
  process.exit(1);
}

/* ── Load the kit + scenes ─────────────────────────────────────────────── */

const read = (p) => readFile(p, 'utf8');

const css = {
  fonts: await read(path.join(KIT, 'fonts.css')),
  product: await read(path.join(KIT, 'product.css')),
  scene: await read(path.join(KIT, 'scene.css')),
};

const js = {
  icons: await read(path.join(KIT, 'icons.js')),
  logo: await read(path.join(KIT, 'logo.js')),
  data: await read(path.join(KIT, 'data.js')),
  ui: await read(path.join(KIT, 'ui.js')),
  devices: await read(path.join(KIT, 'devices.js')),
};

const sceneFiles = (await readdir(SCENES)).filter((f) => f.endsWith('.js')).sort();
const sceneSrc = [];
for (const f of sceneFiles) sceneSrc.push(await read(path.join(SCENES, f)));

/*
 * Scene files only register plain objects on window.SCENES at load time — no
 * DOM touched until html() runs in the browser. That lets the same files be
 * evaluated here purely to read each scene's export dimensions.
 */
const sandbox = { window: { SCENES: {}, BRAND: { name: '', sub: '' }, DATA: {}, LOGO: '' }, console };
sandbox.window.icon = () => '';
createContext(sandbox);
for (const src of sceneSrc) runInContext(src, sandbox);
const registry = sandbox.window.SCENES;

const filter = process.argv[2];
const names = Object.keys(registry)
  .filter((n) => !filter || n.includes(filter))
  .sort();

if (!names.length) {
  console.error(filter ? `No scene matches "${filter}".` : 'No scenes registered.');
  process.exit(1);
}

/* ── Page assembly ─────────────────────────────────────────────────────── */

function page(name, scene) {
  // Transparent scenes are for assets that get composited onto a page that
  // supplies its own background — a device frame with real alpha around it
  // sits on the landing page's gradient instead of punching a dark box in it.
  const bg = scene.transparent ? 'transparent' : '#000';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css.fonts}</style>
<style>${css.product}</style>
<style>${css.scene}</style>
<style>
  html, body { width:${scene.w}px; height:${scene.h}px; overflow:hidden; background:${bg}; }
  #root { width:${scene.w}px; height:${scene.h}px; }
</style>
</head><body><div id="root"></div>
<script>${js.icons}</script>
<script>${js.logo}</script>
<script>${js.data}</script>
<script>${js.ui}</script>
<script>${js.devices}</script>
${sceneSrc.map((s) => `<script>${s}</script>`).join('\n')}
<script>
  document.getElementById('root').innerHTML = window.SCENES[${JSON.stringify(name)}].html();
</script>
</body></html>`;
}

/* ── Render ────────────────────────────────────────────────────────────── */

await mkdir(HTML, { recursive: true });
await mkdir(OUT, { recursive: true });

// Chrome refuses to reuse a profile that another instance holds; a throwaway
// one per run also keeps the user's real profile untouched.
const profile = path.join(os.tmpdir(), `mkt-chrome-${process.pid}`);

let ok = 0;
const failed = [];

for (const name of names) {
  const scene = registry[name];
  const scale = scene.scale ?? 2;
  const htmlPath = path.join(HTML, `${name}.html`);
  const outPath = path.join(OUT, `${name}.png`);

  await writeFile(htmlPath, page(name, scene), 'utf8');

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-lcd-text',
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${scene.w},${scene.h}`,
    // Advances the clock so webfonts and layout settle before the capture.
    '--virtual-time-budget=4000',
    ...(scene.transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${outPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ];

  try {
    await run(CHROME, args, { timeout: 90_000, windowsHide: true });
    const { size } = await stat(outPath);
    if (size < 5000) throw new Error(`suspiciously small (${size} B)`);
    console.log(`  ✓ ${name}.png  ${scene.w}×${scene.h} @${scale}x  ${(size / 1024).toFixed(0)} KB`);
    ok++;
  } catch (err) {
    console.log(`  ✗ ${name}  — ${err.message.split('\n')[0]}`);
    failed.push(name);
  }
}

await rm(profile, { recursive: true, force: true });

console.log(`\n${ok}/${names.length} rendered → marketing/out/`);
if (failed.length) {
  console.log(`failed: ${failed.join(', ')}`);
  process.exit(1);
}
