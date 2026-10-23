import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
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

test('manifest only grants localhost host permissions', () => {
  for (const p of manifest.host_permissions) assert.match(p, /^http:\/\/(localhost|127\.0\.0\.1)\//);
});

test('the page hook runs in the MAIN world and the content script in the isolated world', () => {
  const hook = manifest.content_scripts.find((cs) => cs.js.includes('page-hook.js'));
  const content = manifest.content_scripts.find((cs) => cs.js.includes('content.js'));
  assert.equal(hook.world, 'MAIN');
  assert.notEqual(content.world, 'MAIN');
  assert.ok(content.js.indexOf('defaults.js') < content.js.indexOf('content.js'), 'defaults.js must load first');
  assert.ok(content.js.indexOf('asr.js') < content.js.indexOf('content.js'), 'asr.js must load before content.js');
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
  assert.ok(['auto', 'voicevox', 'edge'].includes(YTD_DEFAULTS.ttsProvider));
  assert.ok(['off', 'translated', 'both'].includes(YTD_DEFAULTS.subtitles));
  assert.ok(YTD_DEFAULTS.lowWaterSec < YTD_DEFAULTS.highWaterSec);
  assert.ok(['on', 'off'].includes(YTD_DEFAULTS.asrPunctuation));
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
