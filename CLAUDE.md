# Project instructions

## Communication

- Always reply to the user in Japanese, regardless of the language the user writes in.
- All documentation (README, CLAUDE.md, docs/), code comments, and commit messages must be written in plain English.

## Project

Chrome MV3 extension that dubs YouTube lecture videos (mostly static slides) into Japanese.
The synthesized speech is the master clock; the video is the slave. The extension adjusts
`playbackRate` and pauses/resumes the `<video>` element to follow the speech, never the other way around.

Pipeline: YouTube captions -> sentence segmentation -> local LLM translation (OpenAI-compatible endpoint)
-> VOICEVOX Japanese TTS -> Web Audio queue with high/low watermarks.

## Layout

- `extension/manifest.json` - MV3 manifest
- `extension/defaults.js` - shared default settings (loaded by background, content script and options page)
- `extension/page-hook.js` - runs in the page's MAIN world; reads caption tracks from the YouTube player
- `extension/content.js` - captions -> cues, production loop, playback scheduler, HUD
- `extension/background.js` - service worker; bridges to the LLM and TTS HTTP servers
- `extension/options.html`, `extension/options.js` - settings UI
