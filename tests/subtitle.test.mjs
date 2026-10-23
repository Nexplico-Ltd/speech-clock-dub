import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSubtitle } from './helpers/load-background.mjs';

const SUB = loadSubtitle();
const plain = (x) => JSON.parse(JSON.stringify(x));
// A text "fits" when it is at most `n` characters: a stand-in for "at most 2 lines".
const fitsChars = (n) => (t) => t.length <= n;

test('a text that fits stays on one page', () => {
  assert.deepEqual(plain(SUB.paginate('short text', fitsChars(40))), ['short text']);
});

test('a long text is split into pages that each fit, without losing any word', () => {
  const text = 'the quick brown fox jumps over the lazy dog and then runs far away from the barking farm dog';
  const pages = plain(SUB.paginate(text, fitsChars(30)));
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.ok(p.length <= 30, `"${p}" is too long`);
  assert.equal(pages.join(' '), text);
});

test('pages break after punctuation when that keeps at least half of the page', () => {
  const pages = plain(SUB.paginate('First part of it, and then the second part of it goes on', fitsChars(32)));
  assert.equal(pages[0], 'First part of it,');
  assert.equal(pages.join(' '), 'First part of it, and then the second part of it goes on');
});

test('Japanese and Chinese text (no spaces) is paginated too', () => {
  const text = '今日は勾配降下法についてお話しします。これは、ほぼすべてのニューラルネットワークを支える基本的な手法です。';
  const pages = plain(SUB.paginate(text, fitsChars(24)));
  assert.ok(pages.length >= 2);
  for (const p of pages) assert.ok(p.length <= 24, `"${p}" is too long`);
  assert.equal(pages.join(''), text);
  assert.equal(pages[0], '今日は勾配降下法についてお話しします。', 'breaks at the sentence end');
});

test('a single unit longer than the limit does not loop forever', () => {
  const pages = plain(SUB.paginate('supercalifragilisticexpialidocious yes', fitsChars(10)));
  assert.equal(pages.join(' '), 'supercalifragilisticexpialidocious yes');
});

test('pageAt follows the progress of the speech in proportion to page lengths', () => {
  const pages = ['aaaa', 'bbbb', 'cccccccc']; // 4 + 4 + 8 = 16
  assert.equal(SUB.pageAt(pages, 0), 0);
  assert.equal(SUB.pageAt(pages, 0.24), 0);
  assert.equal(SUB.pageAt(pages, 0.26), 1);
  assert.equal(SUB.pageAt(pages, 0.49), 1);
  assert.equal(SUB.pageAt(pages, 0.51), 2);
  assert.equal(SUB.pageAt(pages, 1), 2, 'the last page stays at the end');
  assert.equal(SUB.pageAt(['only'], 0.7), 0);
});
