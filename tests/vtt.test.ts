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

test('cue tags come out as plain text, including an unclosed script tag', () => {
  const cue = (body: string) => parseVtt(`WEBVTT\n\n00:00.000 --> 00:01.000\n${body}\n`)[0]?.text;
  assert.equal(cue('<i>Hello</i> <b>there</b>'), 'Hello there');
  assert.equal(cue('<v.loud Narrator>See <00:00.500>this'), 'See this');
  assert.equal(cue('if x < y'), 'if x < y');
  assert.equal(cue('if x < y and z > 0'), 'if x  0', 'a < through the next > is still one tag');
  assert.equal(cue('hello <script'), 'hello');
  assert.equal(cue('hello <SCRIPT'), 'hello');
  assert.equal(cue('hello <style'), 'hello');
  assert.equal(cue('hello <iframe'), 'hello');
  assert.equal(cue('hello <script>alert(1)</script>'), 'hello alert(1)');
  assert.equal(cue('<scr<script>ipt>'), 'ipt>');
  assert.equal(cue('prefix <script suffix')?.includes('<script'), false);
});

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
