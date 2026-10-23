// Loads extension/background.js (a service worker) into a vm with a chrome.* shim and a
// recording fetch, so the real code can be tested without a browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

/** A minimal fetch Response. `body` may be an object (JSON), a string or a Buffer. */
export function response(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('latin1') : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'object' && !Buffer.isBuffer(body) ? body : JSON.parse(text)),
    text: async () => text,
    arrayBuffer: async () => {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(text);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // Buffers may share a pool
    },
  };
}

export function loadBackground({ settings = {}, fetchImpl }) {
  let listener;
  const calls = [];
  const context = vm.createContext({
    fetch: async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return fetchImpl(String(url), opts);
    },
    btoa,
    atob,
    URL,
    AbortSignal,
    console,
    chrome: {
      storage: { sync: { get: async () => settings } },
      runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
    },
  });
  context.importScripts = (file) => vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), context);
  const send = (msg) => new Promise((resolve) => listener(msg, null, resolve));
  return { send, calls, onMessage: (...args) => listener(...args) };
}

/** Evaluates extension/defaults.js and returns { YTD_DEFAULTS, YTD_LANGS }. */
export function loadDefaults() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(EXT, 'defaults.js'), 'utf8'), context);
  return JSON.parse(vm.runInContext('JSON.stringify({ YTD_DEFAULTS, YTD_LANGS })', context));
}

/** Evaluates extension/asr.js and returns its YTD_ASR helpers. */
export function loadAsr() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(EXT, 'asr.js'), 'utf8'), context);
  return vm.runInContext('YTD_ASR', context);
}
