# Privacy policy

Speech Clock Dub is a browser extension that dubs YouTube videos using translation and speech services
that you choose. It has no server of its own, no account system, no analytics and no advertising.

_Last updated: 2026-10-28_

## Summary

- The developers do not receive any data from the extension, and nothing is sent to any server operated
  by the developers.
- The extension sends the captions of the video you dub only to the services whose addresses you
  configure on its options page. With the default settings these are Google's Gemini API (translation)
  and Google Cloud Text-to-Speech (voice), which need your own API keys. You can instead point it at
  servers on your own computer or network.
- It does not read anything on youtube.com other than the caption data and the playback state of the
  video you chose to dub.

## What the extension reads

When you start a dub on a YouTube watch page, the extension reads:

- the caption track of that video (the text and timings), either from the YouTube player or from a
  caption file that you load yourself;
- the video element's playback state, so that it can change the playback rate and pause or resume it.

It does not read your browsing history, your YouTube account, other tabs, cookies or form data.

## Where the data goes

The caption text (and, for translation, nearby captions as context) and the translated text are sent over
HTTP(S) to the services you configure on the options page:

| Setting | Purpose | Default |
| --- | --- | --- |
| LLM base URL | Translation, caption punctuation and speaker labelling | `https://generativelanguage.googleapis.com/v1beta/openai` (Google Gemini) |
| TTS provider | Speech synthesis | Google Cloud Text-to-Speech (`https://texttospeech.googleapis.com`) |
| VOICEVOX URL | Japanese speech synthesis (only if selected) | `http://localhost:50021` |
| edge-tts bridge URL | Speech synthesis for other languages (only if selected) | `http://127.0.0.1:5050` |

The extension's host permissions cover `localhost`, `127.0.0.1`, `generativelanguage.googleapis.com` and
`texttospeech.googleapis.com`. If you enter the address of any other server (for example a hosted LLM
service, or a machine on your local network), the browser asks you to allow the extension to reach that one
host (an optional host permission); you can revoke it at any time. What those services do with the text is
governed by whoever runs them:

- If you use the default Gemini endpoint, the caption text and your Gemini API key are sent to Google and
  are subject to Google's terms and privacy policy. The same applies to any other hosted LLM service you
  configure.
- If you use the Google provider, the translated text and your Google API key are sent directly from the
  extension to Google Cloud Text-to-Speech and are subject to Google's terms and privacy policy.
- The optional edge-tts bridge in this repository (`tools/edge_tts_server.py`) forwards the translated
  text to Microsoft's online speech service to synthesize audio. That text is subject to Microsoft's terms.
- VOICEVOX and a local LLM server run on your own machine and do not send text anywhere on their own.

## What the extension stores

- **Settings**, including the LLM and Google API keys if you enter them, are stored with
  `storage.sync`. If browser sync is enabled for your account, the browser may sync them across your
  signed-in devices. The API keys are stored unencrypted by the extension; use keys with limited scope, or
  leave the field empty for local servers that do not need one.
- **Per-video punctuation flags** for auto-generated captions are cached in `storage.local` so that the
  same video is not processed twice. They contain no caption text.

Nothing else is stored. Translated text and synthesized audio are kept in memory only while the video is
dubbed.

## Your choices

You can clear everything at any time by removing the extension. To keep all data on your own machines, use
only a local LLM server and VOICEVOX. Do not use the default Google services or the edge-tts bridge, which
contacts Microsoft.

## Changes and contact

Changes to this policy are published in this file, and the date above is updated. Questions and reports:
https://github.com/Nexplico-Ltd/speech-clock-dub/issues
