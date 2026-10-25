import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, hasMarkup } from '../src/render/markup.ts';

test('inline formatting parses nested runs and safe links only', () => {
  assert.deepEqual(parseInline('a **b *c* d** e'), [
    { t: 'text', v: 'a ' },
    { t: 'b', c: [{ t: 'text', v: 'b ' }, { t: 'i', c: [{ t: 'text', v: 'c' }] }, { t: 'text', v: ' d' }] },
    { t: 'text', v: ' e' },
  ]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ t: 'text', v: '2 * 3 * 4' }], 'spaced asterisks stay literal');
  assert.deepEqual(parseInline('[site](https://x.org)'), [{ t: 'a', href: 'https://x.org', c: [{ t: 'text', v: 'site' }] }]);
  assert.deepEqual(parseInline('[bad](javascript:alert(1))'), [{ t: 'text', v: '[bad](javascript:alert(1))' }]);
  assert.deepEqual(parseInline('\\*not italic\\*'), [{ t: 'text', v: '*not italic*' }]);
  assert.deepEqual(parseInline('__u__ ~~s~~'), [{ t: 'u', c: [{ t: 'text', v: 'u' }] }, { t: 'text', v: ' ' }, { t: 's', c: [{ t: 'text', v: 's' }] }]);
  assert.equal(hasMarkup('Plain 50% text'), false);
  assert.equal(hasMarkup('- item'), true);
});
