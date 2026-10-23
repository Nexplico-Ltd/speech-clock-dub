// Content script (isolated world).
// The synthesized Japanese speech is the master clock; the <video> follows it by
// changing playbackRate and pausing/resuming. The original audio is muted.
(() => {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let S = { ...YTD_DEFAULTS };

  const state = {
    active: false,
    gen: 0, // bumped on start/stop to cancel the producer loop
    video: null,
    ctx: null,
    gain: null,
    cues: [], // { start, end, text } in video seconds
    ja: [], // translated text per cue (kept even after audio is freed)
    items: [], // { buffer, dur } | { failed: true, dur: 0 } per cue
    lang: 'English',
    idx: 0, // cue currently being scheduled
    phase: 'lead-in', // 'lead-in' (heading to cue start) | 'speaking'
    buffering: true,
    source: null,
    audioDone: false,
    held: false, // true when WE paused the video
    userPaused: false,
    ad: false,
    raf: 0,
    origMuted: false,
    origRate: 1,
    lastStatus: 0,
    local: null, // captions loaded from a local file: { local, kind, events }
    failStreak: 0, // consecutive failed cues
    lastError: '',
    lastT: 0, // previous video.currentTime seen by the scheduler
  };

  // ---------- messaging ----------

  const sendBg = (msg) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.ok) resolve(res.result);
        else reject(new Error(res?.error ?? 'No response from background'));
      }),
    );

  async function retry(fn, tries = 2) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        await sleep(300);
      }
    }
    throw last;
  }

  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ---------- captions -> cues ----------

  function fetchCaptions() {
    return new Promise((resolve, reject) => {
      const reqId = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('Timed out waiting for captions'));
      }, 10000);
      function onMsg(e) {
        if (e.source !== window || e.data?.type !== 'ytd:captions' || e.data.reqId !== reqId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ type: 'ytd:get-captions', reqId }, '*');
    });
  }

  // ASR captions repeat earlier words in rolling windows. Flatten them to words with absolute
  // times and keep each word once (start times must strictly increase). Best effort: untested
  // against a wide range of real ASR tracks.
  function asrWords(events) {
    const words = [];
    let last = -1;
    for (const e of events) {
      if (!e.segs) continue;
      for (const s of e.segs) {
        const text = s.utf8.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const start = (e.tStartMs + (s.tOffsetMs ?? 0)) / 1000;
        if (start <= last) continue;
        last = start;
        words.push({ start, text });
      }
    }
    return words.map((w, i) => ({
      start: w.start,
      end: Math.min(words[i + 1]?.start ?? Infinity, w.start + 0.8),
      text: w.text,
    }));
  }

  // Parse a local SRT / WebVTT / JSON3 caption file into json3-style events.
  function parseCaptionFile(name, text) {
    if (/\.json3?$/i.test(name)) return JSON.parse(text).events ?? [];
    const toMs = (t) => {
      const p = t.replace(',', '.').split(':').map(parseFloat);
      while (p.length < 3) p.unshift(0);
      return Math.round(((p[0] * 60 + p[1]) * 60 + p[2]) * 1000);
    };
    const events = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      const start = toMs(a);
      const end = toMs(b.trim().split(/\s+/)[0]);
      const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (body) events.push({ tStartMs: start, dDurationMs: end - start, segs: [{ utf8: body }] });
    }
    return events;
  }

  // Merge caption fragments into sentence-sized cues.
  function buildCues(events, kind) {
    const frags =
      kind === 'asr'
        ? asrWords(events)
        : events
            .filter((e) => e.segs)
            .map((e) => ({
              start: e.tStartMs / 1000,
              end: (e.tStartMs + (e.dDurationMs ?? 0)) / 1000,
              text: e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim(),
            }))
            .filter((f) => f.text);

    const cues = [];
    let cur = null;
    const flush = () => {
      if (cur) cues.push(cur);
      cur = null;
    };
    for (const f of frags) {
      if (cur && f.start - cur.end > S.maxGapSec) flush();
      if (!cur) cur = { start: f.start, end: f.end, text: f.text };
      else {
        cur.text += ' ' + f.text;
        cur.end = Math.max(cur.end, f.end);
      }
      if (/[.!?。！？]["')\]]?$/.test(cur.text) || cur.text.length >= S.maxCueChars) flush();
    }
    flush();

    // Cues must not overlap: the scheduler moves strictly forward in video time.
    for (let i = 0; i < cues.length; i++) {
      if (i > 0 && cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
      if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.2;
    }
    return cues;
  }

  // ---------- production (translate + TTS ahead of playback) ----------

  const nextMissing = (from) => {
    for (let i = Math.max(0, from); i < state.cues.length; i++) if (!state.items[i]) return i;
    return -1;
  };

  // Seconds of synthesized audio ready, contiguous from the current cue.
  function readyAhead() {
    let sum = 0;
    for (let i = state.idx; i < state.items.length; i++) {
      const it = state.items[i];
      if (!it) break;
      sum += it.dur;
    }
    return sum;
  }

  async function produceItem(i) {
    try {
      if (state.ja[i] === undefined) {
        const prev = [];
        for (let k = Math.max(0, i - S.contextCues); k < i; k++) {
          if (state.ja[k] !== undefined) prev.push({ src: state.cues[k].text, ja: state.ja[k] });
        }
        state.ja[i] = await retry(() =>
          sendBg({ type: 'translate', text: state.cues[i].text, prev, sourceLang: state.lang }),
        );
      }
      const b64 = await retry(() => sendBg({ type: 'synthesize', text: state.ja[i] }));
      const buffer = await state.ctx.decodeAudioData(b64ToArrayBuffer(b64));
      state.items[i] = { buffer, dur: buffer.duration };
      state.failStreak = 0;
    } catch (err) {
      console.warn('[ytd] cue', i, 'failed:', err);
      state.items[i] = { failed: true, dur: 0 };
      state.failStreak++;
      state.lastError = err.message;
    }
  }

  async function produceLoop(gen) {
    while (state.active && gen === state.gen) {
      const next = nextMissing(state.idx);
      if (next < 0 || readyAhead() >= S.targetAheadSec) {
        await sleep(400);
        continue;
      }
      await produceItem(next);
      // A dead LLM or TTS server would otherwise make every cue silently skip.
      if (state.failStreak >= 3 && state.active && gen === state.gen) {
        const msg = state.lastError;
        stop();
        setStatus(`Error: translation/TTS failed 3 times in a row (${msg})`);
      }
    }
  }

  // ---------- playback scheduler ----------

  const adShowing = () => !!document.querySelector('#movie_player.ad-showing');

  function hold() {
    const v = state.video;
    if (!v.paused) {
      state.held = true;
      v.pause();
    }
  }

  function resume() {
    const v = state.video;
    if (v.paused && !state.userPaused) {
      state.held = false;
      v.play().catch(() => {});
    }
  }

  function startSpeech(item, cue) {
    const v = state.video;
    const src = state.ctx.createBufferSource();
    src.buffer = item.buffer;
    src.connect(state.gain);
    state.audioDone = false;
    src.onended = () => {
      if (state.source === src) state.audioDone = true;
    };
    state.source = src;
    src.start();
    // Make the remaining part of the cue last as long as the speech.
    const remaining = Math.max(cue.end - v.currentTime, 0.1);
    v.playbackRate = clamp(remaining / item.dur, S.minRate, S.maxRate);
  }

  function stopSpeech() {
    const src = state.source;
    state.source = null;
    state.audioDone = false;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {}
    }
  }

  function checkWater() {
    if (readyAhead() < S.lowWaterSec && nextMissing(state.idx) >= 0) state.buffering = true;
  }

  function tick() {
    state.raf = requestAnimationFrame(tick);
    const v = state.video;

    const ad = adShowing();
    if (ad !== state.ad) {
      state.ad = ad;
      v.muted = !ad;
      if (ad) state.ctx.suspend();
      else if (!state.userPaused) state.ctx.resume();
    }
    if (ad || state.userPaused) return;

    // YouTube may unmute (volume key) or reload the source (position jumps back); the
    // scheduler only ever moves forward, so treat a backward jump like a user seek.
    if (!v.muted) v.muted = true;
    if (v.currentTime < state.lastT - 1) onSeeking();
    state.lastT = v.currentTime;

    updateStatus();

    if (state.idx >= state.cues.length) {
      // Last cue spoken: hand the rest of the video back to its original audio and speed.
      stop();
      setStatus('Dub finished');
      return;
    }
    const cue = state.cues[state.idx];
    const item = state.items[state.idx];

    if (state.buffering) {
      hold();
      if (readyAhead() >= S.highWaterSec || nextMissing(state.idx) < 0) state.buffering = false;
      else return;
    }

    if (state.phase === 'lead-in') {
      if (!item) {
        // Hard underflow: the next cue has no audio yet.
        state.buffering = true;
        hold();
        return;
      }
      if (item.failed) {
        state.idx++;
        return;
      }
      if (v.currentTime >= cue.start - 0.05) {
        startSpeech(item, cue);
        state.phase = 'speaking';
      } else {
        resume();
        v.playbackRate = cue.start - v.currentTime > 3 ? S.gapRate : 1;
      }
      return;
    }

    // speaking
    if (state.audioDone) {
      state.source = null;
      state.items[state.idx - 4] = undefined; // free old audio; text stays in state.ja
      state.idx++;
      state.phase = 'lead-in';
      checkWater();
      return;
    }
    // Speech still running but the cue's video segment is over: freeze the slide.
    if (v.currentTime >= cue.end) hold();
    else resume();
  }

  // ---------- video event handlers ----------

  function onPause() {
    if (!state.active || state.held || state.video.ended || state.ad) return;
    state.userPaused = true;
    state.ctx.suspend();
  }

  function onPlay() {
    if (!state.active || !state.userPaused) return;
    state.userPaused = false;
    state.ctx.resume();
  }

  function onSeeking() {
    if (!state.active || state.ad) return;
    // The scheduler never seeks, so any seek is the user's: resync to the new position.
    stopSpeech();
    const t = state.video.currentTime;
    const i = state.cues.findIndex((c) => c.end > t);
    state.idx = i < 0 ? state.cues.length : i;
    state.phase = 'lead-in';
    state.buffering = true;
    state.lastT = t;
  }

  // ---------- lifecycle ----------

  async function start() {
    // Create the AudioContext synchronously inside the click handler (autoplay policy).
    state.ctx = new AudioContext();
    state.gain = state.ctx.createGain();
    state.gain.connect(state.ctx.destination);
    state.ctx.resume();

    S = { ...YTD_DEFAULTS, ...(await chrome.storage.sync.get(null)) };
    const v = (state.video =
      document.querySelector('video.html5-main-video') ?? document.querySelector('video'));
    if (!v) throw new Error('No <video> element found');

    setStatus('Loading captions…');
    let cap = state.local;
    if (!cap) {
      try {
        cap = await fetchCaptions();
      } catch (err) {
        throw new Error(`${err.message}. Use "Load captions" to supply an SRT/VTT/JSON3 file.`);
      }
    }
    const cues = buildCues(cap.events, cap.kind);
    if (!cues.length) throw new Error('No usable caption text');

    state.cues = cues;
    state.ja = [];
    state.items = [];
    state.lang = cap.local
      ? S.localCaptionLang
      : (new Intl.DisplayNames(['en'], { type: 'language' }).of(cap.languageCode) ?? 'English');
    state.failStreak = 0;
    state.userPaused = false;
    state.ad = false;
    state.held = false;
    state.audioDone = false;
    state.phase = 'lead-in';
    state.buffering = true;

    const i = cues.findIndex((c) => c.end > v.currentTime);
    state.idx = i < 0 ? cues.length : i;
    state.lastT = v.currentTime;

    state.origMuted = v.muted;
    state.origRate = v.playbackRate;
    v.muted = true;
    hold();

    v.addEventListener('pause', onPause);
    v.addEventListener('play', onPlay);
    v.addEventListener('seeking', onSeeking);

    state.active = true;
    const gen = ++state.gen;
    produceLoop(gen);
    state.raf = requestAnimationFrame(tick);
    setButton(true);
  }

  function stop() {
    if (!state.active) {
      state.ctx?.close().catch(() => {});
      return;
    }
    state.active = false;
    state.gen++;
    cancelAnimationFrame(state.raf);
    stopSpeech();
    const v = state.video;
    v.removeEventListener('pause', onPause);
    v.removeEventListener('play', onPlay);
    v.removeEventListener('seeking', onSeeking);
    v.muted = state.origMuted;
    v.playbackRate = state.origRate;
    // If we were the ones holding the video (buffering / freezing a slide), let it run again.
    if (state.held && !state.userPaused) {
      state.held = false;
      v.play().catch(() => {});
    }
    state.ctx.close().catch(() => {});
    setButton(false);
    setStatus('');
  }

  // ---------- HUD ----------

  let hud, btn, statusEl;

  function ensureHud() {
    if (hud?.isConnected) return;
    const player = document.getElementById('movie_player');
    if (!player) return;
    hud = document.createElement('div');
    hud.style.cssText =
      'position:absolute;left:12px;top:12px;z-index:60;display:flex;gap:8px;align-items:center;' +
      'font:12px system-ui,sans-serif;color:#fff;';
    btn = document.createElement('button');
    btn.style.cssText =
      'padding:4px 10px;border:0;border-radius:12px;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;';
    statusEl = document.createElement('span');
    statusEl.style.cssText = 'padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.45);';
    statusEl.hidden = true;

    const loadBtn = document.createElement('button');
    loadBtn.style.cssText = btn.style.cssText;
    loadBtn.textContent = 'Load captions';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.srt,.vtt,.json,.json3';
    fileInput.hidden = true;
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        const events = parseCaptionFile(f.name, await f.text());
        if (!events.length) throw new Error('no cues found');
        state.local = { local: true, kind: 'manual', events };
        setStatus(`Loaded ${events.length} caption entries from ${f.name}`);
      } catch (err) {
        setStatus(`Caption file error: ${err.message}`);
      }
    });

    hud.append(btn, loadBtn, fileInput, statusEl);
    player.append(hud);
    btn.addEventListener('click', async () => {
      if (state.active) return stop();
      try {
        await start();
      } catch (err) {
        console.error('[ytd]', err);
        stop();
        // After the extension is reloaded, tabs keep an orphaned copy of this script.
        setStatus(
          /context invalidated/i.test(err.message)
            ? 'Extension was reloaded: reload this tab (F5)'
            : `Error: ${err.message}`,
        );
      }
    });
    setButton(state.active);
  }

  function setButton(on) {
    if (btn) btn.textContent = on ? 'JA dub: on' : 'JA dub: off';
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }

  function updateStatus() {
    const now = performance.now();
    if (now - state.lastStatus < 250) return;
    state.lastStatus = now;
    const mode = state.buffering ? 'buffering' : state.phase;
    setStatus(`${mode} · cue ${state.idx + 1}/${state.cues.length} · ready ${readyAhead().toFixed(0)}s`);
  }

  setInterval(ensureHud, 1000);
  // Leaving the watch page (SPA navigation) invalidates the cues.
  document.addEventListener('yt-navigate-start', () => {
    state.local = null;
    if (state.active) stop();
  });
})();
