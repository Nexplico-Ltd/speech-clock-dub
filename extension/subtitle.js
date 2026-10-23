// Pure helpers for the on-screen subtitle: splitting a long text into pages that fit a line limit
// and choosing the page to show as the speech progresses. No DOM access: the caller supplies
// `fits(text)`, which says whether a text fits the allowed number of lines. Loaded before content.js.
const YTD_SUB = (() => {
  const SOFT_BREAK = /[、。，．,.!?！？;；:：…]$/;
  const SENTENCE_END = /[。．.!?！？…]$/;
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

  // Words for spaced languages; Intl.Segmenter also finds word boundaries in Japanese and Chinese.
  const units = (text) => (segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : text.split(/(\s+)/).filter(Boolean));

  // Splits `text` into pages that each satisfy fits(page). A full page is cut at the end of a sentence
  // if one lies in its last 70%, else after a comma-like pause in its last half, else at the last
  // word that fits.
  function paginate(text, fits) {
    text = text.trim();
    if (fits(text)) return [text];
    const pages = [];
    let cur = '';
    let soft = -1; // length of `cur` at its last punctuation
    let hard = -1; // ... and at its last sentence end
    for (const unit of units(text)) {
      if (cur.trim() && !fits((cur + unit).trim())) {
        const cut = hard >= cur.length * 0.3 ? hard : soft >= cur.length * 0.5 ? soft : cur.length;
        pages.push(cur.slice(0, cut).trim());
        cur = cur.slice(cut);
        soft = hard = -1;
      }
      cur += unit;
      if (SOFT_BREAK.test(unit)) soft = cur.length;
      if (SENTENCE_END.test(unit)) hard = cur.length;
    }
    if (cur.trim()) pages.push(cur.trim());
    return pages;
  }

  // The page to show at `progress` (0..1) of the speech, in proportion to the pages' lengths.
  function pageAt(pages, progress) {
    const total = pages.reduce((n, p) => n + p.length, 0) || 1;
    let seen = 0;
    for (let i = 0; i < pages.length; i++) {
      seen += pages[i].length;
      if (progress < seen / total) return i;
    }
    return pages.length - 1;
  }

  return { paginate, pageAt };
})();
