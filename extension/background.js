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
  // Single user message: some Gemma chat templates have no system role.
  const prompt =
    `You translate ${sourceLang} lecture subtitles into natural spoken Japanese (polite desu/masu style) ` +
    `for a voice-over.\nRules:\n` +
    `- Be faithful: do not add, omit or reinterpret content. Keep technical terms accurate.\n` +
    `- Translate the meaning, not word by word. In particular, "Welcome back" is a greeting to ` +
    `returning viewers: say 「引き続き…へようこそ」 or 「おかえりなさい」, never 「お帰りください」.\n` +
    `Output ONLY the Japanese translation of the last line, with no notes, quotes or romaji.` +
    `\n\n${context}Translate this line:\n${text}`;

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
      temperature: 0.2,
      max_tokens: 512, // guard against runaway output
      stream: false,
      ...extra,
    }),
    signal: AbortSignal.timeout(s.llmTimeoutSec * 1000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('LLM returned an empty translation');
  return out;
}

async function synthesize({ text }) {
  const s = await getSettings();
  const base = s.voicevoxUrl.replace(/\/$/, '');

  const q = await fetch(`${base}/audio_query?speaker=${s.speaker}&text=${encodeURIComponent(text)}`, {
    method: 'POST',
  });
  if (!q.ok) throw new Error(`VOICEVOX audio_query HTTP ${q.status}`);
  const query = await q.json();
  query.speedScale = s.ttsSpeed;

  const w = await fetch(`${base}/synthesis?speaker=${s.speaker}`, {
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
    msg.type === 'translate' ? translate(msg) : msg.type === 'synthesize' ? synthesize(msg) : null;
  if (!job) return false;
  job.then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true; // async response
});
