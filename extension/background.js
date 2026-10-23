// Service worker: bridges the content script to the local LLM and TTS servers.
// Content scripts cannot call these directly because of the page's CORS/CSP rules.
importScripts('defaults.js');

async function getSettings() {
  return { ...YTD_DEFAULTS, ...(await chrome.storage.sync.get(null)) };
}

async function translate({ text, prev, sourceLang }) {
  const s = await getSettings();
  const context = prev.length
    ? 'Previous lines (for context only, do not repeat them):\n' +
      prev.map((p) => `${p.src}\n=> ${p.ja}`).join('\n') +
      '\n\n'
    : '';
  const lang = getLang(s);
  // Single user message: some Gemma chat templates have no system role.
  const prompt =
    `You translate ${sourceLang} lecture subtitles into ${lang.style} for a voice-over.\nRules:\n` +
    `- Be faithful: do not add, omit or reinterpret content. Keep technical terms accurate.\n` +
    `- Translate the meaning, not word by word.${lang.extraRule ? ` In particular, ${lang.extraRule}` : ''}\n` +
    `Output ONLY the ${lang.name} translation of the last line, with no notes, quotes or romaji.` +
    `\n\n${context}Translate this line:\n${text}`;

  return chat(s, prompt, { temperature: 0.2, maxTokens: 512 });
}

// Restores punctuation and capitalization in a window of ASR words (see extension/asr.js).
async function punctuate({ text, sourceLang }) {
  const s = await getSettings();
  const prompt =
    `Add punctuation and capitalization to this ${sourceLang} speech-recognition transcript of a lecture.\n` +
    `Rules:\n` +
    `- Do not add, remove, reorder or change any word. Only insert punctuation marks and fix capitalization.\n` +
    `- End every sentence with a period, question mark or exclamation mark.\n` +
    `- Output ONLY the corrected text on a single line, with no notes.\n\n` +
    `Transcript:\n${text}`;
  return chat(s, prompt, { temperature: 0, maxTokens: 1024 });
}

// Labels who speaks each line of a dialogue (see extension/speakers.js); `prompt` is built by the caller.
async function labelSpeakers({ prompt }) {
  return chat(await getSettings(), prompt, { temperature: 0, maxTokens: 600 });
}

// One chat completion against the OpenAI-compatible endpoint; returns the reply text.
async function chat(s, prompt, { temperature, maxTokens }) {
  let extra = {};
  try {
    extra = JSON.parse(s.llmExtraBody || '{}');
  } catch {
    throw new Error('llmExtraBody is not valid JSON');
  }

  const res = await fetch(`${s.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(s.llmApiKey ? { Authorization: `Bearer ${s.llmApiKey}` } : {}),
    },
    body: JSON.stringify({
      model: s.llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens, // guard against runaway output
      stream: false,
      ...extra,
    }),
    signal: AbortSignal.timeout(s.llmTimeoutSec * 1000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('LLM returned an empty reply');
  return out;
}

function getLang(s) {
  const lang = YTD_LANGS[s.targetLang];
  if (!lang) throw new Error(`Unknown targetLang "${s.targetLang}" (use one of ${Object.keys(YTD_LANGS).join(', ')})`);
  return lang;
}

// `alt` asks for the second voice of a dialogue: the gender opposite to voiceGender.
async function synthesize({ text, alt }) {
  const s = await getSettings();
  const provider = s.ttsProvider === 'auto' ? (s.targetLang === 'ja' ? 'voicevox' : 'edge') : s.ttsProvider;
  return provider === 'edge' ? synthesizeEdge(s, text, alt) : synthesizeVoicevox(s, text, alt);
}

const genderFor = (s, alt) => ((s.voiceGender === 'male') !== Boolean(alt) ? 'male' : 'female');

async function synthesizeEdge(s, text, alt) {
  const res = await fetch(`${s.edgeUrl.replace(/\/$/, '')}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: (!alt && s.edgeVoice) || getLang(s).voices[genderFor(s, alt)], rate: s.edgeRate }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`edge-tts bridge HTTP ${res.status}: ${await res.text()}`);
  return toBase64(await res.arrayBuffer());
}

async function synthesizeVoicevox(s, text, alt) {
  if (s.targetLang !== 'ja') throw new Error('VOICEVOX only speaks Japanese; use ttsProvider "edge" or "auto"');
  const base = s.voicevoxUrl.replace(/\/$/, '');
  const speaker = genderFor(s, alt) === 'male' ? s.speakerMale : s.speakerFemale;

  const q = await fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, {
    method: 'POST',
  });
  if (!q.ok) throw new Error(`VOICEVOX audio_query HTTP ${q.status}`);
  const query = await q.json();
  query.speedScale = s.ttsSpeed;

  const w = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!w.ok) throw new Error(`VOICEVOX synthesis HTTP ${w.status}`);
  return toBase64(await w.arrayBuffer());
}

// Extension messages are JSON-serialized, so binary data travels as base64.
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const job =
    msg.type === 'translate'
      ? translate(msg)
      : msg.type === 'punctuate'
        ? punctuate(msg)
        : msg.type === 'label'
          ? labelSpeakers(msg)
          : msg.type === 'synthesize'
            ? synthesize(msg)
            : null;
  if (!job) return false;
  job.then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true; // async response
});
