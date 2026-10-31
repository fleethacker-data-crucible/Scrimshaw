import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const start = readFileSync(new URL('../Start.ps1', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test("Scrimshaw's port is its one-port Fleet block, 8775, with no walking and no port 0", () => {
  assert.match(start, /\$FleetPort = 8775\b/);
  assert.ok(!/\b8765\b/.test(start), '8765 is SnapShackle\'s block');
  assert.ok(!/@\([^)]*,\s*0\s*\)/.test(start), 'no port-0 fallback');
  assert.match(readme, /port \*\*8775\*\*/);
});

test('an explicit -Port is used exactly, and the reuse policy goes through the Fleet id and shutdown endpoints', () => {
  assert.match(start, /if \(\$Preferred -gt 0\) \{ throw "Port \$p is not available/);
  for (const needle of ['/__fleethacker/id', '__fleethacker/shutdown', 'X-FleetHacker-Shutdown', "tool -eq 'scrimshaw'", 'Compare-DottedVersion']) assert.ok(start.includes(needle), needle);
  assert.ok(!/[^\x00-\x7f]/.test(start), 'Start.ps1 stays ASCII for Windows PowerShell 5.1');
});
