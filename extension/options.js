// Generic settings form: one input per key of YTD_DEFAULTS; a few keys get a dropdown.
const form = document.getElementById('form');

const CHOICES = {
  targetLang: Object.keys(YTD_LANGS),
  voiceGender: ['female', 'male'],
  speakerVoices: ['off', 'alternate', 'llm'],
  subtitles: ['off', 'translated', 'both'],
  asrPunctuation: ['on', 'off'],
  ttsProvider: ['auto', 'voicevox', 'edge'],
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
  await chrome.storage.sync.set(out);
  document.getElementById('msg').textContent = 'Saved';
});
