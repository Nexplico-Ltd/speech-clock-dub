# YouTube Dub

A Chrome (MV3) extension that dubs YouTube lecture videos into Japanese, English, Traditional
Chinese, Simplified Chinese or Korean. It is designed for
videos that are essentially slideshows: instead of squeezing the translated speech to fit the
picture, **the picture follows the speech**.

## How it works

```
YouTube captions -> sentence cues -> LLM translation -> TTS (VOICEVOX / edge-tts) -> Web Audio queue
                                                                            |
                              <video> playbackRate / pause / play  <--------+
```

- The synthesized audio is the master clock. The original audio is muted.
- For each cue the video's `playbackRate` is set to `remaining_cue_time / speech_duration`,
  clamped to `[minRate, maxRate]`.
- If the speech outlasts the cue's video segment, the video is paused (frozen slide) until the
  speech ends. If the speech is shorter, the video plays on at a faster rate to the next cue.
- Long silent gaps between cues are crossed at `gapRate`.
- A producer loop translates and synthesizes cues ahead of playback. Translations run in order (each
  sees the previous ones as context); speech synthesis runs up to `concurrency` cues in parallel,
  which matters for cloud TTS where each request takes seconds. At a cue boundary, if less
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
   `speakerFemale` / `speakerMale` are VOICEVOX style ids (`GET /speakers` lists them).

   **VRAM:** each additional VOICEVOX voice loads another model on the GPU. With a 12B LLM that
   reserves nearly all of a 16 GB card (e.g. a very large context window), the first voice may work
   while another one fails with a CUDA out-of-memory error (HTTP 500 on `/synthesis`). Dubbing needs
   only a small LLM context (a few thousand tokens), so lower the context length when loading the
   model. Measured on a 16 GB RTX 4060 Ti with Gemma 4 12B (Q4): at a 262144-token context
   llama-server used 14.2 GB (about 0.5 GB free, male voices failed); at 16384 it used 9.5 GB
   (about 3.9 GB free with VOICEVOX loaded, both voices work) and translation got faster
   (0.5 s -> 0.3 s per sentence).

   Alternatively run VOICEVOX on the CPU (about 0.5x real time per sentence). Omit `--use_gpu` by
   overriding the image's command: `... voicevox_engine:nvidia-latest gosu user
   /opt/voicevox_engine/run --host 0.0.0.0`.

3. **edge-tts bridge** (only for non-Japanese targets, or Japanese if you prefer it over VOICEVOX).
   edge-tts uses Microsoft's online speech service through an unofficial API, so **the translated
   text is sent to Microsoft**, it needs internet access, and it may break if the service changes.
   A small local HTTP bridge exposes it to the extension:

   ```
   python3 -m venv .venv && .venv/bin/pip install edge-tts
   .venv/bin/python tools/edge_tts_server.py        # listens on 127.0.0.1:5050
   ```

   `--port` changes the port (then update `edgeUrl`). Expect 2-3 s per sentence; the parallel
   producer hides this once the buffer has filled, but the first start takes longer than with VOICEVOX.

Only `localhost` / `127.0.0.1` are in `host_permissions`. If your LLM runs on another host, add
it to `host_permissions` in `extension/manifest.json`.

## Target languages

Set `targetLang` in the options page:

| `targetLang` | Language | Default edge-tts voice (female) |
| --- | --- | --- |
| `ja` | Japanese | `ja-JP-NanamiNeural` (VOICEVOX is used by default) |
| `en` | English | `en-US-AriaNeural` |
| `zh-TW` | Traditional Chinese (Taiwan) | `zh-TW-HsiaoChenNeural` |
| `zh-CN` | Simplified Chinese | `zh-CN-XiaoxiaoNeural` |
| `ko` | Korean | `ko-KR-SunHiNeural` |

`voiceGender` (`female` or `male`) picks the voice:

| `targetLang` | female | male |
| --- | --- | --- |
| `ja` (VOICEVOX) | style `2` (四国めたん) | style `11` (玄野武宏) |
| `ja` (edge-tts) | `ja-JP-NanamiNeural` | `ja-JP-KeitaNeural` |
| `en` | `en-US-AriaNeural` | `en-US-GuyNeural` |
| `zh-TW` | `zh-TW-HsiaoChenNeural` | `zh-TW-YunJheNeural` |
| `zh-CN` | `zh-CN-XiaoxiaoNeural` | `zh-CN-YunxiNeural` |
| `ko` | `ko-KR-SunHiNeural` | `ko-KR-InJoonNeural` |

`ttsProvider` is `auto` by default: VOICEVOX for `ja`, edge-tts otherwise. `edgeVoice` overrides the
edge-tts voice (`.venv/bin/edge-tts --list-voices` lists them) and `edgeRate` (e.g. `+10%`) the speed.
To add a language, add an entry to `YTD_LANGS` in `extension/defaults.js`.

## On-screen subtitles

The **Sub** button in the player cycles `off` -> `translated` -> `both` (translation plus the original
line). The choice is saved in the `subtitles` setting (default `off`). The text of the cue being
spoken is shown near the bottom of the player and hidden between cues, while paused-by-the-user it
stays visible. The font scales with the player width, so it also works in fullscreen. It sits above
YouTube's own caption line, so it does not overlap if YouTube captions are switched on.

## Install (development)

1. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `extension/`.
2. Open the extension's options page and adjust the settings.
3. Open a YouTube video that has captions and click **Dub (xx)** at the top left of the player
   (**Sub** toggles the on-screen translation).
   Reload the YouTube tab after every extension reload.

## Files

| File | Role |
| --- | --- |
| `extension/manifest.json` | MV3 manifest |
| `extension/defaults.js` | Default settings shared by all contexts |
| `extension/page-hook.js` | MAIN-world script; fetches caption JSON through the player API |
| `extension/content.js` | Cue building, production loop, playback scheduler, HUD |
| `extension/background.js` | Service worker; LLM, VOICEVOX and edge-tts HTTP bridge |
| `extension/options.html`, `options.js` | Settings UI |
| `tools/edge_tts_server.py` | Local HTTP bridge around `edge-tts` |

## Known limitations / TODO

- Auto-generated (ASR) captions are de-duplicated word by word using absolute word times. This is
  best effort and has not been tested on many real tracks; manual captions work best.
- YouTube may require a PO token for the `timedtext` endpoint, which can make the caption
  fetch return an empty body. In that case use the **Load captions** button to supply an
  SRT / WebVTT / JSON3 file, e.g. one created with
  `yt-dlp --skip-download --write-subs --sub-langs en --convert-subs srt <url>`.
  Set `localCaptionLang` (the *source* language name such as `English`) in the options page. The loaded file
  is dropped when you navigate to another video. Rolling-style auto-caption VTT files are not
  de-duplicated; use manual subtitles for this path.
- Translation is one cue at a time with the previous `contextCues` translations as context.
  Batching and glossary support would improve terminology consistency.
- Only the first caption track matching the preference order is used; there is no language picker.
- Decoded audio for cues more than 4 behind the playhead is freed; seeking back re-synthesizes them.
- No tests yet.

## License

Apache License 2.0, see [LICENSE](LICENSE). This applies to the code in this repository only. The
services and models it talks to have their own terms: VOICEVOX and each of its voice characters,
Microsoft's online speech service behind edge-tts, and the LLM you run (e.g. Gemma). Check them
before publishing dubbed videos.
