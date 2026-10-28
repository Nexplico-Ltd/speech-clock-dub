import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAsr } from './helpers/load-background.mjs';

const ASR = loadAsr();
// Objects built inside the vm have another realm's prototypes; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
const mk = (texts, step = 0.4) => texts.map((text, i) => ({ start: i * step, end: i * step + 0.3, text }));

test('words flattens ASR events, drops repeats and caps word ends', () => {
  const events = [
    { tStartMs: 0, dDurationMs: 9000 }, // window header without segs
    { tStartMs: 1000, segs: [{ utf8: 'hi' }, { utf8: ' everyone', tOffsetMs: 300 }, { utf8: ' welcome', tOffsetMs: 900 }] },
    { tStartMs: 3000, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 1300, segs: [{ utf8: 'everyone' }] }, // an earlier word repeated
    { tStartMs: 4000, segs: [{ utf8: 'to' }, { utf8: ' class', tOffsetMs: 400 }] },
  ];
  const got = plain(ASR.words(events));
  assert.deepEqual(got.map((w) => w.text), ['hi', 'everyone', 'welcome', 'to', 'class']);
  assert.deepEqual(got.map((w) => w.start), [1, 1.3, 1.9, 4, 4.4]);
  assert.deepEqual(got.map((w) => +w.end.toFixed(2)), [1.3, 1.9, 2.7, 4.4, 5.2]); // next start, or start + 0.8
});

test('windows overlap and their trusted parts tile the whole text exactly once', () => {
  assert.deepEqual(plain(ASR.windows(10, 120, 108)), [{ from: 0, to: 10 }]);
  for (const n of [121, 200, 300, 1000, 5526]) {
    const wins = ASR.windows(n, 120, 108);
    const seen = new Array(n).fill(0);
    wins.forEach((win, k) => {
      assert.ok(win.to - win.from <= 120);
      const { lo, hi } = ASR.trusted(win, k, wins.length, 6);
      for (let i = lo; i < hi; i++) seen[i]++;
    });
    assert.ok(seen.every((c) => c === 1), `n=${n}: every word trusted from exactly one window`);
    assert.equal(wins.at(-1).to, n);
  }
});

test('align reads sentence ends and clause pauses from the punctuated text', () => {
  const flags = plain(ASR.align(['hi', 'everyone', 'welcome', 'to', 'the', 'course'], 'Hi everyone, welcome to the course.'));
  assert.deepEqual(flags.map((f) => f.end), [false, false, false, false, false, true]);
  assert.deepEqual(flags.map((f) => f.clause), [false, true, false, false, false, false]);
});

test('align copes with quotes, lone dashes and a dropped word', () => {
  const quoted = plain(ASR.align(['he', 'said', 'stop', 'then', 'left'], 'He said "stop." Then - he left.'));
  assert.equal(quoted[2].end, true, 'a closing quote after the period still ends the sentence');
  assert.equal(quoted[4].end, true);

  const words = Array.from({ length: 40 }, (_, i) => `w${i}`);
  const dropped = words.filter((w) => w !== 'w7');
  assert.notEqual(ASR.align(words, dropped.join(' ') + '.'), null, 'one dropped word is tolerated');
});

test('align rejects an answer that changed too many words', () => {
  const words = Array.from({ length: 40 }, (_, i) => `w${i}`);
  assert.equal(ASR.align(words, 'Something else entirely, with no relation.'), null);
  assert.equal(ASR.align(words, words.slice(0, 10).join(' ')), null, 'a truncated answer');
});

const opts = { maxGapSec: 1.5, maxCueChars: 30 };
const noFlags = (n) => new Array(n).fill(null);

test('cues are cut at sentence ends', () => {
  const words = mk(['so', 'we', 'start', 'now', 'first', 'the', 'basics']);
  const flags = noFlags(7);
  flags[3] = { end: true, clause: false };
  const out = plain(ASR.cues(words, flags, opts));
  assert.deepEqual(out.map((c) => c.text), ['so we start now', 'first the basics']);
  assert.equal(out[0].start, 0);
  assert.equal(out[1].end, words[6].end);
});

