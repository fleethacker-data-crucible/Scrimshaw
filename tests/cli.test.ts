import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { COMMANDS, OUTPUT_SCHEMA, describeCommands, runCli, type CliIo } from '../src/cli/registry.ts';
import { GUI_ACTIONS } from '../src/cli/gui-actions.ts';
import { newCourse, sampleCourse } from '../src/model/factory.ts';
import { serializeCourse } from '../src/model/schema.ts';

// An in-memory file system, so the commands are tested without touching a disk.
function memIo(files: Record<string, string | Uint8Array> = {}) {
  const fs = new Map<string, string | Uint8Array>(Object.entries(files));
  const writes: string[] = [];
  const io: CliIo = {
    readText: (p) => { const v = fs.get(p); if (v === undefined) throw new Error(`ENOENT ${p}`); return typeof v === 'string' ? v : new TextDecoder().decode(v); },
    exists: (p) => fs.has(p),
    writeFile: (p, d) => { fs.set(p, d); writes.push(p); },
  };
  return { io, fs, writes };
}
const SHELL = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"><title>Scrimshaw</title></head><body><div id="root"></div></body></html>';
const fixtures = (): Record<string, string> => ({ 'demo.scrim': serializeCourse(sampleCourse()), 'shell.html': SHELL });
const run = async (argv: string[], files = fixtures()) => { const m = memIo(files); const r = await runCli(argv, m.io); return { ...r, ...m, json: r.stdout.startsWith('{') ? JSON.parse(r.stdout) : null }; };

test('commands --json lists every registered command with its inputs and outputs', async () => {
  const r = await run(['commands', '--json']);
  assert.equal(r.exit, 0);
  assert.equal(r.json.schema, OUTPUT_SCHEMA);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.commands, JSON.parse(JSON.stringify(describeCommands())));
  assert.deepEqual(r.json.commands.map((c: { name: string }) => c.name), COMMANDS.map((c) => c.name));
  for (const c of r.json.commands) {
    assert.match(c.name, /^(commands|[a-z]+ [a-z-]+)$/, `${c.name} is named "<noun> <verb>"`);
    assert.ok(c.summary.length > 10 && Object.keys(c.output).length > 0, `${c.name} says what it does and returns`);
    if (c.writes) for (const flag of ['out', 'yes', 'dry-run']) assert.ok(c.args.some((a: { name: string }) => a.name === flag), `${c.name} takes --${flag}`);
  }
  assert.equal(new Set(COMMANDS.map((c) => c.name)).size, COMMANDS.length, 'names are unique');
});

