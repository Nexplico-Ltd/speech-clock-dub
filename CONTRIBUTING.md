# Contributing to speech-clock-dub

Thanks for your interest! Bug reports, ideas, documentation fixes, translations and code are all welcome.

## Ways to help

- **Try it on real lectures and report what happens.** The extension has been exercised end to end on
  a small number of videos only. Reports with the details requested in the issue form are the most
  useful contribution right now. The README lists example playlists.
- **Fix or improve the documentation.** `README.md` (English) is the source of truth; the Japanese,
  Korean and Chinese READMEs are translations. Corrections from native speakers are very welcome.
- **Fix a bug or add a feature.** For anything bigger than a small fix, please open an issue first so
  we can agree on the approach before you spend time on it.

## Reporting issues

Use the issue forms; they ask for what is needed to reproduce a problem: the extension version, the
browser, the target language, the TTS provider, the LLM, the kind of captions (manual, auto-generated or
a loaded file) and the `[ytd]` lines from the page console (F12 -> Console).

**Remove API keys and other secrets from anything you paste.**

## Development setup

You need Chrome (or another Chromium browser), Node.js 22 or newer, and Python 3.12 for the edge-tts
bridge. The extension itself has no build step and no runtime dependencies.

1. Clone the repository and load `extension/` as an unpacked extension (`chrome://extensions` ->
   Developer mode -> Load unpacked). Reload the extension **and** the YouTube tab after every change.
2. To run the pipeline you need an OpenAI-compatible LLM endpoint and a TTS server; see
   [Requirements](README.md#requirements) in the README. The edge-tts bridge needs a virtual environment:

   ```
   python3 -m venv .venv && .venv/bin/pip install edge-tts ruff
   ```

## Checks

CI runs the same commands on every push to `main` and on every pull request. Please make them pass
locally first:

```
for f in extension/*.js; do node --check "$f"; done      # syntax check
npm test                                                  # extension unit tests
.venv/bin/ruff check tools tests                          # lint the Python bridge and its tests
.venv/bin/python -m unittest discover -s tests -p "test_*.py"   # bridge unit tests
```

## Code guidelines

- **Keep it dependency-free and build-free.** Plain JavaScript files loaded by `manifest.json`; no
  bundler, no npm packages.
- **Put logic that does not need the browser into pure helper files** (like `extension/asr.js` and
  `extension/subtitle.js`) and test it in `tests/`. `content.js` is hard to test, so keep it thin and
  check changes to it by hand in a browser.
- **A new setting** goes in `extension/defaults.js` (with a comment), gets a dropdown in
  `extension/options.js` if it takes a fixed set of values, and is described in the README. The tests
  check that the defaults and the options page stay consistent.
- **Add or update tests** for the behaviour you change. Bug fixes should come with a test that fails
  without the fix when that is practical.
- **Match the surrounding code** in naming, comment density and style. Comments explain why, not what.
- **Write documentation, code comments and commit messages in English.** The only exceptions are the
  translated READMEs.

## Documentation and translations

When you change `README.md`, update the four translated READMEs (`README.ja.md`, `README.ko.md`,
`README.zh-TW.md`, `README.zh-CN.md`) too, or say in the pull request which ones still need it. Keep the
same structure (headings, tables, code blocks) so the files stay easy to compare. Code blocks and
setting names stay in English.

## Pull requests

- Keep each pull request focused on one change, and describe what changed and why.
- Make sure CI passes and mention how you tested the change in a browser if it touches `content.js`,
  `page-hook.js` or `background.js`.
- Use short, imperative commit messages (for example "Fix caption timeout"), with a body when the
  reason is not obvious.
- Never commit secrets. `.env` is ignored; keep API keys there or in the extension's options page.

## Licensing

The project is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree
that it is licensed under the same terms (section 5 of the license).

The services and models the extension talks to (VOICEVOX and its voice characters, Microsoft's online
speech service behind edge-tts, and the LLM you run) have their own terms. If you share dubbed videos
made with this tool, check them first and respect the rights of the original video's authors.
