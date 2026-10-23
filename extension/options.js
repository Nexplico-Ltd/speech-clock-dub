// Generic settings form: one input per key of YTD_DEFAULTS.
const form = document.getElementById('form');

chrome.storage.sync.get(null).then((stored) => {
  const values = { ...YTD_DEFAULTS, ...stored };
  for (const [key, def] of Object.entries(YTD_DEFAULTS)) {
    const label = document.createElement('label');
    label.textContent = key;
    const input = document.createElement('input');
    input.name = key;
    input.type = typeof def === 'number' ? 'number' : 'text';
    if (typeof def === 'number') input.step = 'any';
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
