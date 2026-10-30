# Chrome Web Store listing

Draft text for the Chrome Web Store developer dashboard. Keep it in sync with `README.md`.

## Name

Speech Clock Dub

## Summary (132 characters at most)

Dubs YouTube and Udemy lectures into Japanese, English, Chinese or Korean with your own LLM and TTS. The video follows the voice.

## Category

Productivity (or Education)

## Description

Speech Clock Dub dubs YouTube videos (and, experimentally, Udemy lectures), mostly slide-based lectures, into Japanese, English, Traditional
Chinese, Simplified Chinese or Korean. Unlike most dubbing tools, the synthesized speech is the master
clock: the extension speeds up, slows down, pauses and resumes the video to follow the voice, so the
slides stay in step with what you hear and the speech never has to be squeezed or cut off.

IMPORTANT: it does not include a translation or speech service. Before it does anything you need:

- by default, your own API keys for Google's Gemini API (translation) and Google Cloud Text-to-Speech
  (voice). Both are paid services with a free quota;
- or, instead, servers that you run: an OpenAI-compatible LLM endpoint (for example the Unsloth service)
  for translation, and VOICEVOX (free, runs locally) for Japanese speech and/or the small edge-tts bridge
  from the project repository for other languages.

Setup instructions: https://github.com/Nexplico-Ltd/speech-clock-dub#setup

Features

- Uses the video's own captions (manual or auto-generated) or a caption file you load (SRT, VTT, JSON3).
- Translates with your own LLM and keeps a running buffer of synthesized speech ahead of playback.
- Optional on-screen translated subtitles.
- Also works on Udemy lectures (experimental): captions come from the lecture's caption file, so you need to
  be signed in and enrolled in the course.
- Optional alternating voices for dialogue, from caption speaker markers or labelled by the LLM
  (experimental).
- Google Cloud Text-to-Speech as the default voice provider (your own API key), or VOICEVOX / edge-tts.
- Everything runs against the services you choose. Out of the box the extension talks only to Google's
  Gemini and Cloud Text-to-Speech APIs, with your own keys; localhost servers are an alternative.

Privacy

The extension has no server and no analytics. The captions of the video you dub, and their translation,
go only to the services you configure: by default Google (Gemini and Cloud Text-to-Speech) with your own
API keys. The optional edge-tts bridge sends translated text to Microsoft's speech service. Full policy:
https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md

Open source (Apache-2.0): https://github.com/Nexplico-Ltd/speech-clock-dub

Not affiliated with YouTube, Udemy or Google. Respect the rights of the video authors and the terms of the
voices you use.

## Single purpose

Dub the YouTube or Udemy video the user is watching into another language, using the user's own translation and
speech services, and keep the video in step with the generated speech.

## Permission justifications

- **`storage`**: saves the user's settings (service addresses, languages, voices, API keys) and a small
  per-video cache of punctuation flags.
- **Host permission `http://localhost/*` and `http://127.0.0.1/*`**: the extension's background service
  worker calls the user's local LLM, VOICEVOX and edge-tts bridge servers.
- **Host permissions `https://generativelanguage.googleapis.com/*` and `https://texttospeech.googleapis.com/*`**:
  the default translation (Gemini) and voice (Google Cloud Text-to-Speech) services. The service worker
  sends the caption text and the translated text there, with the user's own API keys. Nothing is sent
  until the user enters a key and starts a dub.
- **Optional host permissions `http://*/*` and `https://*/*`**: not granted at install. When the user types
  the address of another service (a hosted OpenAI-compatible LLM, or their own LLM / VOICEVOX / edge-tts
  server on another machine, for example a GPU box on the local network) and presses Save, the options page asks Chrome for access to that single host, so
  the user can approve or deny it. No other hosts are requested.
- **Content scripts on `https://www.youtube.com/*` and `https://*.udemy.com/*`**: read the caption track of
  the video being dubbed, control the video's playback rate and pause state, and draw the Dub / Sub buttons
  and subtitles on the player. On Udemy the script also asks udemy.com's own lecture API (same origin, with
  the user's existing session) for the caption file of the lecture being dubbed.
- **Remote code**: none. All code is in the package.

## Data usage disclosures (privacy practices tab)

- Collects: website content (video captions) and, if the user enters them, authentication credentials
  (LLM and Google API keys). Both stay on the user's device or go only to the services the user configures
  (by default Google's Gemini and Cloud Text-to-Speech).
- Not sold, not used for anything unrelated to the single purpose, not used for creditworthiness or
  lending.
- Privacy policy URL: https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md

## Notes for reviewers

The extension needs a translation service and a speech service, so it will not do anything on a clean
profile. To verify it:

1. Install the extension and open its options page.
2. Paste test API keys into `llmApiKey` (Gemini) and `googleApiKey` (Google Cloud Text-to-Speech).
   TODO: create keys restricted to those two APIs with a low quota, and revoke them after the review.
   (Alternatively run an OpenAI-compatible chat server and VOICEVOX locally, set `llmBaseUrl`, `llmModel`
   and `ttsProvider`, as described in the README.)
3. Open a video with captions, for example https://www.youtube.com/watch?v=vif8NQcjVf0, and click
   **Dub (ja)** at the top left of the player.

A screen recording of this flow (video only, no sound) is linked in the "Additional instructions"
field of the dashboard. (TODO: upload it, for example as an unlisted YouTube video, and add the link
before submitting.)

## Assets checklist

- [x] Icons 16 / 48 / 128 px (`extension/icons/`)
- [x] Screenshots, 1280x800 (`docs/store/`)
- [x] Small promo tile, 440x280 (`docs/store/promo-tile.png`, `tools/make_promo.py`)
- [ ] Demo recording for reviewers (recorded locally, not yet uploaded; no sound)
- [ ] Support URL: https://github.com/Nexplico-Ltd/speech-clock-dub/issues
