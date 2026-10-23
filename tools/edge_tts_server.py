"""Tiny local HTTP bridge around edge-tts for the extension.

POST /tts  {"text": "...", "voice": "en-US-AriaNeural", "rate": "+0%"}  ->  audio/mpeg
GET  /version                                                          ->  edge-tts version

Binds to 127.0.0.1 only. Note: edge-tts sends the text to Microsoft's online speech service.
"""
import argparse
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

import edge_tts


async def synthesize(text: str, voice: str, rate: str, attempts: int = 3) -> bytes:
    # The service occasionally answers with no audio at all; a retry normally succeeds.
    for attempt in range(attempts):
        try:
            chunks = []
            async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])
            return b"".join(chunks)
        except edge_tts.exceptions.EdgeTTSException:
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(0.3)
    return b""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, message: str) -> None:
        self._send(code, json.dumps({"detail": message}).encode(), "application/json")

    def do_GET(self) -> None:
        if self.path == "/version":
            self._send(200, json.dumps(version("edge-tts")).encode(), "application/json")
        else:
            self._error(404, "not found")

    def do_POST(self) -> None:
        if self.path != "/tts":
            return self._error(404, "not found")
        try:
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length))
            text, voice = req["text"], req["voice"]
            rate = req.get("rate", "+0%")
        except (ValueError, KeyError) as err:
            return self._error(400, f"bad request: {err}")
        try:
            audio = asyncio.run(synthesize(text, voice, rate))
        except Exception as err:  # edge-tts raises several service-specific errors
            return self._error(502, f"edge-tts failed: {err}")
        if not audio:
            return self._error(502, "edge-tts returned no audio")
        self._send(200, audio, "audio/mpeg")

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} {fmt % args}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5050)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"edge-tts bridge on http://127.0.0.1:{args.port}")
    server.serve_forever()
