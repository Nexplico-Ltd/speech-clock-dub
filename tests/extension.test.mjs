import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { EXT, loadDefaults } from './helpers/load-background.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const { YTD_DEFAULTS, YTD_LANGS, YTD_PRESETS } = loadDefaults();

test('manifest is MV3 and every referenced file exists', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    manifest.background.service_worker,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `missing ${f}`);
});

test('manifest only grants localhost and the Google API host permissions', () => {
  for (const p of manifest.host_permissions) {
    assert.match(p, /^(http:\/\/(localhost|127\.0\.0\.1)|https:\/\/(texttospeech|generativelanguage)\.googleapis\.com)\//);
  }
});

test('the page hook runs in the MAIN world and the content script in the isolated world', () => {
  const hook = manifest.content_scripts.find((cs) => cs.js.includes('page-hook.js'));
  const content = manifest.content_scripts.find((cs) => cs.js.includes('content.js'));
  assert.equal(hook.world, 'MAIN');
  assert.notEqual(content.world, 'MAIN');
  assert.ok(content.js.indexOf('defaults.js') < content.js.indexOf('content.js'), 'defaults.js must load first');
  for (const helper of ['asr.js', 'speakers.js', 'subtitle.js']) {
    assert.ok(content.js.indexOf(helper) < content.js.indexOf('content.js'), `${helper} must load before content.js`);
  }
});

test('every target language has a style and a voice per gender', () => {
  assert.ok(Object.keys(YTD_LANGS).length >= 5);
  for (const [code, lang] of Object.entries(YTD_LANGS)) {
    assert.ok(lang.name && lang.style, `${code}: name/style`);
    for (const gender of ['female', 'male']) {
      assert.match(lang.voices[gender], /^[a-z]{2}-[A-Z]{2}-\w+Neural$/, `${code}.${gender}`);
    }
  }
});

test('default settings are consistent', () => {
  assert.ok(YTD_DEFAULTS.targetLang in YTD_LANGS);
  assert.ok(['female', 'male'].includes(YTD_DEFAULTS.voiceGender));
  assert.ok(['auto', 'voicevox', 'edge', 'google'].includes(YTD_DEFAULTS.ttsProvider));
  assert.ok(['off', 'translated', 'both'].includes(YTD_DEFAULTS.subtitles));
  assert.ok(YTD_DEFAULTS.lowWaterSec < YTD_DEFAULTS.highWaterSec);
  assert.ok(['on', 'off'].includes(YTD_DEFAULTS.asrPunctuation));
  assert.ok(Number.isInteger(YTD_DEFAULTS.subtitleMaxLines) && YTD_DEFAULTS.subtitleMaxLines >= 0);
  assert.ok(YTD_DEFAULTS.asrStrideWords < YTD_DEFAULTS.asrWindowWords, 'ASR windows must overlap');
  assert.ok(YTD_DEFAULTS.minRate < 1 && YTD_DEFAULTS.maxRate > 1);
  assert.doesNotThrow(() => JSON.parse(YTD_DEFAULTS.llmExtraBody), 'llmExtraBody must be valid JSON');
});

test('the default configuration needs no local server: hosted Gemini and Google TTS', () => {
  assert.equal(YTD_DEFAULTS.ttsProvider, 'google');
  const base = new URL(YTD_DEFAULTS.llmBaseUrl);
  assert.equal(base.protocol, 'https:');
  assert.ok(manifest.host_permissions.includes(`${base.protocol}//${base.hostname}/*`), 'LLM host needs no permission prompt');
  assert.deepEqual(JSON.parse(YTD_DEFAULTS.llmExtraBody), {}, 'hosted APIs may reject local-only fields');
  assert.equal(YTD_DEFAULTS.llmApiKey, '');
  assert.equal(YTD_DEFAULTS.googleApiKey, '');
});

test('built-in profiles only set known, non-secret settings of the right type and never use a secret', () => {
  assert.ok(Object.keys(YTD_PRESETS).length >= 4);
  for (const [name, preset] of Object.entries(YTD_PRESETS)) {
    assert.ok(name.length <= 40, `${name}: fits the profile name limit`);
    for (const [key, value] of Object.entries(preset)) {
      assert.ok(key in YTD_DEFAULTS, `${name}: unknown setting ${key}`);
      assert.ok(!/ApiKey/i.test(key), `${name}: ${key} is a secret`);
      assert.equal(typeof value, typeof YTD_DEFAULTS[key], `${name}: type of ${key}`);
      assert.notEqual(value, YTD_DEFAULTS[key], `${name}: ${key} equals the default`);
    }
    if ('llmExtraBody' in preset) assert.doesNotThrow(() => JSON.parse(preset.llmExtraBody), name);
    if ('ttsProvider' in preset) assert.ok(['auto', 'voicevox', 'edge', 'google'].includes(preset.ttsProvider), name);
    if ('speakerVoices' in preset) assert.ok(['off', 'alternate', 'llm'].includes(preset.speakerVoices), name);
  }
});

test('the options page offers a dropdown for every enumerated setting', () => {
  const options = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');
  for (const key of ['targetLang', 'voiceGender', 'ttsProvider', 'subtitles', 'asrPunctuation']) {
    assert.ok(options.includes(`${key}:`), `options.js has no dropdown for ${key}`);
  }
});

test('remote server origins are collected without ports, skipping local and invalid URLs', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(path.join(EXT, 'defaults.js'), 'utf8'), context);
  const origins = (s) => JSON.parse(vm.runInContext(`JSON.stringify(ytdRemoteOrigins(${JSON.stringify(s)}))`, context));
  assert.deepEqual(origins({ llmBaseUrl: 'http://127.0.0.1:8888/v1', voicevoxUrl: 'http://localhost:50021', edgeUrl: 'http://127.0.0.1:5050' }), []);
  assert.deepEqual(
    origins({ llmBaseUrl: 'http://192.168.1.20:8888/v1', voicevoxUrl: 'http://192.168.1.20:50021', edgeUrl: 'https://tts.lan:5050' }),
    ['http://192.168.1.20/*', 'https://tts.lan/*'],
  );
  // IPv6 literals are not valid match patterns; https://localhost is not covered by the manifest.
  assert.deepEqual(origins({ llmBaseUrl: 'http://[::1]:5050', voicevoxUrl: 'https://localhost:1', edgeUrl: '' }), ['https://localhost/*']);
  // Hosts the manifest already grants need no request.
  assert.deepEqual(origins({ llmBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', voicevoxUrl: 'http://localhost:50021', edgeUrl: '' }), []);
  const manifestHosts = manifest.host_permissions.filter((h) => h.startsWith('https://')).map((h) => new URL(h.replace('*', 'x')).hostname.replace(/^x$/, ''));
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(YTD_MANIFEST_HOSTS)', context)).sort(), manifestHosts.sort());
  assert.deepEqual(origins({ llmBaseUrl: 'not a url', voicevoxUrl: 'ftp://x', edgeUrl: '' }), []);
});

test('only the server hosts the options page can ask for are optional host permissions', () => {
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
});

test('the same manifest runs in Firefox: event-page scripts load defaults.js first and a gecko id is set', () => {
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.background.scripts, ['defaults.js', 'background.js']);
  const gecko = manifest.browser_specific_settings.gecko;
  assert.match(gecko.id, /^[\w.-]+@[\w.-]+$/);
  assert.ok(parseInt(gecko.strict_min_version, 10) >= 128, 'world: MAIN content scripts need Firefox 128');
});
