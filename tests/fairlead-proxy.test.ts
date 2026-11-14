import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const proxyPath = fileURLToPath(new URL('../actions/FairleadProxy.ps1', import.meta.url));
const testPath = fileURLToPath(new URL('./FairleadProxy.Tests.ps1', import.meta.url));

function powershellExe(): string {
  if (process.env.PWSH && existsSync(process.env.PWSH)) return process.env.PWSH;
  if (process.platform === 'win32') return 'powershell.exe';
  const home = process.env.HOME ? `${process.env.HOME}/pwsh/pwsh` : '';
  if (home && existsSync(home)) return home;
  return 'pwsh';
}

test('the proxy script keeps the key off the page and only calls loopback Fairlead', () => {
  const text = readFileSync(proxyPath, 'utf8');
  for (const needle of [
    'Fairlead/Scrimshaw',
    'local-token',
    'FAIRLEAD_LOCAL_TOKEN',
    'X-Fairlead-Label',
    'Scrimshaw',
    'Start-FleetService',
    '/__fleethacker/id',
    'AllowAutoRedirect = $false',
    'New-Object System.Net.WebProxy',
  ]) assert.ok(text.includes(needle), needle);
  assert.ok(!/[^\x00-\x7f]/.test(text), 'FairleadProxy.ps1 is ASCII');
  assert.ok(!/fl-[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,}/.test(text), 'no key is written in the proxy script');
});

test('the PowerShell proxy rules pass', () => {
  const exe = powershellExe();
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', testPath], {
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/fl-test-synthetic|fl-from-cred|fl-from-file|fl-from-utf8/g, '[redacted]');
  assert.equal(r.error, undefined, out);
  assert.equal(r.status, 0, out);
  assert.match(r.stdout || '', /Fairlead proxy tests passed/);
});
