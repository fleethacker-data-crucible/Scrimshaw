// Focused author-flow regression, also called from the full editor e2e suite.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export async function verifySaveRecovery(browser, url) {
  for (const failure of ['QuotaExceededError', 'UnknownError']) {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.goto(url);
      await page.getByRole('button', { name: /^Continue / }).click();
      await page.getByText('Saved', { exact: true }).waitFor();
      await page.evaluate((failure) => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (window.failSyntheticSave) throw new DOMException('Synthetic save failure', failure);
          return put.apply(this, args);
        };
        window.failSyntheticSave = true;
      }, failure);
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /Not saved:/ }).waitFor();
      const guarded = await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(guarded, true, `${failure}: failed saves must retain the leave warning`);
      await page.getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New course', exact: true }).click();
      const leave = page.getByRole('dialog', { name: 'Leave this unsaved course?' });
      await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Save to file', exact: true }).isVisible(), true);
      const out = fileURLToPath(new URL('../.build/e2e/', import.meta.url));
      mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, `save-recovery-${failure}.png`) });
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save to file', exact: true }).click();
      assert.match((await download).suggestedFilename(), /\.scrim$/);
      assert.equal(await page.getByRole('button', { name: 'Save to file', exact: true }).isVisible(), true,
        'Starting a download must not pretend browser storage recovered');
      // Keyboard Save must not announce success while persistence is still failing.
      await page.keyboard.press('Control+s');
      await page.getByRole('status').filter({ hasText: /Not saved:/ }).waitFor();
      assert.equal(await page.getByText('Saved in this browser.', { exact: true }).count(), 0);
      // A real successful retry clears protection for this revision.
      await page.evaluate(() => { window.failSyntheticSave = false; });
      await page.keyboard.press('Control+s');
      await page.getByText('Saved', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }), false, 'A completed successful save clears the leave warning');
      console.log(`  ok - ${failure}: recovery download, leave guard, failed retry and successful retry`);
    } finally { await context.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try { await verifySaveRecovery(browser, pathToFileURL(path.join(root, 'dist/index.html')).href); }
  finally { await browser.close(); }
}
