import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackground, response } from './helpers/load-background.mjs';

const MP3 = Buffer.from([0xff, 0xf3, 0x44, 0xc4, 0, 0, 0, 0]);
const WAV = Buffer.from('RIFF....WAVEdata....');

function fakeServers() {
  return (url) => {
    if (url.includes('/chat/completions')) return response({ choices: [{ message: { content: '訳文' } }] });
    if (url.includes('/audio_query')) return response({ accent_phrases: [], speedScale: 1 });
    if (url.includes('/synthesis')) return response(WAV);
    if (url.includes('/tts')) return response(MP3);
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function translate(settings, extra = {}) {
  const bg = loadBackground({ settings, fetchImpl: fakeServers() });
  const res = await bg.send({ type: 'translate', text: 'Welcome back.', prev: [], sourceLang: 'English', ...extra });
  const call = bg.calls.find((c) => c.url.includes('/chat/completions'));
  return { res, call, body: call && JSON.parse(call.opts.body) };
}

test('translate sends an OpenAI-style request with thinking disabled by default', async () => {
  const { res, call, body } = await translate({});
  assert.equal(res.ok, true);
  assert.equal(res.result, '訳文');
  assert.match(call.url, /\/v1\/chat\/completions$/);
  assert.equal(body.messages.length, 1, 'single user message (some Gemma templates lack a system role)');
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.ok(body.max_tokens > 0);
  assert.ok(call.opts.signal, 'request must have a timeout');
});

test('translate adds the Authorization header only when an API key is set', async () => {
  assert.equal((await translate({})).call.opts.headers.Authorization, undefined);
  assert.equal((await translate({ llmApiKey: 'k' })).call.opts.headers.Authorization, 'Bearer k');
});

test('translate prompt follows the target language', async () => {
  const hello = { text: 'Hello there.' }; // not "Welcome back", which only the Japanese rule mentions
  const ja = (await translate({ targetLang: 'ja' }, hello)).body.messages[0].content;
  assert.match(ja, /Japanese/);
  assert.match(ja, /Welcome back/, 'Japanese keeps the "Welcome back" rule');
  for (const [lang, word] of [['en', 'English'], ['zh-TW', 'Traditional Chinese'], ['zh-CN', 'Simplified Chinese'], ['ko', 'Korean']]) {
    const prompt = (await translate({ targetLang: lang }, hello)).body.messages[0].content;
    assert.match(prompt, new RegExp(word), lang);
    assert.doesNotMatch(prompt, /Welcome back/, `${lang} must not get the Japanese-only rule`);
  }
});

test('translate includes previous lines as context', async () => {
  const { body } = await translate({}, { prev: [{ src: 'Hello.', ja: 'こんにちは。' }] });
  assert.match(body.messages[0].content, /Hello\.\n=> こんにちは。/);
});

test('translate rejects an unknown target language and invalid llmExtraBody', async () => {
  assert.match((await translate({ targetLang: 'xx' })).res.error, /Unknown targetLang/);
  assert.match((await translate({ llmExtraBody: '{nope' })).res.error, /llmExtraBody/);
});

test('translate reports HTTP errors', async () => {
  const bg = loadBackground({ fetchImpl: () => response('nope', { status: 401 }) });
  const res = await bg.send({ type: 'translate', text: 'x', prev: [], sourceLang: 'English' });
  assert.equal(res.ok, false);
  assert.match(res.error, /LLM HTTP 401/);
});

async function synth(settings, extra = {}) {
  const bg = loadBackground({ settings, fetchImpl: fakeServers() });
  const res = await bg.send({ type: 'synthesize', text: 'こんにちは', ...extra });
  return { res, calls: bg.calls };
}

test('ttsProvider auto: VOICEVOX for Japanese, with the speaker for the chosen gender', async () => {
  let { res, calls } = await synth({});
  assert.equal(res.ok, true);
  assert.match(calls[0].url, /\/audio_query\?speaker=2&/);
  assert.match(calls[1].url, /\/synthesis\?speaker=2$/);
  assert.equal(JSON.parse(calls[1].opts.body).speedScale, 1.25, 'ttsSpeed is applied');

  ({ calls } = await synth({ voiceGender: 'male' }));
  assert.match(calls[0].url, /speaker=11&/);
});

test('ttsProvider auto: edge-tts for other languages, with the voice for the chosen gender', async () => {
  const voice = async (settings) => JSON.parse((await synth(settings)).calls[0].opts.body).voice;
  assert.equal(await voice({ targetLang: 'en' }), 'en-US-AriaNeural');
  assert.equal(await voice({ targetLang: 'en', voiceGender: 'male' }), 'en-US-GuyNeural');
  assert.equal(await voice({ targetLang: 'ko', voiceGender: 'male' }), 'ko-KR-InJoonNeural');
  assert.equal(await voice({ targetLang: 'zh-TW' }), 'zh-TW-HsiaoChenNeural');
  assert.equal(await voice({ targetLang: 'zh-CN', voiceGender: 'male' }), 'zh-CN-YunxiNeural');
  assert.equal(await voice({ targetLang: 'en', edgeVoice: 'en-GB-SoniaNeural' }), 'en-GB-SoniaNeural');
});

test('edge-tts request goes to the bridge with the configured rate', async () => {
  const { res, calls } = await synth({ targetLang: 'en', edgeRate: '+10%' });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:5050/tts');
  assert.equal(JSON.parse(calls[0].opts.body).rate, '+10%');
  assert.equal(Buffer.from(res.result, 'base64').equals(MP3), true, 'audio is returned as base64');
});

test('ttsProvider can be forced; VOICEVOX refuses non-Japanese targets', async () => {
  assert.match((await synth({ ttsProvider: 'voicevox', targetLang: 'en' })).res.error, /only speaks Japanese/);
  const { res, calls } = await synth({ ttsProvider: 'edge', targetLang: 'ja' });
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(calls[0].opts.body).voice, 'ja-JP-NanamiNeural');
});

test('unknown message types are not handled, so Chrome does not wait for a reply', () => {
  const bg = loadBackground({ fetchImpl: fakeServers() });
  assert.equal(bg.onMessage({ type: 'nope' }, null, () => {}), false);
  assert.equal(bg.onMessage({ type: 'translate', text: 'x', prev: [], sourceLang: 'English' }, null, () => {}), true);
});

test('punctuate asks the model to restore punctuation without changing any word', async () => {
  const bg = loadBackground({
    fetchImpl: () => response({ choices: [{ message: { content: 'Hello, world.' } }] }),
  });
  const res = await bg.send({ type: 'punctuate', text: 'hello world', sourceLang: 'English' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 'Hello, world.');
  const body = JSON.parse(bg.calls[0].opts.body);
  assert.equal(body.temperature, 0);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.match(body.messages[0].content, /Do not add, remove, reorder or change any word/);
  assert.match(body.messages[0].content, /English/);
  assert.ok(body.messages[0].content.endsWith('hello world'));
});

test('alt asks for the voice of the opposite gender (second speaker of a dialogue)', async () => {
  assert.match((await synth({}, { alt: true })).calls[0].url, /speaker=11&/);
  assert.match((await synth({ voiceGender: 'male' }, { alt: true })).calls[0].url, /speaker=2&/);
  const edge = async (settings, extra) => JSON.parse((await synth({ targetLang: 'en', ...settings }, extra)).calls[0].opts.body).voice;
  assert.equal(await edge({}, { alt: true }), 'en-US-GuyNeural');
  assert.equal(await edge({ voiceGender: 'male' }, { alt: true }), 'en-US-AriaNeural');
  // A fixed edgeVoice is the first speaker's voice; the second still uses the other gender.
  assert.equal(await edge({ edgeVoice: 'en-GB-SoniaNeural' }, { alt: true }), 'en-US-GuyNeural');
});
