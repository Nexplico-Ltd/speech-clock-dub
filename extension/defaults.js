// Shared default settings. Loaded by the service worker (importScripts),
// the content script and the options page. Stored overrides live in chrome.storage.sync.
const YTD_DEFAULTS = {
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
  speaker: 2, // VOICEVOX style id
  ttsSpeed: 1.1, // speedScale; a slightly faster voice means less slow-down of the video

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

  // Video rate control.
  minRate: 0.5,
  maxRate: 1.5,
  gapRate: 2, // rate used while crossing long silent gaps between cues
};
