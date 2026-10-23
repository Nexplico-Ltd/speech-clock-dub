// Generic settings form: one input per key of YTD_DEFAULTS; a few keys get a dropdown.
const form = document.getElementById('form');

const CHOICES = {
  targetLang: Object.keys(YTD_LANGS),
  voiceGender: ['female', 'male'],
  speakerVoices: ['off', 'alternate', 'llm'],
  subtitles: ['off', 'translated', 'both'],
  asrPunctuation: ['on', 'off'],
  ttsProvider: ['auto', 'voicevox', 'edge', 'google'],
  voice1Provider: ['', 'auto', 'voicevox', 'edge', 'google'],
  voice2Provider: ['', 'auto', 'voicevox', 'edge', 'google'],
};

// Secrets are masked at all times, so the key is never visible on screen after saving.
const SECRET_KEY = /ApiKey/i;

chrome.storage.sync.get(null).then((stored) => {
  const values = { ...YTD_DEFAULTS, ...stored };
  for (const [key, def] of Object.entries(YTD_DEFAULTS)) {
    const label = document.createElement('label');
    label.textContent = key;
    let input;
    if (CHOICES[key]) {
      input = document.createElement('select');
      for (const c of CHOICES[key]) input.add(new Option(c, c));
    } else {
      input = document.createElement('input');
      input.type = typeof def === 'number' ? 'number' : SECRET_KEY.test(key) ? 'password' : 'text';
      if (SECRET_KEY.test(key)) input.autocomplete = 'new-password';
      if (typeof def === 'number') input.step = 'any';
    }
    input.name = key;
    input.value = values[key];
    label.append(input);
    form.append(label);
  }
});

document.getElementById('save').addEventListener('click', async () => {
  const out = {};
  for (const [key, def] of Object.entries(YTD_DEFAULTS)) {
    const raw = form.elements[key].value;
    out[key] = typeof def === 'number' ? Number(raw) : raw;
  }
  // Servers on other machines (e.g. an LLM and TTS box on the LAN) need a host permission, which Chrome
  // only grants after a click, so ask first.
  const msg = document.getElementById('msg');
  const origins = ytdRemoteOrigins(out);
  let denied = false;
  if (origins.length && !(await chrome.permissions.contains({ origins }))) {
    denied = !(await chrome.permissions.request({ origins }));
  }
  await chrome.storage.sync.set(out);
  msg.textContent = denied ? `Saved, but access to ${origins.join(', ')} was not granted` : 'Saved';
});
