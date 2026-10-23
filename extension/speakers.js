// Pure helpers for dialogue captions: many captions mark a change of speaker with a leading "- " or
// ">>". Names are not given, so the voices simply alternate at each change. No DOM access.
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

  return { split, assign };
})();
