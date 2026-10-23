"""Tests for tools/edge_tts_server.py with edge-tts replaced by a fake."""
import asyncio
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import edge_tts  # noqa: E402
import edge_tts_server  # noqa: E402


class FakeCommunicate:
    """Fails `failures` times with an EdgeTTSException, then yields audio."""

    failures = 0
    calls = 0

    def __init__(self, text, voice, rate="+0%"):
        self.text, self.voice, self.rate = text, voice, rate
        type(self).calls += 1

    async def stream(self):
        if type(self).calls <= type(self).failures:
            raise edge_tts.exceptions.NoAudioReceived("no audio")
        yield {"type": "WordBoundary", "offset": 0}
        yield {"type": "audio", "data": b"ID3"}
        yield {"type": "audio", "data": b"mp3"}


class ServerTest(unittest.TestCase):
    def setUp(self):
        FakeCommunicate.failures = 0
        FakeCommunicate.calls = 0
        self._orig = edge_tts_server.edge_tts.Communicate
        edge_tts_server.edge_tts.Communicate = FakeCommunicate
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), edge_tts_server.Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        edge_tts_server.edge_tts.Communicate = self._orig

    def post(self, path, payload):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, res.headers.get("Content-Type"), res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers.get("Content-Type"), err.read()

    def test_returns_only_the_audio_chunks(self):
        status, ctype, body = self.post("/tts", {"text": "hi", "voice": "en-US-AriaNeural"})
        self.assertEqual((status, ctype, body), (200, "audio/mpeg", b"ID3mp3"))

    def test_retries_when_the_service_returns_no_audio(self):
        FakeCommunicate.failures = 2
        status, _, body = self.post("/tts", {"text": "hi", "voice": "v"})
        self.assertEqual((status, body), (200, b"ID3mp3"))
        self.assertEqual(FakeCommunicate.calls, 3)

    def test_gives_up_after_three_attempts(self):
        FakeCommunicate.failures = 99
        status, ctype, body = self.post("/tts", {"text": "hi", "voice": "v"})
        self.assertEqual((status, ctype), (502, "application/json"))
        self.assertIn("edge-tts failed", json.loads(body)["detail"])
        self.assertEqual(FakeCommunicate.calls, 3)

    def test_rejects_bad_requests_and_unknown_paths(self):
        self.assertEqual(self.post("/tts", b"{nope")[0], 400)
        self.assertEqual(self.post("/tts", {"text": "hi"})[0], 400)  # no voice
        self.assertEqual(self.post("/other", {})[0], 404)

    def test_synthesize_passes_voice_and_rate(self):
        seen = {}

        class Spy(FakeCommunicate):
            def __init__(self, text, voice, rate="+0%"):
                super().__init__(text, voice, rate)
                seen.update(text=text, voice=voice, rate=rate)

        edge_tts_server.edge_tts.Communicate = Spy
        audio = asyncio.run(edge_tts_server.synthesize("hello", "en-US-GuyNeural", "+10%"))
        self.assertEqual(audio, b"ID3mp3")
        self.assertEqual(seen, {"text": "hello", "voice": "en-US-GuyNeural", "rate": "+10%"})


if __name__ == "__main__":
    unittest.main()
