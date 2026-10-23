// Shared default settings. Loaded by the service worker (importScripts),
// the content script and the options page. Stored overrides live in chrome.storage.sync.

// Target languages: how the LLM is told to write, and the default edge-tts voice per gender.
const YTD_LANGS = {
  ja: {
    name: 'Japanese',
    style: 'natural spoken Japanese (polite desu/masu style)',
    voices: { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
    google: { code: 'ja-JP', voices: { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' } },
    // Observed mistranslation: "Welcome back" came out as 「お帰りください」 ("please go home").
    extraRule:
      '"Welcome back" is a greeting to returning viewers: say 「引き続き…へようこそ」 or 「おかえりなさい」, never 「お帰りください」.',
  },
  en: {
    name: 'English',
    style: 'natural spoken English',
    voices: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
    google: { code: 'en-US', voices: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-D' } },
  },
  'zh-TW': {
    name: 'Traditional Chinese',
    style: 'natural spoken Mandarin as used in Taiwan, written in Traditional Chinese characters',
    voices: { female: 'zh-TW-HsiaoChenNeural', male: 'zh-TW-YunJheNeural' },
    google: { code: 'cmn-TW', voices: { female: 'cmn-TW-Wavenet-A', male: 'cmn-TW-Wavenet-B' } },
  },
  'zh-CN': {
    name: 'Simplified Chinese',
    style: 'natural spoken Mandarin as used in mainland China, written in Simplified Chinese characters',
    voices: { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
    google: { code: 'cmn-CN', voices: { female: 'cmn-CN-Wavenet-A', male: 'cmn-CN-Wavenet-B' } },
  },
  ko: {
    name: 'Korean',
    style: 'natural spoken Korean (polite haeyo/hapnida style)',
    voices: { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' },
    google: { code: 'ko-KR', voices: { female: 'ko-KR-Neural2-A', male: 'ko-KR-Neural2-C' } },
  },
};

const YTD_DEFAULTS = {
  targetLang: 'ja', // a key of YTD_LANGS
  voiceGender: 'female', // 'female' | 'male'
  // 'alternate': for dialogue captions that mark a change of speaker ('- ' or '>>'), the voices alternate
  // between voiceGender and the opposite gender. Needs captions with markers (not auto-generated ones).
  speakerVoices: 'off', // 'off' | 'alternate' (captions with "- " / ">>" markers) | 'llm' (experimental: the LLM labels who speaks)
  subtitles: 'off', // on-screen subtitles: 'off' | 'translated' | 'both' (translation + original)
  subtitleMaxLines: 2, // longer text is shown in pages of this many lines; 0 = no limit
  // 'auto' = VOICEVOX for Japanese, edge-tts for every other language. 'google' = Google Cloud
  // Text-to-Speech (a paid online service: the translated text is sent to Google).
  ttsProvider: 'auto', // 'auto' | 'voicevox' | 'edge' | 'google'
  // Per-speaker overrides for dialogues (speakerVoices 'alternate' or 'llm'): slot 1 is the first speaker,
  // slot 2 the second. An empty provider uses ttsProvider; an empty voice uses the defaults below
  // (slot 2 gets the gender opposite to voiceGender). A voice is a VOICEVOX style id, an edge-tts voice
  // name or a Google voice name, matching the provider. Mixing providers is allowed, e.g. two female
  // voices, one from VOICEVOX and one from Google.
  voice1Provider: '', // '' | 'auto' | 'voicevox' | 'edge' | 'google'
  voice1Voice: '',
  voice2Provider: '',
  voice2Voice: '',

  // OpenAI-compatible chat completions endpoint (e.g. the Unsloth service).
  llmBaseUrl: 'http://127.0.0.1:8888/v1',
  llmModel: 'unsloth/gemma-4-12B-it-qat-GGUF',
  llmApiKey: '',
  // JSON merged into every chat completion request. The default turns thinking off: with
  // thinking on, Gemma 4 can spend minutes on a single subtitle line and return no content.
  llmExtraBody: '{"chat_template_kwargs":{"enable_thinking":false}}',
  llmTimeoutSec: 60,

  // VOICEVOX engine.
  voicevoxUrl: 'http://localhost:50021',
  speakerFemale: 2, // VOICEVOX style id (四国めたん ノーマル)
  speakerMale: 11, // VOICEVOX style id (玄野武宏 ノーマル); GET /speakers lists them
  ttsSpeed: 1.25, // speedScale; a faster voice means less slow-down of the video

  // edge-tts bridge (tools/edge_tts_server.py). Empty voice = default for targetLang and voiceGender.
  edgeUrl: 'http://127.0.0.1:5050',
  edgeVoice: '',
  edgeRate: '+0%', // e.g. '+10%' for a faster voice

  // Google Cloud Text-to-Speech (ttsProvider 'google'). Empty voice = default for targetLang and voiceGender.
  googleApiKey: '',
  googleVoice: '',
  googleSpeed: 1.15, // speakingRate, 0.25 to 4

  // Language name given to the LLM when captions come from a local file.
  localCaptionLang: 'English',

  // Auto-generated (ASR) captions have no punctuation. With 'on' the LLM restores it first, so cues
  // end at sentence boundaries; windows overlap and are processed in parallel.
  asrPunctuation: 'on', // 'on' | 'off'
  asrWindowWords: 120,
  asrStrideWords: 108, // neighbouring windows overlap by 12 words
  asrConcurrency: 4, // parallel punctuation requests (nothing else runs while segmenting)

  // Segmentation.
  contextCues: 3, // previous translated cues given to the LLM as context
  maxGapSec: 1.5, // a longer gap between caption fragments ends a sentence
  maxCueChars: 200, // force-flush a sentence beyond this length

  // Buffering (seconds of synthesized audio).
  lowWaterSec: 10, // at a cue boundary, rebuffer if less than this is ready
  highWaterSec: 40, // resume playback once this much is ready
  targetAheadSec: 90, // the producer stops once this much is ready ahead
  concurrency: 3, // cues translated/synthesized in parallel

  // Video rate control.
  minRate: 0.5,
  maxRate: 1.5,
  gapRate: 2, // rate used while crossing long silent gaps between cues
};

// Host permission patterns (port-less, as Chrome requires) for the configured servers that are not on this
// machine and are not already covered by the manifest. The options page asks for them at run time.
function ytdRemoteOrigins(settings) {
  const origins = new Set();
  for (const key of ['llmBaseUrl', 'voicevoxUrl', 'edgeUrl']) {
    let url;
    try {
      url = new URL(settings[key]);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || ['localhost', '127.0.0.1'].includes(url.hostname)) continue;
    origins.add(`${url.protocol}//${url.hostname}/*`);
  }
  return [...origins];
}
