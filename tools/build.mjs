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
    loader: { '.webp': 'dataurl', '.png': 'dataurl' },
    logLevel: 'warning',
  });
  let js = r.outputFiles[0].text;
  // Keep the inline script from closing early. "<\/script" means the same thing in strings, regexes and comments.
  js = js.replace(/<\/script/gi, '<\\/script');
  // "<!--" inside an inline script can switch the HTML parser into its script-escape states.
  // React's server renderer emits it from string literals; "\x3C!--" is the same string (and is
  // equally valid in regex and template literals), so escape every occurrence.
  js = js.replace(/<!--/g, '\\x3C!--');
  return js;
}

// Favicon: the logo's emblem at 64 px (made from docs/brand/scrimshaw-emblem.png).
const FAVICON = `data:image/png;base64,${readFileSync(path.join(root, 'src/assets/favicon.png')).toString('base64')}`;

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
