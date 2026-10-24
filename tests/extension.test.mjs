import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { EXT, loadDefaults } from './helpers/load-background.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const { YTD_DEFAULTS, YTD_LANGS } = loadDefaults();

test('manifest is MV3 and every referenced file exists', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    manifest.background.service_worker,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `missing ${f}`);
});

test('manifest only grants localhost and the Google Cloud TTS host permissions', () => {
  for (const p of manifest.host_permissions) {
    assert.match(p, /^(http:\/\/(localhost|127\.0\.0\.1)|https:\/\/texttospeech\.googleapis\.com)\//);
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
