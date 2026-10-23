// Runs in the page's MAIN world so it can reach the YouTube player API.
// The isolated-world content script talks to it through window.postMessage.
(() => {
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'ytd:get-captions') return;
    const { reqId, lang } = e.data;
    const reply = (payload) => window.postMessage({ type: 'ytd:captions', reqId, ...payload }, '*');
    try {
      const player = document.getElementById('movie_player');
      const resp = player?.getPlayerResponse?.() ?? window.ytInitialPlayerResponse;
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (!tracks.length) throw new Error('This video has no caption tracks');

      // Prefer a human-made track in the requested language, then any human-made track, then ASR.
      const track =
        tracks.find((t) => t.languageCode === lang && t.kind !== 'asr') ??
        tracks.find((t) => t.kind !== 'asr') ??
        tracks[0];

      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', 'json3');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Caption fetch failed: HTTP ${res.status}`);
      const text = await res.text();
      if (!text) throw new Error('Caption fetch returned an empty body');
      const json = JSON.parse(text);

      reply({
        videoId: resp.videoDetails?.videoId,
        languageCode: track.languageCode,
        kind: track.kind ?? 'manual',
        events: json.events ?? [],
      });
    } catch (err) {
      reply({ error: String(err?.message ?? err) });
    }
  });
})();