test('every registered command runs its own example successfully, with --json', async () => {
  for (const c of COMMANDS) {
    const r = await run([...c.name.split(' '), ...c.example, '--json']);
    assert.equal(r.exit, 0, `${c.name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.command, c.name);
    // Every field the registry promises is in the output.
    for (const field of Object.keys(c.output)) if (c.name !== 'course new' || field !== 'title') assert.ok(field in r.json, `${c.name} returns ${field}`);
  }
});

test('parity: every File-menu action is inventoried and every inventory entry is honest', () => {
  const shell = readFileSync(new URL('../src/editor/EditorShell.tsx', import.meta.url), 'utf8');
  const menu = shell.slice(shell.indexOf('<Menu label="File"'), shell.indexOf('File<ChevronDown'));
  const labels = [...menu.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(labels.length >= 8, 'found the File menu');
  const listed = new Set(GUI_ACTIONS.map((a) => a.label));
  for (const l of labels) assert.ok(listed.has(l), `File menu action "${l}" has no entry in src/cli/gui-actions.ts`);
  const names = new Set(COMMANDS.map((c) => c.name));
  for (const a of GUI_ACTIONS) {
    if (a.command) assert.ok(names.has(a.command), `"${a.label}" points at unknown command "${a.command}"`);
    else assert.ok(a.gap && a.gap.length > 20, `"${a.label}" has no command and no stated gap`);
  }
  const used = new Set(GUI_ACTIONS.map((a) => a.command));
  for (const n of names) if (n !== 'commands') assert.ok(used.has(n), `command "${n}" mirrors no GUI action; list it in gui-actions.ts`);
  const publish = readFileSync(new URL('../src/editor/Dialogs.tsx', import.meta.url), 'utf8');
  for (const kind of ['html', 'scorm', 'scorm2004', 'xapi', 'cmi5', 'json']) assert.ok(publish.includes(`run('${kind}')`), `Publish dialog still has ${kind}; update gui-actions.ts if it changed`);
});

test('course new, info and validate', async () => {
  const made = await run(['course', 'new', '--title', 'Demo', '--out', 'a.scrim', '--json'], {});
  assert.equal(made.json.written, true);
  assert.ok(made.fs.has('a.scrim'));
  const bytes = made.fs.get('a.scrim') as string;
  assert.ok(!bytes.startsWith('﻿'), 'no BOM');
  assert.equal(JSON.parse(bytes).course.title, 'Demo');
  const info = await run(['course', 'info', 'demo.scrim', '--json']);
  assert.equal(info.json.title, sampleCourse().title);
  assert.ok(info.json.slides > 3 && info.json.questions >= 1);
  assert.equal((await run(['course', 'validate', 'demo.scrim', '--json'])).json.valid, true);
  // A trigger that points at a slide that is gone is the problem the Publish dialog reports.
  const c = sampleCourse();
  c.scenes[0].slides[0].layers[0].objects[0].triggers.push({ id: 'x', event: { type: 'click' }, action: { type: 'jump-slide', slideId: 'gone' }, conditions: [], conditionMode: 'all' } as never);
  const bad = await run(['course', 'validate', 'bad.scrim', '--json'], { 'bad.scrim': serializeCourse(c) });
  assert.equal(bad.exit, 2);
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.valid, false);
  assert.match(bad.json.problems[0], /no longer exists/);
});

test('files are never replaced without --yes, and --dry-run writes nothing', async () => {
  const files = { ...fixtures(), 'out.csv': 'old' };
  const refused = await run(['course', 'export-texts', 'demo.scrim', '--out', 'out.csv', '--json'], files);
  assert.equal(refused.exit, 1);
  assert.equal(refused.json.error.code, 'exists');
  assert.equal(refused.fs.get('out.csv'), 'old');
  const dry = await run(['course', 'export-texts', 'demo.scrim', '--out', 'out.csv', '--dry-run', '--json'], files);
  assert.equal(dry.json.written, false);
  assert.ok(dry.json.bytes > 20);
  assert.equal(dry.writes.length, 0);
  const yes = await run(['course', 'export-texts', 'demo.scrim', '--out', 'out.csv', '--yes', '--json'], files);
  assert.equal(yes.exit, 0);
  assert.notEqual(yes.fs.get('out.csv'), 'old');
});

test('publish builds a player and the LMS packages from the built shell', async () => {
  const html = await run(['course', 'publish', 'demo.scrim', '--format', 'html', '--out', 'p.html', '--shell', 'shell.html', '--json']);
  assert.equal(html.exit, 0);
  const page = html.fs.get('p.html') as string;
  assert.ok(page.includes('id="scrimshaw-course"') && page.includes(sampleCourse().title));
  for (const format of ['scorm12', 'scorm2004', 'xapi', 'cmi5']) {
    const r = await run(['course', 'publish', 'demo.scrim', '--format', format, '--out', 'p.zip', '--shell', 'shell.html', '--json']);
    assert.equal(r.exit, 0, `${format}: ${r.stdout}`);
    const zip = r.fs.get('p.zip') as Uint8Array;
    assert.equal(String.fromCharCode(zip[0], zip[1]), 'PK', `${format} is a zip`);
  }
  const noShell = await run(['course', 'publish', 'demo.scrim', '--format', 'html', '--out', 'p.html', '--shell', 'missing.html', '--json']);
  assert.equal(noShell.json.error.code, 'no-shell');
});

test('errors are named, with exit codes: usage 64, not found 1, bad course 1', async () => {
  const code = async (argv: string[]) => { const r = await run([...argv, '--json']); return [r.exit, r.json.error.code]; };
  assert.deepEqual(await code(['nonsense']), [64, 'usage']);
  assert.deepEqual(await code(['course', 'info']), [64, 'usage']);
  assert.deepEqual(await code(['course', 'info', 'demo.scrim', '--bogus']), [64, 'usage']);
  assert.deepEqual(await code(['course', 'publish', 'demo.scrim', '--format', 'pdf', '--out', 'x']), [64, 'usage']);
  assert.deepEqual(await code(['course', 'info', 'missing.scrim']), [1, 'not-found']);
  const notCourse = await run(['course', 'info', 'junk.scrim', '--json'], { 'junk.scrim': '{"hello":1}' });
  assert.deepEqual([notCourse.exit, notCourse.json.error.code], [1, 'bad-course']);
  const plain = await run(['course', 'info', 'missing.scrim']);
  assert.match(plain.stderr, /^scrimshaw: File not found/);
});

test('the real tool prints the same registry', () => {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', 'tools/scrimshaw.mjs', 'commands', '--json'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_NO_WARNINGS: '1' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out).commands, JSON.parse(JSON.stringify(describeCommands())));
  assert.ok(newCourse('x'));
});
