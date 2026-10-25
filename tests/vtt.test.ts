import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueAt, parseVtt, vttFromDataUrl, vttToDataUrl } from '../src/render/vtt.ts';

const VTT = `WEBVTT

1
00:00:00.500 --> 00:00:02.000
<v Narrator>Welcome aboard.

00:02.000 --> 00:04,250 align:center
Scrimshaw is a sailor's craft.
Second line.
`;

test('WebVTT parsing, cue lookup and data URL round-trip', () => {
  const cues = parseVtt(VTT);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0.5, end: 2, text: 'Welcome aboard.' });
  assert.equal(cues[1].end, 4.25);
  assert.equal(cueAt(cues, 3), "Scrimshaw is a sailor's craft.\nSecond line.");
  assert.equal(cueAt(cues, 5), '');
  assert.deepEqual(parseVtt('not vtt'), []);
  const url = vttToDataUrl('WEBVTT\n\n00:00.000 --> 00:01.000\nÜber café\n');
  assert.ok(url.startsWith('data:text/vtt;base64,'));
  assert.equal(parseVtt(vttFromDataUrl(url)!)[0].text, 'Über café');
  assert.equal(vttFromDataUrl('data:image/png;base64,AA'), null);
});
