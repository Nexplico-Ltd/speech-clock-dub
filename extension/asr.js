// Helpers for auto-generated (ASR) captions. Pure functions: no chrome.* or DOM access, so they
// can be unit tested. Loaded before content.js.
//
// ASR captions carry no punctuation, so sentence boundaries are unknown. The content script asks
// the LLM to restore punctuation window by window; these helpers flatten the captions, plan the
// windows, check the model's answer against the original words, and cut cues at sentence ends.
const YTD_ASR = (() => {
  const MIN_SENTENCE_WORDS = 3;
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  // Non-speech annotations in captions: "[Music]", "[Applause]", "(upbeat music)", "♪". Dubbing them would
  // make the voice read "music" aloud. Square brackets are removed whatever they hold; round brackets only
  // when they name a sound, so "(a + b)" and "(see Figure 2)" stay. Note symbols go, the lyrics next to
  // them stay.
  const SOUND_WORDS =
    'music|applause|laughter|laughs|laughing|cheering|cheers|clapping|singing|silence|sighs|coughs|' +
    'inaudible|crosstalk|chatter|beeping|bell|sound';
  const ANNOTATION = new RegExp(`\\[[^\\]]{0,60}\\]|\\([^()]{0,30}\\b(?:${SOUND_WORDS})\\b[^()]{0,30}\\)|[♪♫♬]+`, 'giu');
  const stripSounds = (text) => text.replace(ANNOTATION, ' ').replace(/\s+/g, ' ').trim();

  // YouTube's ASR json3 repeats words across events; flatten to words with absolute start times and
  // keep each word once (start times must strictly increase). A word ends when the next one starts,
  // or 0.8 s after it began.
  function words(events) {
    const out = [];
    let last = -1;
    for (const e of events) {
      if (!e.segs) continue;
      for (const s of e.segs) {
        const text = stripSounds(s.utf8);
        if (!text) continue;
        const start = (e.tStartMs + (s.tOffsetMs ?? 0)) / 1000;
        if (start <= last) continue;
        last = start;
        out.push({ start, text });
      }
    }
    return out.map((w, i) => ({
      start: w.start,
      end: Math.min(out[i + 1]?.start ?? Infinity, w.start + 0.8),
      text: w.text,
    }));
  }

  // Windows of `size` words advancing by `stride`; the last one ends at n. Neighbours overlap by
  // size - stride words, and each window is trusted only away from its edges (see trusted()).
  function windows(n, size, stride) {
    if (n <= size) return [{ from: 0, to: n }];
    const out = [];
    for (let from = 0; ; from += stride) {
      const to = Math.min(n, from + size);
      out.push({ from, to });
      if (to === n) break;
    }
    return out;
  }

  // The part of window k (of `count`) whose punctuation is used: all but `margin` words at each
  // inner edge. These ranges tile [0, n) exactly.
  function trusted(win, k, count, margin) {
    return {
      lo: k === 0 ? win.from : win.from + margin,
      hi: k === count - 1 ? win.to : win.to - margin,
    };
  }

  // Compares the model's punctuated text with the original words. Returns one { end, clause } flag
  // per word (end: a sentence ends after it; clause: a comma-like pause follows), or null when the
  // model changed too many words to trust the alignment. The model often joins words with a hyphen
  // ("gate source" -> "gate-source"), so one token may stand for up to three consecutive words.
  function align(inputWords, text) {
    const tokens = [];
    for (const tok of text.split(/\s+/).filter(Boolean)) {
      if (norm(tok) === '' && tokens.length) tokens[tokens.length - 1] += tok; // lone "-" or "..."
      else tokens.push(tok);
    }
    const none = () => ({ end: false, clause: false });
    const normed = inputWords.map(norm);
    const limit = Math.max(2, inputWords.length * 0.05);
    const flags = [];
    let ti = 0;
    let wi = 0;
    let skipped = 0;
    while (wi < inputWords.length) {
      if (normed[wi] === '') {
        flags.push(none());
        wi++;
        continue;
      }
      let hit = null; // { at: token index, take: number of words it covers }
      for (let k = 0; k < 3 && ti + k < tokens.length && !hit; k++) {
        const t = norm(tokens[ti + k]);
        let joined = '';
        for (let take = 1; take <= 3 && wi + take <= inputWords.length && joined.length < t.length + 1; take++) {
          joined += normed[wi + take - 1];
          if (joined === t) {
            hit = { at: ti + k, take };
            break;
          }
        }
      }
      if (!hit) {
        // The model dropped or altered this word: tolerate a few, then give up on the window.
        if (++skipped > limit) return null;
        flags.push(none());
        wi++;
        continue;
      }
      skipped += hit.at - ti; // extra tokens the model inserted
      const tail = tokens[hit.at].replace(/["'”’)\]]+$/u, '');
      for (let j = 1; j < hit.take; j++) flags.push(none());
      flags.push({ end: /[.!?…。！？]$/u.test(tail), clause: /[,;:—–-]$/u.test(tail) });
      ti = hit.at + 1;
      wi += hit.take;
    }
    return skipped > limit ? null : flags;
  }

  // Compact text form of the per-word flags for caching: e = sentence end, c = clause, . = none,
  // ? = unknown.
  const encodeFlags = (flags) => flags.map((f) => (!f ? '?' : f.end ? 'e' : f.clause ? 'c' : '.')).join('');
  const decodeFlags = (str) =>
    [...str].map((ch) => (ch === 'e' ? { end: true, clause: false } : ch === 'c' ? { end: false, clause: true } : ch === '.' ? { end: false, clause: false } : null));

  // Cuts words into cues at sentence ends. flags[i] is null where punctuation is unknown, in which
  // case only the gap and length rules apply. A cue that gets too long without a sentence end is cut
  // at its last clause boundary or pause, if that leaves a reasonable part, else where it is.
  function cues(allWords, flags, { maxGapSec, maxCueChars }) {
    const out = [];
    const cur = [];
    let soft = 0; // words of `cur` up to the last clause boundary or pause
    const flush = (n = cur.length) => {
      if (!n) return;
      const part = cur.splice(0, n);
      out.push({ start: part[0].start, end: part.at(-1).end, text: part.map((w) => w.text).join(' ') });
      soft = 0;
    };
    const charsOf = (n) => cur.slice(0, n).reduce((sum, w) => sum + w.text.length + 1, 0);

    allWords.forEach((w, i) => {
      if (cur.length && w.start - cur.at(-1).end > maxGapSec) flush();
      cur.push(w);
      const next = allWords[i + 1];
      if (flags[i]?.clause || (next && next.start - w.start >= 0.6)) soft = cur.length;
      // A one- or two-word "sentence" ("so.", "okay.") is merged into the next one. Where punctuation
      // is known the length limit is relaxed, since real sentences are rarely cut at their end.
      if (flags[i]?.end && cur.length >= MIN_SENTENCE_WORDS) return flush();
      const limit = flags[i] ? maxCueChars * 1.5 : maxCueChars;
      if (charsOf(cur.length) >= limit) flush(soft > 0 && charsOf(soft) >= limit * 0.4 ? soft : cur.length);
    });
    flush();
    return out;
  }

  return { stripSounds, words, windows, trusted, align, encodeFlags, decodeFlags, cues };
})();
