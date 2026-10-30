// README screenshots of the editor in both Fleet themes (Night watch = dark, Chart room = light).
// Mock data only: each shot opens dist/index.html from file:// in a fresh, empty browser profile and
// continues the sample course from the Welcome view, so the editor shows the starter project a new
// author gets. Nothing is imported or typed in.
//   node tools/screenshots.mjs [--out docs/screenshots]
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const out = path.resolve(root, outArg >= 0 ? process.argv[outArg + 1] : 'docs/screenshots');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: exe });
try {
  for (const [scheme, theme] of [['dark', 'night-watch'], ['light', 'chart-room']]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(url);
    // Scrimshaw opens on the Welcome view; Continue opens the sample course in the editor.
    await page.getByRole('button', { name: /^Continue / }).click();
    await page.getByRole('heading', { name: 'Scrimshaw', level: 1 }).waitFor();
    await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    await page.mouse.move(0, 899);
    await page.waitForTimeout(500);
    const file = path.join(out, `editor-${theme}.png`);
    await page.screenshot({ path: file });
    console.log('wrote ' + file);
    await ctx.close();
  }
} finally {
  await browser.close();
}
