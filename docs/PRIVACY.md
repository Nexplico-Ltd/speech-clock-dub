# Privacy policy

Speech Clock Dub is a browser extension that dubs YouTube videos using servers that you run
yourself. It has no server of its own, no account system, no analytics and no advertising.

_Last updated: 2026-10-23_

## Summary

- The extension does not send any data to the developers or to any third party operated by the developers.
- It sends video captions only to the servers whose addresses you configure in its settings. By default
  these are on your own computer (`localhost` / `127.0.0.1`).
- It does not read anything on youtube.com other than the caption data of the video you chose to dub.

## What the extension reads

When you start a dub on a YouTube watch page, the extension reads:

- the caption track of that video (the text and timings), either from the YouTube player or from a
  caption file that you load yourself;
- the video element's playback state, so that it can change the playback rate and pause or resume it.

It does not read your browsing history, your YouTube account, other tabs, cookies or form data.

## Where the data goes

The caption text (and, for translation, nearby captions as context) is sent over HTTP to the servers you
configure on the options page:

| Setting | Purpose | Default |
| --- | --- | --- |
| LLM base URL | Translation, caption punctuation and speaker labelling | `http://127.0.0.1:8888/v1` |
| VOICEVOX URL | Japanese speech synthesis | `http://localhost:50021` |
| edge-tts bridge URL | Speech synthesis for other languages | `http://127.0.0.1:5050` |
| Google Cloud Text-to-Speech (only if `ttsProvider` is `google`) | Speech synthesis | `https://texttospeech.googleapis.com` |

The extension's host permissions cover `localhost`, `127.0.0.1` and `texttospeech.googleapis.com`. Out of
the box nothing is sent to the last one: it is used only if you set `ttsProvider` to `google`. If you enter
the address of a server on another machine (for example on your local network), Chrome asks you to allow
the extension to reach that one host (optional host permission); you can revoke it at any time. What those servers do with the text is governed by whoever runs them:

- If you point the LLM base URL at a hosted service, the caption text and your API key are sent to that
  service and are subject to its privacy policy.
- The optional edge-tts bridge in this repository (`tools/edge_tts_server.py`) forwards the translated text
  to Microsoft's online speech service to synthesize audio. That text is subject to Microsoft's terms.
- If you choose the Google provider, the translated text and your Google API key are sent directly from
  the extension to Google Cloud Text-to-Speech and are subject to Google's terms and privacy policy.
- VOICEVOX runs locally and does not send text anywhere on its own.

## What the extension stores

- **Settings**, including the LLM and Google API keys if you enter them, are stored with `chrome.storage.sync`. If Chrome
  Sync is enabled for your Google account, Chrome syncs them across your signed-in browsers. The API key
  is stored unencrypted by the extension; use a key with limited scope, or leave the field empty for
  local servers that do not need one.
- **Per-video punctuation flags** for auto-generated captions are cached in `chrome.storage.local` so that
  the same video is not processed twice. They contain no caption text.

Nothing else is stored. Translated text and synthesized audio are kept in memory only while the video is
dubbed.

## Your choices

You can clear everything at any time by removing the extension, or by clearing its storage from
`chrome://extensions`. To keep all data on your computer, use only local servers, do not run the
edge-tts bridge and do not select the Google provider.

## Changes and contact

Changes to this policy are published in this file, and the date above is updated. Questions and reports:
https://github.com/Nexplico-Ltd/speech-clock-dub/issues