test('an over-long sentence is cut at its last clause boundary', () => {
  const words = mk(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
  const flags = noFlags(8);
  flags[3] = { end: false, clause: true };
  assert.deepEqual(plain(ASR.cues(words, flags, opts)).map((c) => c.text), ['one two three four', 'five six seven eight']);
});

test('without punctuation cues fall back to the length and gap rules', () => {
  const words = mk(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg', 'hhhh']);
  const byLength = plain(ASR.cues(words, noFlags(8), opts)).map((c) => c.text);
  assert.ok(byLength.length >= 2 && byLength.join(' ') === words.map((w) => w.text).join(' '));

  const gap = [...mk(['x', 'y']), { start: 20, end: 20.3, text: 'z' }];
  assert.deepEqual(plain(ASR.cues(gap, noFlags(3), opts)).map((c) => c.text), ['x y', 'z']);
});

test('one- and two-word sentences are merged into the next one', () => {
  const words = mk(['okay', 'so', 'now', 'we', 'start', 'the', 'proof', 'here']);
  const flags = noFlags(8);
  flags[0] = { end: true, clause: false }; // "okay."
  flags[4] = { end: true, clause: false };
  assert.deepEqual(plain(ASR.cues(words, flags, opts)).map((c) => c.text), ['okay so now we start', 'the proof here']);
});

test('conjunctions at the tail of a cue move to the head of the next one', () => {
  const words = mk(['we', 'apply', 'the', 'bias', 'and', 'so', 'the', 'current', 'flows']);
  const flags = noFlags(9);
  flags[5] = { end: false, clause: true };
  assert.deepEqual(plain(ASR.cues(words, flags, { ...opts, maxCueChars: 20 })).map((c) => c.text), [
    'we apply the bias',
    'and so the current flows',
  ]);
});

test('a conjunction before a long pause or a sentence end stays where it is', () => {
  const gap = [...mk(['x', 'y', 'and']), { start: 20, end: 20.3, text: 'z' }];
  assert.deepEqual(plain(ASR.cues(gap, noFlags(4), opts)).map((c) => c.text), ['x y and', 'z']);
  const words = mk(['it', 'is', 'so', 'now', 'we', 'go']);
  const flags = noFlags(6);
  flags[2] = { end: true, clause: false };
  assert.deepEqual(plain(ASR.cues(words, flags, opts)).map((c) => c.text), ['it is so', 'now we go']);
});

test('where punctuation is known the length limit is relaxed', () => {
  const words = mk(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg', 'hhhh']); // 40 chars
  const known = new Array(8).fill({ end: false, clause: false });
  assert.equal(ASR.cues(words, known, opts).length, 1, '40 chars < 1.5 x 30');
  assert.ok(ASR.cues(words, noFlags(8), opts).length > 1, 'unknown punctuation keeps the strict limit');
});

test('align accepts words the model joined with a hyphen', () => {
  const flags = plain(ASR.align(['the', 'gate', 'source', 'voltage', 'is', 'high'], 'The gate-source voltage is high.'));
  assert.equal(flags.length, 6);
  assert.deepEqual(flags.map((f) => f.end), [false, false, false, false, false, true]);
  const three = plain(ASR.align(['a', 'one', 'to', 'one', 'map', 'works'], 'A one-to-one map, works.'));
  assert.equal(three.length, 6);
  assert.equal(three[4].clause, true, 'the comma after "map" lands on the last word');
});

test('flags survive a round trip through the cache encoding', () => {
  const flags = [null, { end: false, clause: false }, { end: true, clause: false }, { end: false, clause: true }];
  const text = ASR.encodeFlags(flags);
  assert.equal(text, '?.ec');
  assert.deepEqual(plain(ASR.decodeFlags(text)), plain(flags));
});

test('stripSounds removes sound annotations and keeps real text', () => {
  const s = ASR.stripSounds;
  assert.equal(s('[Music]'), '');
  assert.equal(s('[Applause] Thank you all.'), 'Thank you all.');
  assert.equal(s('(upbeat music)'), '');
  assert.equal(s('(Laughter) Right, so'), 'Right, so');
  assert.equal(s('♪ ♪'), '');
  assert.equal(s('♪ la la ♪'), 'la la');
  assert.equal(s('Compute (a + b) first (see Figure 2).'), 'Compute (a + b) first (see Figure 2).');
  assert.equal(s('The thermal noise (white noise) limits it.'), 'The thermal noise (white noise) limits it.', 'technical terms stay');
});

test('words and sentence cues drop annotation-only segments', () => {
  const events = [
    { tStartMs: 0, segs: [{ utf8: '[Music]' }] },
    { tStartMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' there', tOffsetMs: 300 }] },
  ];
  assert.deepEqual(plain(ASR.words(events)).map((w) => w.text), ['hello', 'there']);
});
