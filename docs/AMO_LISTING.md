# Firefox Add-ons (AMO) listing

Draft text for the addons.mozilla.org developer hub. Keep it in sync with `README.md`. The Chrome Web
Store equivalent is `STORE_LISTING.md`.

## Name

Speech Clock Dub

## Summary (250 characters at most)

Dubs YouTube lectures into Japanese, English, Chinese or Korean with your own LLM and TTS. The video follows the voice, not the other way around. Works on Firefox for desktop and Android.

## Categories

Language Support, Social & Communication (or Other). Tags: youtube, dubbing, translation, tts, lecture.

## Description

Speech Clock Dub dubs YouTube videos, mostly slide-based lectures, into Japanese, English, Traditional
Chinese, Simplified Chinese or Korean. Unlike most dubbing tools, the synthesized speech is the master
clock: the extension speeds up, slows down, pauses and resumes the video to follow the voice, so the
slides stay in step with what you hear and the speech never has to be squeezed or cut off.

IMPORTANT: it needs a translation service and a speech service that you provide. By default these are
Google's Gemini API and Google Cloud Text-to-Speech, which need your own API keys and are paid services
with a free quota. You can instead use a local OpenAI-compatible LLM server and VOICEVOX (free, local) for
Japanese, or the small edge-tts bridge from the project repository for other languages.
Setup: https://github.com/Nexplico-Ltd/speech-clock-dub#setup

Features

- Uses the video's own captions (manual or auto-generated) or a caption file you load (SRT, VTT, JSON3).
- Translates with your LLM and keeps a running buffer of synthesized speech ahead of playback.
- Optional on-screen translated subtitles, with the original text if you like.
- Optional alternating voices for dialogue (experimental).
- Works on Firefox for Android (m.youtube.com): touch-sized buttons that hide after a few idle seconds.

Privacy

The extension has no server and no analytics. The captions of the video you dub, and their translation,
go only to the services you configure: by default Google (Gemini and Cloud Text-to-Speech) with your own
API keys. Full policy:
https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md

Open source (Apache-2.0): https://github.com/Nexplico-Ltd/speech-clock-dub

Not affiliated with YouTube or Google. Respect the rights of the video authors and the terms of the
services you use.

## Other fields

- Support site: https://github.com/Nexplico-Ltd/speech-clock-dub
- Support email: TODO (a public address of your choice)
- License: Apache License 2.0
- Privacy policy: https://github.com/Nexplico-Ltd/speech-clock-dub/blob/main/docs/PRIVACY.md
- Screenshots: `docs/store/screenshot-dubbing.png`, `docs/store/screenshot-options.png`. A phone
  screenshot of Firefox for Android is recommended.
- Version to submit: the next unused version (0.8.1 and 0.8.2 were signed as unlisted and cannot be
  reused).

## Data collection (manifest)

`browser_specific_settings.gecko.data_collection_permissions.required` is `["websiteContent"]`: the
caption text of the video the user dubs is sent to the services the user configures. Nothing is
collected by the developers.

## Permission justifications

- **`storage`**: saves the user's settings (service addresses, languages, voices, API keys) and a small
  per-video cache of punctuation flags.
- **Host permissions `http://localhost/*`, `http://127.0.0.1/*`**: the background script calls the
  user's local LLM, VOICEVOX and edge-tts bridge servers.
- **Host permissions `https://generativelanguage.googleapis.com/*`, `https://texttospeech.googleapis.com/*`**:
  the default translation (Gemini) and voice (Google Cloud Text-to-Speech) services. The user's API keys
  are sent only to these hosts.
- **Optional host permissions `http://*/*`, `https://*/*`**: not granted at install. When the user enters
  the address of another service (a hosted OpenAI-compatible LLM, or a server on the local network) and
  presses Save, the options page asks for access to that single host.
- **Content scripts on `https://www.youtube.com/*` and `https://m.youtube.com/*`**: one runs in the page
  context (`world: "MAIN"`) to read the caption tracks from the YouTube player; the other reads the
  playback state, controls the video's playback rate and pause state, and draws the Dub / Sub buttons and
  the subtitles on the player.
- **Remote code**: none. All code is in the package.

## Notes to reviewers

**Source code.** The submitted zip is the `extension/` directory of the repository, unmodified. There is
no build step, no bundler, no minification and no third-party library. The same source is at
https://github.com/Nexplico-Ltd/speech-clock-dub (tag `v<submitted version>`). `eval`, `innerHTML` and
dynamically loaded code are not used. The only `importScripts` call loads `defaults.js` from the package.

**Why a page-context script.** `page-hook.js` runs in the `MAIN` world because YouTube answers
caption requests that lack the player's own proof-of-origin token with an empty body. The script reads the
player's caption track list and listens to the player's own caption responses. It only reads data, and
passes it to the extension's content script with `window.postMessage`.

**Why a Gecko ID and `background.scripts`.** One manifest serves Chrome (`service_worker`) and Firefox
(`scripts`). The ID is `speech-clock-dub@nexplico-ltd.github.io`; the minimum version is Firefox 140 (142 on Android).

**How to test.** The extension needs a translation service and a speech service, so it does nothing on a
clean profile. Two ways to see it work:

1. Hosted (default). Open the add-on's preferences and paste the API keys below into `llmApiKey` (Gemini)
   and `googleApiKey` (Google Cloud Text-to-Speech). Then open a video with captions, for example
   https://www.youtube.com/watch?v=vif8NQcjVf0, and click **Dub (ja)** at the top left of the player.
   Keys for testing: TODO (create keys restricted to those two APIs with a low quota, and revoke them
   after the review).
2. Without keys the options page and the Dub / Sub / Load captions buttons can be inspected, but dubbing
   itself needs both services. A local LLM server and VOICEVOX also work (see the README), if the reviewer
   prefers not to use keys.

**Firefox for Android.** The HUD is mounted next to the touch controls of m.youtube.com and hides after
a few idle seconds on touch screens. It can be tried in a desktop Firefox with a touch-sized window; the
mobile behavior needs a phone.

## Checklist before submitting

- [ ] Bump the version (0.8.3 or later) and run `npm test`.
- [ ] Build the zip from `extension/` only (no `.env`, no `.amo-upload-uuid`).
- [ ] Choose "On this site" (listed) in the developer hub.
- [ ] Fill in the support email and create the temporary reviewer API keys (above).
- [ ] Upload screenshots (desktop and phone).
