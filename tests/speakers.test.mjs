import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSpeakers } from './helpers/load-background.mjs';

const SPK = loadSpeakers();
const plain = (x) => JSON.parse(JSON.stringify(x));
const frag = (start, end, text) => ({ start, end, text });

test('a leading "- " flags a new turn and is removed', () => {
  const out = plain(SPK.split([frag(0, 2, '- Hello there'), frag(2, 4, 'and welcome'), frag(4, 6, '- Thanks.')]));
  assert.deepEqual(
    out.map((f) => [f.text, f.turn]),
    [['Hello there', true], ['and welcome', false], ['Thanks.', true]],
  );
});

test('">>" markers work at the start of a line and inside one', () => {
  const out = plain(SPK.split([frag(0, 4, '>> How are you? >> Fine.')]));
  assert.deepEqual(out.map((f) => [f.text, f.turn]), [['How are you?', true], ['Fine.', true]]);
});

test('a fragment holding two turns is divided by text length', () => {
  const out = plain(SPK.split([frag(10, 20, '- Hi!\n- Hello, nice to see you.')]));
  assert.deepEqual(out.map((f) => f.text), ['Hi!', 'Hello, nice to see you.']);
  assert.equal(out[0].start, 10);
  assert.equal(out[1].end, 20);
  assert.equal(out[0].end, out[1].start);
  assert.ok(out[0].end - out[0].start < out[1].end - out[1].start, 'the shorter turn gets less time');
});

test('hyphens inside words and numbers are not markers', () => {
  const out = plain(SPK.split([frag(0, 2, 'a well-known -5 dB trade-off')]));
  assert.deepEqual(out.map((f) => f.text), ['a well-known -5 dB trade-off']);
});

test('assign alternates the voice at each turn, starting with voice 0', () => {
  const cues = [{ turn: true }, {}, { turn: true }, {}, { turn: true }];
  assert.deepEqual(plain(SPK.assign(cues)).map((c) => c.voice), [0, 0, 1, 1, 0]);
});

test('labelPrompt numbers the lines and shows the labelled context', () => {
  const p = SPK.labelPrompt(['How did you start?', 'I built circuits.'], [{ text: 'Welcome.', voice: 0 }, { text: 'Thanks.', voice: 1 }]);
  assert.match(p, /\[H\] Welcome\.\n\[G\] Thanks\./);
  assert.match(p, /1\. How did you start\?\n2\. I built circuits\./);
  assert.match(p, /exactly 2 lines/);
  assert.match(SPK.labelPrompt(['Hi.'], []), /start of the conversation/);
});

test('labelPrompt clips very long lines', () => {
  assert.ok(SPK.labelPrompt(['x'.repeat(1000)], []).length < 1500);
});

test('parseLabels maps H to voice 0 and G to voice 1, tolerating list styles', () => {
  assert.deepEqual(plain(SPK.parseLabels('1: H\n2: G\n3. g\n4) H', 4)), [0, 1, 1, 0]);
  assert.deepEqual(plain(SPK.parseLabels('```\n1: G\n2: H\n```', 2)), [1, 0]);
});

test('parseLabels returns null when a line is missing or the reply is unusable', () => {
  assert.equal(SPK.parseLabels('1: H\n3: G', 3), null);
  assert.equal(SPK.parseLabels('I cannot tell.', 2), null);
});

test('isMonologue is true when almost every line gets the same label', () => {
  assert.equal(SPK.isMonologue([0, ...Array(29).fill(1)]), true, 'one stray line out of 30');
  assert.equal(SPK.isMonologue(Array(30).fill(0)), true);
});

test('isMonologue is false for a real conversation and for too few lines', () => {
  assert.equal(SPK.isMonologue([...Array(24).fill(1), ...Array(6).fill(0)]), false);
  assert.equal(SPK.isMonologue([0, 1, 1, 1]), false);
  assert.equal(SPK.isMonologue([1, 1, 1]), false, 'fewer than 20 lines is not enough to tell');
});
