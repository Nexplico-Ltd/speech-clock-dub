# Chrome Web Store listing

Draft text for the Chrome Web Store developer dashboard. Keep it in sync with `README.md`.

## Name

Speech Clock Dub

## Summary (132 characters at most)

Dubs YouTube lectures into Japanese, English, Chinese or Korean with your own LLM and TTS. The video follows the voice.

## Category

Productivity (or Education)

## Description

Speech Clock Dub dubs YouTube videos, mostly slide-based lectures, into Japanese, English, Traditional
Chinese, Simplified Chinese or Korean. Unlike most dubbing tools, the synthesized speech is the master
clock: the extension speeds up, slows down, pauses and resumes the video to follow the voice, so the
slides stay in step with what you hear and the speech never has to be squeezed or cut off.

IMPORTANT: this is a tool for people who can run local servers. It does not include a translation or
speech service. Before it does anything you need:

- an OpenAI-compatible LLM endpoint (for example the Unsloth service, or any compatible local server)
  for translation;
- VOICEVOX (free, runs locally) for Japanese speech, and/or the small edge-tts bridge from the project
  repository for other languages.

Setup instructions: https://github.com/Nexplico-Ltd/speech-clock-dub#requirements

Features

- Uses the video's own captions (manual or auto-generated) or a caption file you load (SRT, VTT, JSON3).
- Translates with your own LLM and keeps a running buffer of synthesized speech ahead of playback.
- Optional on-screen translated subtitles.
- Optional alternating voices for dialogue, from caption speaker markers or labelled by the LLM
  (experimental).
- Everything runs against servers you choose. Out of the box the extension can reach only localhost.

Privacy

The extension has no server and no analytics. Caption text goes only to the servers you configure. The
optional edge-tts bridge sends translated text to Microsoft's speech service, which is stated in the
setup instructions. Full policy:
https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md

Open source (Apache-2.0): https://github.com/Nexplico-Ltd/speech-clock-dub

Not affiliated with YouTube or Google. Respect the rights of the video authors and the terms of the
voices you use.

## Single purpose

Dub the YouTube video the user is watching into another language, using the user's own translation and
speech servers, and keep the video in step with the generated speech.

## Permission justifications

- **`storage`**: saves the user's settings (server addresses, languages, voices) and a small per-video
  cache of punctuation flags.
- **Host permission `http://localhost/*` and `http://127.0.0.1/*`**: the extension's background service
  worker calls the user's local LLM, VOICEVOX and edge-tts bridge servers. No other hosts are requested.
- **Content script on `https://www.youtube.com/*`**: reads the caption track of the video being dubbed,
  controls the video's playback rate and pause state, and draws the Dub / Sub buttons and subtitles on
  the player.
- **Remote code**: none. All code is in the package.

## Data usage disclosures (privacy practices tab)

- Collects: website content (video captions) and, if the user enters one, an authentication
  credential (LLM API key). Both stay on the user's device or go only to the servers the user configures.
- Not sold, not used for anything unrelated to the single purpose, not used for creditworthiness or
  lending.
- Privacy policy URL: https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md

## Notes for reviewers

The extension needs local servers, so it will not do anything on a clean machine. To verify it:

1. Install the extension and open its options page.
2. Run an OpenAI-compatible server (for example Ollama or llama.cpp's `llama-server`) and set
   `llmBaseUrl` (ending in `/v1`) and `llmModel`.
3. Run VOICEVOX: `docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest`.
4. Open a video with captions, for example https://www.youtube.com/watch?v=vif8NQcjVf0, and click
   **Dub (ja)** at the top left of the player.

A short screen recording of this flow is linked in the "Additional instructions" field of the dashboard.
(TODO: record it and add the link before submitting.)

## Assets checklist

- [x] Icons 16 / 48 / 128 px (`extension/icons/`)
- [x] Screenshots, 1280x800 (`docs/store/`)
- [x] Small promo tile, 440x280 (`docs/store/promo-tile.png`, `tools/make_promo.py`)
- [ ] Demo recording for reviewers
- [ ] Support URL: https://github.com/Nexplico-Ltd/speech-clock-dub/issues
