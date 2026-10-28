// Runs in the page's MAIN world so it can reach the YouTube player API.
// The isolated-world content script talks to it through window.postMessage.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // YouTube rejects timedtext requests that lack the player's proof-of-origin token and answers
  // with an empty body. The player's own requests are valid, so remember their responses.
  const captured = new Map(); // `${videoId}|${lang}` -> response text
  const stats = { requests: 0, empty: 0 }; // for the error message when nothing usable arrives
  function record(url, text) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.endsWith('/api/timedtext')) return;
      stats.requests++;
      if (!text) {
        stats.empty++;
        return;
      }
      captured.set(`${u.searchParams.get('v')}|${u.searchParams.get('lang')}`, text);
    } catch {}
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = String(args[0]?.url ?? args[0]);
    if (url.includes('/api/timedtext')) res.clone().text().then((t) => record(url, t), () => {});
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ytdUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__ytdUrl?.includes('/api/timedtext')) {
      this.addEventListener('load', () => {
        if (this.responseType === '' || this.responseType === 'text') record(this.__ytdUrl, this.responseText);
      });
    }
    return origSend.apply(this, args);
  };

  // Ask the player to load the track, then wait for its own request to be captured.
  async function viaPlayer(track, videoId) {
    const key = `${videoId}|${track.languageCode}`;
    // The player may have loaded this track already (e.g. captions were switched on).
    if (captured.has(key)) return captured.get(key);
    const player = document.getElementById('movie_player') ?? document.querySelector('.html5-video-player');
    const ccBtn = document.querySelector('.ytp-subtitles-button');
    const wasOn = ccBtn?.getAttribute('aria-pressed') === 'true';
    // m.youtube.com only loads the captions module once the video has started (-1 unstarted, 5 cued).
    const startedHere = [-1, 5].includes(player?.getPlayerState?.());
    if (startedHere) player.playVideo?.();
    const request = () => {
      player?.loadModule?.('captions');
      player?.setOption?.('captions', 'track', { languageCode: track.languageCode });
    };
    request();
    for (let i = 0; i < 40 && !captured.has(key); i++) {
      await sleep(250);
      // No request after 3 s: force the player to load the track again.
      if (i === 12 && !captured.has(key)) {
        player?.unloadModule?.('captions');
        request();
      }
    }
    if (startedHere) player.pauseVideo?.();
    // Leave the player's caption state as we found it.
    if (!wasOn && ccBtn?.getAttribute('aria-pressed') === 'true') ccBtn.click();
    return captured.get(key) ?? '';
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'ytd:get-captions') return;
    const { reqId, lang } = e.data;
    const reply = (payload) => window.postMessage({ type: 'ytd:captions', reqId, ...payload }, '*');
    try {
      const player = document.getElementById('movie_player') ?? document.querySelector('.html5-video-player');
      const resp = player?.getPlayerResponse?.() ?? window.ytInitialPlayerResponse;
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (!tracks.length) throw new Error('This video has no caption tracks');
      const videoId = resp.videoDetails?.videoId;

      // Prefer a human-made track in the requested language, then any human-made track, then ASR.
      const track =
        tracks.find((t) => t.languageCode === lang && t.kind !== 'asr') ??
        tracks.find((t) => t.kind !== 'asr') ??
        tracks[0];

      // m.youtube.com gives a relative path here.
      const url = new URL(track.baseUrl, location.href);
      url.searchParams.set('fmt', 'json3');
      const res = await fetch(url);
      let text = res.ok ? await res.text() : '';
      if (!text) text = await viaPlayer(track, videoId);
      if (!text) {
        throw new Error(
          `Caption fetch returned an empty body (${stats.requests} caption requests seen, ${stats.empty} empty)`,
        );
      }
      if (!text.trimStart().startsWith('{')) throw new Error('Captions are not in JSON3 format');
      const json = JSON.parse(text);

      reply({
        videoId,
        languageCode: track.languageCode,
        kind: track.kind ?? 'manual',
        events: json.events ?? [],
      });
    } catch (err) {
      reply({ error: String(err?.message ?? err) });
    }
  });
})();
