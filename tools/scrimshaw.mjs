#!/usr/bin/env node
// scrimshaw CLI: a thin runner over src/cli/registry.ts (same commands as the GUI, see docs in ROADMAP.md).
// Needs Node 22.18+ (it runs the TypeScript source directly). Try: node tools/scrimshaw.mjs commands --json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runCli } from '../src/cli/registry.ts';

const io = {
  readText: (p) => readFileSync(p, 'utf8').replace(/^\ufeff/, ''),
  exists: (p) => existsSync(p),
  // Strings are written as UTF-8 without a BOM (a '>' redirect in Windows PowerShell 5.1 would write UTF-16).
  writeFile: (p, data) => writeFileSync(p, data),
};
const r = await runCli(process.argv.slice(2), io);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.exit;
