// Builds dist/index.html: one self-contained file (JS, CSS, fonts, favicon inlined) that runs
// from file://, from the PowerShell server, or inside an LMS. Per the TechStack: built
// off-workstation, no CDNs, no runtime network calls.
//
//   node tools/build.mjs            production build
//   node tools/build.mjs --watch    rebuild on change (open dist/index.html in the browser)
//
// Needs esbuild and the Tailwind CSS 4 CLI. The CLI comes from node_modules/.bin/tailwindcss
// (@tailwindcss/cli) or the standalone binary named in TAILWIND_BIN.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const tmp = path.join(root, '.build');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const kitVersion = readFileSync(path.join(root, 'vendor/ui-kit/VERSION'), 'utf8').trim();

function tailwindBin() {
  if (process.env.TAILWIND_BIN) return process.env.TAILWIND_BIN;
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
  if (existsSync(local)) return local;
  throw new Error('Tailwind CSS CLI not found. Run npm install, or set TAILWIND_BIN to the standalone tailwindcss binary.');
}

function buildCss() {
  mkdirSync(tmp, { recursive: true });
  const out = path.join(tmp, 'app.css');
  const r = spawnSync(tailwindBin(), ['-i', 'src/styles.css', '-o', out, '--minify'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`Tailwind failed:\n${r.stderr || r.stdout}`);
  let css = readFileSync(out, 'utf8');
  // Inline the kit's bundled fonts (url(...exo2.woff2) etc.) so the file stands alone.
  css = css.replace(/url\((['"]?)([^)'"]*?([\w-]+\.woff2))\1\)/g, (_m, _q, _p, file) => {
    const font = path.join(root, 'vendor/ui-kit/fonts', file);
    if (!existsSync(font)) throw new Error(`Font ${file} referenced by CSS is missing from vendor/ui-kit/fonts`);
    return `url(data:font/woff2;base64,${readFileSync(font).toString('base64')})`;
  });
  if (/url\((?!data:|#)/.test(css)) console.warn('warning: CSS still references an external url(); it will not load offline.');
  return css;
}

async function buildJs() {
  const r = await build({
    entryPoints: [path.join(root, 'src/main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['chrome109', 'edge109', 'firefox115', 'safari16'],
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"', __SCRIMSHAW_VERSION__: JSON.stringify(pkg.version) },
    logLevel: 'warning',
  });
  let js = r.outputFiles[0].text;
  // Keep the inline script from closing early. "<\/script" means the same thing in strings, regexes and comments.
  js = js.replace(/<\/script/gi, '<\\/script');
  if (js.includes('<!--')) throw new Error('Bundle contains "<!--", which is unsafe inside an inline <script>. Rephrase the source that produces it.');
  return js;
}

const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#2f74c8"/><path d="M9 4c6 1 13 6 15 14 1.4 5.5-1 9.6-5 10-3.7.4-6-2.6-6.6-6.8C11.6 15.7 10.6 9.6 9 4Z" fill="#fff"/><path d="M14.6 13.5c2.2 1.6 3.9 4 4.6 7M13.2 18.6c1.6.9 2.9 2.4 3.5 4.3" stroke="#2f74c8" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M21.5 9.5 25 6" stroke="#e8c15a" stroke-width="1.8" stroke-linecap="round"/></svg>')}`;

function html(css, js) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Scrimshaw ${pkg.version} (FleetHacker UI Kit ${kitVersion})">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob: file: https: http:; media-src 'self' data: blob: file: https: http:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Scrimshaw</title>
<link rel="icon" href="${FAVICON}">
<style>${css}</style>
</head>
<body>
<noscript><p style="padding:24px;font-family:sans-serif">Scrimshaw needs JavaScript.</p></noscript>
<div id="root"></div>
<script data-scrimshaw-bundle>${js}</script>
</body>
</html>
`;
}

async function once() {
  const t0 = Date.now();
  const [css, js] = [buildCss(), await buildJs()];
  mkdirSync(dist, { recursive: true });
  mkdirSync(path.join(dist, 'licenses'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), html(css, js));
  for (const f of ['OFL-Exo2.txt', 'OFL-SyneMono.txt']) copyFileSync(path.join(root, 'vendor/ui-kit/fonts', f), path.join(dist, 'licenses', f));
  writeFileSync(path.join(dist, 'VERSION'), `${pkg.version}\n`);
  const kb = (statSync(path.join(dist, 'index.html')).size / 1024).toFixed(0);
  console.log(`built dist/index.html (${kb} KB) in ${Date.now() - t0} ms`);
}

await once();
if (process.argv.includes('--watch')) {
  let timer = null;
  console.log('watching src/ and vendor/ …');
  for (const dir of ['src', 'vendor']) {
    watch(path.join(root, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => once().catch((e) => console.error(e.message)), 150);
    });
  }
}
