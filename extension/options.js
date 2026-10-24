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
const isSecret = (key) => SECRET_KEY.test(key);

const PROFILE_PREFIX = 'profile:';
const MAX_NAME = 40;

const msg = document.getElementById('msg');
const profileSelect = document.getElementById('profile');
const nameInput = document.getElementById('profileName');
let loadedProfile = ''; // the profile last loaded or saved; remembered as activeProfile on Save

function readForm() {
  const values = {};
  for (const [key, def] of Object.entries(YTD_DEFAULTS)) {
    const raw = form.elements[key].value;
    values[key] = typeof def === 'number' ? Number(raw) : raw;
  }
  return values;
}

// Fills the form from a profile (or file) and keeps the API keys that are already in the form.
function fillForm(overrides) {
  const current = readForm();
  const values = { ...YTD_DEFAULTS, ...overrides };
  for (const key of Object.keys(YTD_DEFAULTS)) {
    form.elements[key].value = isSecret(key) ? current[key] : values[key];
  }
}

// The values that differ from the defaults, optionally without the API keys.
function overridesOf(values, { secrets }) {
  const out = {};
  for (const [key, def] of Object.entries(YTD_DEFAULTS)) {
    if (values[key] !== def && (secrets || !isSecret(key))) out[key] = values[key];
  }
  return out;
}

function userProfiles(stored) {
  const profiles = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(PROFILE_PREFIX)) profiles[key.slice(PROFILE_PREFIX.length)] = value;
  }
  return profiles;
}

async function listProfiles(selected) {
  const stored = await chrome.storage.sync.get(null);
  const names = [...Object.keys(YTD_PRESETS), ...Object.keys(userProfiles(stored)).sort()];
  profileSelect.replaceChildren(...names.map((n) => new Option(n, n)));
  const wanted = selected || stored.activeProfile;
  if (names.includes(wanted)) profileSelect.value = wanted;
  return stored;
}

// If storage is unavailable (for example an add-on without a fixed id in Firefox), still show the form
// with the defaults and say why, instead of leaving the page blank.
chrome.storage.sync.get(null).catch((err) => {
  msg.textContent = `Cannot read saved settings: ${err.message}`;
  return {};
}).then(async (stored) => {
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
      input.type = typeof def === 'number' ? 'number' : isSecret(key) ? 'password' : 'text';
      if (isSecret(key)) input.autocomplete = 'new-password';
      if (typeof def === 'number') input.step = 'any';
    }
    input.name = key;
    input.value = values[key];
    label.append(input);
    form.append(label);
  }
  loadedProfile = stored.activeProfile || '';
  await listProfiles().catch(() => {});
});

document.getElementById('save').addEventListener('click', async () => {
  // Only values that differ from the defaults are stored, so a later change of a default reaches everyone
  // who never changed that setting; a setting set back to its default is removed from storage.
  const values = readForm();
  const out = overridesOf(values, { secrets: true });
  const reset = Object.keys(YTD_DEFAULTS).filter((key) => !(key in out));
  // Servers on other machines (e.g. an LLM and TTS box on the LAN) need a host permission, which Chrome
  // only grants after a click, so ask first.
  const origins = ytdRemoteOrigins(values);
  let note = '';
  if (origins.length) {
    // request() first: it resolves true at once for hosts already granted, and keeps the click's user gesture.
    try {
      if (!(await chrome.permissions.request({ origins }))) note = `access to ${origins.join(', ')} was not granted`;
    } catch (e) {
      note = `cannot request access to ${origins.join(', ')} (${e.message})`;
    }
  }
  try {
    await chrome.storage.sync.set(loadedProfile ? { ...out, activeProfile: loadedProfile } : out);
    await chrome.storage.sync.remove(loadedProfile ? reset : [...reset, 'activeProfile']);
  } catch (err) {
    msg.textContent = `Cannot save: ${err.message}`;
    return;
  }
  msg.textContent = note ? `Saved, but ${note}` : 'Saved';
});

document.getElementById('load').addEventListener('click', async () => {
  const name = profileSelect.value;
  const stored = await chrome.storage.sync.get(null);
  const overrides = YTD_PRESETS[name] ?? userProfiles(stored)[name];
  if (!overrides) {
    msg.textContent = 'No profile selected';
    return;
  }
  fillForm(overrides);
  loadedProfile = name;
  msg.textContent = `Loaded "${name}". Press Save to apply it.`;
});

document.getElementById('saveAs').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name || name.length > MAX_NAME) {
    msg.textContent = `Enter a profile name of 1 to ${MAX_NAME} characters`;
    return;
  }
  if (name in YTD_PRESETS) {
    msg.textContent = `"${name}" is a built-in profile; choose another name`;
    return;
  }
  try {
    await chrome.storage.sync.set({ [PROFILE_PREFIX + name]: overridesOf(readForm(), { secrets: false }) });
  } catch (err) {
    msg.textContent = `Cannot save the profile: ${err.message}`;
    return;
  }
  loadedProfile = name;
  await listProfiles(name);
  msg.textContent = `Saved profile "${name}" (without API keys). Press Save to also make it the active settings.`;
});

document.getElementById('delete').addEventListener('click', async () => {
  const name = profileSelect.value;
  if (name in YTD_PRESETS) {
    msg.textContent = 'Built-in profiles cannot be deleted';
    return;
  }
  await chrome.storage.sync.remove(PROFILE_PREFIX + name);
  if (loadedProfile === name) loadedProfile = '';
  await listProfiles();
  msg.textContent = `Deleted profile "${name}"`;
});

document.getElementById('export').addEventListener('click', () => {
  const data = {
    app: 'speech-clock-dub',
    name: loadedProfile,
    settings: overridesOf(readForm(), { secrets: false }),
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `speech-clock-dub-${(loadedProfile || 'settings').replace(/[^\w.-]+/g, '_')}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  msg.textContent = 'Exported (without API keys)';
});

const importFile = document.getElementById('importFile');
document.getElementById('import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    msg.textContent = 'Import failed: the file is not valid JSON';
    return;
  }
  if (data?.app !== 'speech-clock-dub' || typeof data.settings !== 'object' || !data.settings) {
    msg.textContent = 'Import failed: this is not a Speech Clock Dub settings file';
    return;
  }
  // Unknown keys, API keys and values of the wrong type are ignored.
  const kept = {};
  let ignored = 0;
  for (const [key, value] of Object.entries(data.settings)) {
    if (key in YTD_DEFAULTS && !isSecret(key) && typeof value === typeof YTD_DEFAULTS[key]) kept[key] = value;
    else ignored++;
  }
  fillForm(kept);
  if (typeof data.name === 'string') nameInput.value = data.name.slice(0, MAX_NAME);
  loadedProfile = '';
  msg.textContent = `Imported ${Object.keys(kept).length} settings${ignored ? ` (${ignored} ignored)` : ''}. Press Save to apply them, or "Save as profile" to keep them.`;
});
