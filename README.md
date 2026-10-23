# YouTube Japanese Dub

A Chrome (MV3) extension that dubs YouTube lecture videos into Japanese. It is designed for
videos that are essentially slideshows: instead of squeezing the translated speech to fit the
picture, **the picture follows the speech**.

## How it works

```
YouTube captions -> sentence cues -> LLM translation -> VOICEVOX TTS -> Web Audio queue
                                                                            |
                              <video> playbackRate / pause / play  <--------+
```

- The synthesized audio is the master clock. The original audio is muted.
- For each cue the video's `playbackRate` is set to `remaining_cue_time / speech_duration`,
  clamped to `[minRate, maxRate]`.
- If the speech outlasts the cue's video segment, the video is paused (frozen slide) until the
  speech ends. If the speech is shorter, the video plays on at a faster rate to the next cue.
- Long silent gaps between cues are crossed at `gapRate`.
- A producer loop translates and synthesizes cues ahead of playback. At a cue boundary, if less
  than `lowWaterSec` of audio is ready, the video pauses and resumes only once `highWaterSec`
  is ready (hysteresis). Because the video is the slave, an underflow never causes desync; it
  only pauses the video. Playback is never interrupted in the middle of a sentence.
- User pause/play pauses/resumes the audio too; a user seek re-syncs the cue index.
  Ads are detected (`.ad-showing`) and suspend the scheduler.

## Requirements

1. **An OpenAI-compatible LLM endpoint** (e.g. the Unsloth service) serving a Gemma 12B-class
   model. Set `llmBaseUrl` (the URL that ends in `/v1`) and `llmModel` in the options page.
   The extension calls `POST {llmBaseUrl}/chat/completions`.
2. **VOICEVOX engine** (open source, high-quality Japanese TTS):

   ```
   # GPU (requires nvidia-container-toolkit). The image's default command already passes
   # --use_gpu --host 0.0.0.0, so do not append arguments: they would replace that command.
   docker run -d --rm --name voicevox --gpus all -p 50021:50021 voicevox/voicevox_engine:nvidia-latest
   # CPU only
   docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
   ```

   VOICEVOX needs roughly 1-2 GB of VRAM, so it can share a 16 GB GPU with a 12B LLM.

   Each voice character has its own terms of use; check them before publishing dubbed videos.
   `speaker` is the VOICEVOX style id (`GET /speakers` lists them).

Only `localhost` / `127.0.0.1` are in `host_permissions`. If your LLM runs on another host, add
it to `host_permissions` in `extension/manifest.json`.

## Install (development)

1. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `extension/`.
2. Open the extension's options page and adjust the settings.
3. Open a YouTube video that has captions and click **JA dub** at the top left of the player.

## Files

| File | Role |
| --- | --- |
| `extension/manifest.json` | MV3 manifest |
| `extension/defaults.js` | Default settings shared by all contexts |
| `extension/page-hook.js` | MAIN-world script; fetches caption JSON through the player API |
| `extension/content.js` | Cue building, production loop, playback scheduler, HUD |
| `extension/background.js` | Service worker; LLM and VOICEVOX HTTP bridge |
| `extension/options.html`, `options.js` | Settings UI |

## Known limitations / TODO

- Auto-generated (ASR) captions are de-duplicated word by word using absolute word times. This is
  best effort and has not been tested on many real tracks; manual captions work best.
- YouTube may require a PO token for the `timedtext` endpoint, which can make the caption
  fetch return an empty body. In that case use the **Load captions** button to supply an
  SRT / WebVTT / JSON3 file, e.g. one created with
  `yt-dlp --skip-download --write-subs --sub-langs en --convert-subs srt <url>`.
  Set `localCaptionLang` (a language name such as `English`) in the options page. The loaded file
  is dropped when you navigate to another video. Rolling-style auto-caption VTT files are not
  de-duplicated; use manual subtitles for this path.
- Translation is one cue at a time with the previous `contextCues` translations as context.
  Batching and glossary support would improve terminology consistency.
- Only the first caption track matching the preference order is used; there is no language picker.
- Decoded audio for cues more than 4 behind the playhead is freed; seeking back re-synthesizes them.
- No tests yet.
