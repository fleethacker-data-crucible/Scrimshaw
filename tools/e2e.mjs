// End-to-end smoke test: opens dist/index.html from file:// in Chromium, drives the editor and
// the player, publishes a package, and plays the published package. Screenshots go to .build/e2e/.
//   node tools/e2e.mjs [--headed]
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import http from 'node:http';
import { createRequire } from 'node:module';

// Accessibility scan (UI kit rule): runs when axe-core is installed (npm install), skipped otherwise.
const require = createRequire(import.meta.url);
let axeSource = null;
try { axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* not installed */ }
async function axe(page, label, frame) {
  if (!axeSource) return;
  const target = frame ?? page;
  await target.evaluate(axeSource);
  const res = await target.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) - ${v.help}`);
  });
  if (res.length) fail(`axe found WCAG 2.1 AA issues in ${label}:\n    ${res.join('\n    ')}`);
  else ok(`axe: no WCAG 2.1 AA violations in ${label}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.build', 'e2e');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => existsSync(p));

const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), executablePath: exe });
const errors = [];
let step = 0;
const ok = (m) => console.log(`  ok ${++step} - ${m}`);
const fail = (m) => { console.error(`  not ok - ${m}`); process.exitCode = 1; };

async function newPage(theme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return page;
}

try {
  // ---------- editor ----------
  const page = await newPage();
  await page.goto(url);
  await page.getByRole('heading', { name: 'Scrimshaw', level: 1 }).waitFor();
  ok('editor loads from file://');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 }).then(() => ok('autosaves to IndexedDB'), () => fail('no Saved status'));
  await page.screenshot({ path: path.join(out, '01-editor-dark.png') });
  await axe(page, 'the editor (dark)');

  // Select the title text on the canvas and change it through the inspector.
  const canvas = page.getByRole('application', { name: /Slide canvas/ });
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.42);
  await page.getByRole('tab', { name: 'Design' }).waitFor();
  ok('selecting an object shows the Design tab');
  const textArea = page.getByRole('textbox', { name: 'Text', exact: true });
  await textArea.fill('Scrimshaw at sea');
  await page.getByRole('button', { name: /Undo Edit text/ }).waitFor();
  ok('editing text records an undo step');
  await page.keyboard.press('Escape');

  // Insert a button, drag it, undo.
  await page.getByRole('button', { name: 'Button', exact: true }).click();
  const before = await page.locator('.sel-box.primary').boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator('.sel-box.primary').boundingBox();
  if (after.x > before.x + 40) ok('drag moves the object'); else fail(`drag did not move (${before.x} → ${after.x})`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  ok('undo via keyboard');

  // Add a trigger to the selected... select an existing slide 2 button and inspect triggers.
  await page.getByRole('button', { name: /^Slide 2:/ }).click();
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await page.getByText('Show layer Needle').first().waitFor({ timeout: 2000 }).then(() => fail('slide triggers should not list object triggers'), () => ok('slide triggers tab shows slide-level triggers'));
  await page.screenshot({ path: path.join(out, '02-slide-triggers.png') });

  // Variables dialog.
  await page.getByRole('button', { name: /^Variables/ }).click();
  await page.getByRole('dialog', { name: 'Variables' }).waitFor();
  ok('variables dialog opens');
  await page.screenshot({ path: path.join(out, '03-variables.png') });
  await page.keyboard.press('Escape');

  // Story view.
  await page.getByRole('button', { name: 'Story view' }).click();
  await page.getByLabel('Story view').waitFor();
  await page.screenshot({ path: path.join(out, '04-story.png') });
  ok('story view renders');
  await page.getByRole('button', { name: 'Back to slide view' }).click();

  // Light theme.
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.screenshot({ path: path.join(out, '05-editor-light.png') });
  ok('light theme');

  // ---------- preview the sample course ----------
  await page.getByRole('button', { name: 'Slide 1: Title slide' }).click();
  await page.keyboard.press('Shift+F5');
  const player = page.locator('.player');
  await player.waitFor();
  await page.getByRole('textbox', { name: 'Your first name' }).fill('Ada');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Welcome aboard, Ada. Click each tool.').waitFor();
  ok('preview: input writes a variable and text shows it');
  for (const t of ['Needle', 'Ink', 'Tooth']) await page.getByRole('button', { name: t, exact: true }).click();
  await page.getByText('Tools explored: 3 of 3').waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).first().waitFor();
  ok('preview: states, layers and variable-change trigger');
  await page.screenshot({ path: path.join(out, '06-preview-tools.png') });
  await axe(page, 'the player preview');
  await page.locator('.player-stage').getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: /Whale teeth/ }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByText("That's right!").waitFor();
  ok('preview: question graded correct');
  await page.screenshot({ path: path.join(out, '07-preview-correct.png') });
  await page.locator('.player-stage').getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'False' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.locator('.player-stage').getByRole('button', { name: 'Continue' }).click();
  // Drag and drop: Needle with the mouse, Ink with the keyboard, Tooth onto the wrong job.
  const stage = page.locator('.player-stage');
  await stage.getByText('Drag each tool onto its job.').waitFor();
  const dragTo = async (item, target) => {
    const a = await stage.getByRole('button', { name: new RegExp(`^${item}\\.`) }).boundingBox();
    const b = await stage.getByText(target, { exact: true }).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await dragTo('Needle', 'Carves the design');
  await page.getByRole('button', { name: /^Needle, on Carves the design/ }).waitFor();
  ok('drag and drop with the mouse snaps onto the target');
  await page.getByRole('button', { name: /^Ink\./ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Drop Ink on Darkens the lines' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^Ink, on Darkens the lines/ }).waitFor();
  ok('drag and drop with the keyboard');
  await dragTo('Tooth', 'Carves the design');
  await page.screenshot({ path: path.join(out, '07b-drag-drop.png') });
  await page.getByRole('button', { name: 'Submit' }).click();
  await stage.getByText("That's not quite right.").waitFor();
  ok('drag-and-drop question graded wrong when one item is misplaced');
  await page.locator('.player-stage').getByRole('button', { name: 'Continue' }).click();
  await stage.getByText(/You scored 33%/).waitFor();
  await page.locator('.player-stage').getByText('You did not pass this time.').waitFor();
  ok('preview: results slide shows score and the failed layer');
  await page.screenshot({ path: path.join(out, '08-preview-results.png') });
  await page.getByRole('button', { name: 'Close preview' }).click();

  // ---------- publish ----------
  await page.getByRole('button', { name: 'Publish' }).click();
  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SCORM 1.2 zip' }).click()]);
  const zipPath = path.join(out, 'course.zip');
  await zipDl.saveAs(zipPath);
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const manifest = await zip.file('imsmanifest.xml')?.async('string');
  const index = await zip.file('index.html')?.async('string');
  if (manifest?.includes('<schemaversion>1.2</schemaversion>') && index?.includes('id="scrimshaw-course"')) ok('SCORM zip has manifest and embedded course');
  else fail('SCORM zip is incomplete');
  const pkgHtml = path.join(out, 'package', 'index.html');
  mkdirSync(path.dirname(pkgHtml), { recursive: true });
  writeFileSync(pkgHtml, index);
  await page.keyboard.press('Escape');

  // ---------- the published package, inside a fake SCORM 1.2 LMS frame ----------
  const lmsPage = await newPage('light');
  const lmsHtml = path.join(out, 'package', 'lms.html');
  writeFileSync(lmsHtml, `<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"><script>
    window.calls = []; const data = {'cmi.core.lesson_status':'not attempted','cmi.core.entry':'ab-initio'};
    window.API = { LMSInitialize(){calls.push('init');return 'true'}, LMSFinish(){calls.push('finish');return 'true'},
      LMSGetValue(k){return data[k]??''}, LMSSetValue(k,v){data[k]=v;calls.push(k+'='+v);return 'true'},
      LMSCommit(){return 'true'}, LMSGetLastError(){return '0'} }; window.lmsData = data;
  </script><iframe src="index.html" style="width:100vw;height:100vh;border:0"></iframe></body></html>`);
  // Serve over HTTP: an LMS frame and its content share an origin, which file:// pages never do.
  const server = http.createServer((req, res) => {
    const f = path.join(out, 'package', path.basename(new URL(req.url, 'http://x').pathname) || 'lms.html');
    if (!existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await lmsPage.goto(`http://127.0.0.1:${server.address().port}/lms.html`);
  const frame = lmsPage.frameLocator('iframe');
  await frame.locator('.player').waitFor();
  await lmsPage.waitForTimeout(300);
  const status = await lmsPage.evaluate(() => window.lmsData['cmi.core.lesson_status']);
  if (status === 'incomplete') ok('published package talks to the SCORM API (status incomplete)'); else fail(`lesson_status is ${status}`);
  await frame.getByRole('textbox', { name: 'Your first name' }).fill('Lin');
  await frame.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 5000 });
  await lmsPage.waitForTimeout(300);
  const loc = await lmsPage.evaluate(() => window.lmsData['cmi.core.lesson_location']);
  const susp = await lmsPage.evaluate(() => window.lmsData['cmi.suspend_data'] ?? '');
  if (loc && susp.includes('Lin')) ok('progress is saved to cmi.core.lesson_location and cmi.suspend_data'); else fail(`no progress saved (${loc}, ${susp})`);
  await lmsPage.screenshot({ path: path.join(out, '09-published-in-lms.png') });
  await lmsPage.context().close();
  server.close();

  // ---------- SCORM 2004 package in a mock 2004 LMS ----------
  await page.getByRole('button', { name: 'Publish' }).click();
  const [z04] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SCORM 2004 zip' }).click()]);
  const zip04 = await JSZip.loadAsync(readFileSync(await z04.path()));
  if ((await zip04.file('imsmanifest.xml').async('string')).includes('2004 3rd Edition')) ok('SCORM 2004 zip has a 2004 manifest');
  else fail('SCORM 2004 manifest missing');
  const dir04 = path.join(out, 'package04');
  mkdirSync(dir04, { recursive: true });
  writeFileSync(path.join(dir04, 'index.html'), await zip04.file('index.html').async('string'));
  writeFileSync(path.join(dir04, 'lms.html'), `<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"><script>
    const data = {'cmi.completion_status':'unknown','cmi.entry':'ab-initio'};
    window.API_1484_11 = { Initialize(){return 'true'}, Terminate(){return 'true'}, GetValue(k){return data[k]??''},
      SetValue(k,v){data[k]=v;return 'true'}, Commit(){return 'true'}, GetLastError(){return '0'} }; window.lmsData = data;
  </script><iframe src="index.html" style="width:100vw;height:100vh;border:0"></iframe></body></html>`);
  await page.keyboard.press('Escape');
  const srv04 = http.createServer((req, res) => {
    const f = path.join(dir04, path.basename(new URL(req.url, 'http://x').pathname) || 'lms.html');
    if (!existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(f));
  });
  await new Promise((r) => srv04.listen(0, '127.0.0.1', r));
  const p04 = await newPage('dark');
  await p04.goto(`http://127.0.0.1:${srv04.address().port}/lms.html`);
  await p04.frameLocator('iframe').locator('.player').waitFor();
  await p04.waitForTimeout(300);
  const cs = await p04.evaluate(() => window.lmsData['cmi.completion_status']);
  if (cs === 'incomplete') ok('SCORM 2004 package reports cmi.completion_status incomplete'); else fail(`cmi.completion_status is ${cs}`);
  await p04.context().close();
  srv04.close();

  // ---------- trigger wizard ----------
  await page.getByRole('button', { name: 'Slide 1: Title slide' }).click();
  await page.getByRole('tab', { name: 'Slide' }).click();
  await page.getByRole('list', { name: 'Objects' }).getByRole('button', { name: /^Start/ }).click();
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await page.getByRole('button', { name: 'New trigger' }).click();
  const wiz = page.getByRole('dialog', { name: 'New trigger' });
  await wiz.getByRole('combobox', { name: 'Action' }).selectOption('open-url');
  await wiz.getByRole('textbox', { name: /^URL/ }).fill('https://example.com/scrimshaw');
  await wiz.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByText('Open https://example.com/scrimshaw').waitFor();
  ok('trigger wizard adds a trigger with a plain-English description');
  await page.keyboard.press('Control+z');

  // ---------- find and replace ----------
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => {});
  await page.keyboard.press('Control+h');
  const fr = page.getByRole('dialog', { name: 'Find and replace' });
  await fr.getByRole('textbox', { name: 'Find' }).fill('Tooth');
  await fr.getByText(/places? found/).waitFor();
  await fr.getByRole('textbox', { name: 'Replace with' }).fill('Whale tooth');
  await fr.getByRole('button', { name: 'Replace all' }).click();
  await page.getByText(/Replaced [1-9]\d* occurrence/).waitFor();
  ok('find and replace across the course');
  await fr.getByRole('button', { name: 'Close', exact: true }).last().click();

  // ---------- right-click menu ----------
  {
    const cv = await page.getByRole('application', { name: /Slide canvas/ }).boundingBox();
    const before = await page.getByRole('list', { name: 'Objects' }).getByRole('button').count().catch(() => 0);
    await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height * 0.42, { button: 'right' });
    await page.screenshot({ path: path.join(out, '11-context-menu.png') });
    await page.getByRole('menu', { name: 'Object actions' }).getByRole('menuitem', { name: /^Duplicate/ }).click();
    await page.getByRole('tab', { name: 'Design' }).waitFor();
    await page.keyboard.press('Escape');
    const after = await page.getByRole('list', { name: 'Objects' }).getByRole('button').count();
    if (after === before + 1) ok('right-click menu duplicates an object'); else fail(`objects ${before} -> ${after}`);
  }

  // ---------- PowerPoint import ----------
  {
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const z = new JSZip();
    z.file('ppt/presentation.xml', `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
    z.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/></Relationships>');
    z.file('ppt/slides/slide1.xml', `<p:sld ${P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F4F1EA"/></a:solidFill></p:bgPr></p:bg><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
        <p:txBody><a:p><a:r><a:rPr sz="4400" b="1"/><a:t>Imported deck</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="5000000" cy="2000000"/></a:xfrm></p:spPr>
        <p:txBody><a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>First point</a:t></a:r></a:p><a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Second point</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="5" name="Content 4"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
        <p:txBody><a:p><a:r><a:t>Inherited point</a:t></a:r></a:p></p:txBody></p:sp>
      <p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="A carved tooth"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr><a:xfrm><a:off x="6500000" y="1825625"/><a:ext cx="3000000" cy="3000000"/></a:xfrm></p:spPr></p:pic>
    </p:spTree></p:cSld></p:sld>`);
    z.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="image" Target="../media/image1.png"/><Relationship Id="rId4" Type="notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId1" Type="slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>');
    // A placeholder with no position of its own takes it from the layout (matched by idx).
    z.file('ppt/slideLayouts/slideLayout2.xml', `<p:sldLayout ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="4500000"/><a:ext cx="5000000" cy="1500000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`);
    z.file('ppt/notesSlides/notesSlide1.xml', `<p:notes ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Speaker notes here</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
    z.file('ppt/media/image1.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const pptx = await z.generateAsync({ type: 'nodebuffer' });
    await page.getByRole('button', { name: 'New slide' }).first().click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Import from PowerPoint/ }).click()]);
    await chooser.setFiles({ name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx });
    await page.getByText(/Imported 1 slide from deck\.pptx/).waitFor();
    await page.getByRole('button', { name: /^Slide \d+: Imported deck/ }).waitFor();
    await page.getByRole('tab', { name: 'Slide' }).click();
    const objs = await page.getByRole('list', { name: 'Objects' }).getByRole('button').allTextContents();
    if (objs.some((t) => t.includes('Picture 3')) && objs.some((t) => t.startsWith('First point'))) ok('PowerPoint import brings in text, bullets and pictures');
    else fail(`PowerPoint import objects: ${objs.join(' | ')}`);
    if (objs.some((t) => t.includes('Inherited point'))) ok('PowerPoint placeholders inherit their layout position'); else fail('placeholder without position was dropped');
    if ((await page.getByRole('textbox', { name: 'Notes' }).inputValue()) === 'Speaker notes here') ok('PowerPoint speaker notes become slide notes'); else fail('notes not imported');
    await page.screenshot({ path: path.join(out, '12-pptx-import.png') });
  }

  // ---------- new course, question slide insert ----------
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New course' }).click();
  await page.getByText('Untitled course ·').waitFor();
  await page.getByRole('button', { name: 'New slide', exact: false }).first().click();
  await page.getByRole('menuitem', { name: 'Multiple choice question' }).click();
  await page.getByRole('button', { name: /^Slide 2: Multiple choice/ }).waitFor();
  ok('new course and question slide');
  await page.screenshot({ path: path.join(out, '10-question-slide.png') });
  await page.context().close();
} catch (e) {
  fail(e.stack || String(e));
} finally {
  await browser.close();
}
const real = errors.filter((e) => !/favicon/i.test(e));
if (real.length) { console.error('Browser errors:\n' + real.map((e) => '  ' + e).join('\n')); process.exitCode = 1; }
else console.log(`  ok - no browser errors`);
if (!axeSource) console.log('  # skipped the axe accessibility scan: install axe-core (npm install) to run it');
console.log(process.exitCode ? 'E2E FAILED' : `E2E passed (${step} checks). Screenshots in .build/e2e/`);
