// Shared default settings. Loaded by the service worker (importScripts),
// the content script and the options page. Stored overrides live in chrome.storage.sync.

// Target languages: how the LLM is told to write, and the default edge-tts voice per gender.
const YTD_LANGS = {
  ja: {
    name: 'Japanese',
    style: 'natural spoken Japanese (polite desu/masu style)',
    voices: { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
    // Observed mistranslation: "Welcome back" came out as 「お帰りください」 ("please go home").
    extraRule:
      '"Welcome back" is a greeting to returning viewers: say 「引き続き…へようこそ」 or 「おかえりなさい」, never 「お帰りください」.',
  },
  en: { name: 'English', style: 'natural spoken English', voices: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' } },
  'zh-TW': {
    name: 'Traditional Chinese',
    style: 'natural spoken Mandarin as used in Taiwan, written in Traditional Chinese characters',
    voices: { female: 'zh-TW-HsiaoChenNeural', male: 'zh-TW-YunJheNeural' },
  },
  'zh-CN': {
    name: 'Simplified Chinese',
    style: 'natural spoken Mandarin as used in mainland China, written in Simplified Chinese characters',
    voices: { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
  },
  ko: {
    name: 'Korean',
    style: 'natural spoken Korean (polite haeyo/hapnida style)',
    voices: { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' },
  },
};

const YTD_DEFAULTS = {
  targetLang: 'ja', // a key of YTD_LANGS
  voiceGender: 'female', // 'female' | 'male'
  // 'auto' = VOICEVOX for Japanese, edge-tts for every other language.
  ttsProvider: 'auto', // 'auto' | 'voicevox' | 'edge'

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
  ttsSpeed: 1.1, // speedScale; a slightly faster voice means less slow-down of the video

  // edge-tts bridge (tools/edge_tts_server.py). Empty voice = default for targetLang and voiceGender.
  edgeUrl: 'http://127.0.0.1:5050',
  edgeVoice: '',
  edgeRate: '+0%', // e.g. '+10%' for a faster voice

  // Language name given to the LLM when captions come from a local file.
  localCaptionLang: 'English',

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
