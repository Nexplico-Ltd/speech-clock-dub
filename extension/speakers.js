// Pure helpers for dialogue captions: many captions mark a change of speaker with a leading "- " or
// ">>". Names are not given, so the voices simply alternate at each change. Captions without markers
// can be labelled by an LLM instead (experimental). No DOM access.
// Loaded before content.js.
const YTD_SPK = (() => {
  // A marker at the start of a line, or ">>" inside a line.
  const MARK = /(?:^|\n)\s*(?:[-–—]\s|>>+\s*)|\s+>>+\s*/;

  // Splits caption fragments {start, end, text} at speaker markers, drops the markers and flags each
  // fragment that starts a new turn. A fragment holding several turns is divided by text length.
  function split(frags) {
    const out = [];
    for (const f of frags) {
      const pieces = f.text
        .split(MARK)
        .map((p, k) => ({ text: p.replace(/\s+/g, ' ').trim(), turn: k > 0 }))
        .filter((p) => p.text);
      const total = pieces.reduce((n, p) => n + p.text.length, 0) || 1;
      let at = f.start;
      for (const p of pieces) {
        const end = at + ((f.end - f.start) * p.text.length) / total;
        out.push({ start: at, end, text: p.text, turn: p.turn });
        at = end;
      }
    }
    return out;
  }

  // Sets cue.voice to 0 or 1: the first cue is voice 0 and every cue flagged `turn` switches voice.
  function assign(cues) {
    let voice = 0;
    cues.forEach((c, i) => {
      if (i > 0 && c.turn) voice = 1 - voice;
      c.voice = voice;
    });
    return cues;
  }

  // ---- LLM labelling for captions without markers (speakerVoices 'llm') ----

  const WINDOW = 15; // cues labelled per request; smaller windows measured better than larger ones
  const CONTEXT = 6; // already-labelled cues shown before each window
  const LABELS = ['H', 'G']; // host = voice 0, guest = voice 1

  const clip = (t) => (t.length > 300 ? '\u2026' + t.slice(-300) : t);

  // `lines`: texts to label; `context`: [{text, voice}] for the cues just before them.
  function labelPrompt(lines, context) {
    const earlier = context.length
      ? context.map((c) => `[${LABELS[c.voice]}] ${clip(c.text)}`).join('\n')
      : '(start of the conversation)';
    return (
      'Below is a transcript of a two-person conversation: an interviewer (host) and a guest, split into ' +
      'numbered lines without speaker names. Label each line "H" (host) or "G" (guest). The host asks ' +
      'questions, introduces topics, gives short reactions ("Right.", "Wow.", "That\'s amazing."), and ' +
      'sometimes summarizes or comments briefly. The guest gives the long explanations and answers. Keep ' +
      'the labels consistent with the already-labelled context.\n\n' +
      `Earlier lines (context, not to be answered):\n${earlier}\n\n` +
      `Lines to answer:\n${lines.map((t, k) => `${k + 1}. ${clip(t)}`).join('\n')}\n\n` +
      `Reply with exactly ${lines.length} lines in the form "<number>: <H or G>", nothing else.`
    );
  }

  // Returns an array of n voices (0 or 1), or null when the reply does not label every line.
  function parseLabels(reply, n) {
    const got = {};
    for (const line of String(reply).split('\n')) {
      const m = line.match(/^\W*(\d+)\W+\s*([HG])\b/i);
      if (m) got[+m[1]] = LABELS.indexOf(m[2].toUpperCase());
    }
    const out = [];
    for (let k = 1; k <= n; k++) {
      if (got[k] === undefined) return null;
      out.push(got[k]);
    }
    return out;
  }

  // True when the labels look like one person talking: with enough lines, almost all of them agree. The
  // prompt assumes a conversation, so a lecture would otherwise get a made-up host and guest.
  function isMonologue(voices) {
    if (voices.length < 20) return false;
    const guest = voices.filter((v) => v === 1).length;
    return Math.min(guest, voices.length - guest) / voices.length <= 0.1;
  }

  return { split, assign, labelPrompt, parseLabels, isMonologue, WINDOW, CONTEXT };
})();
