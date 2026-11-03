"""Local helper: serves the GUI and fetches pages that browsers may not load directly.

    python -m srp serve                 # http://127.0.0.1:8765
    python -m srp serve --port 9000

Endpoints (localhost only):
  /                 the GUI (site/)
  /api/health       {"name": "srp", "version": ...}
  /api/fetch?url=   GET a publisher page or PDF server-side and return it with CORS headers,
                    so the full-text step can use your own network (e.g. university VPN/IP access).

Serving the GUI from localhost also lets it talk to Ollama without extra configuration,
because Ollama accepts requests from localhost origins by default.
"""
from __future__ import annotations

import argparse
import http.server
import json
import urllib.parse
import urllib.request
from functools import partial
from pathlib import Path

from . import __version__

SITE = Path(__file__).resolve().parent.parent / "site"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 srp/" + __version__
MAX_BYTES = 40 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "x-final-url, x-content-type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/health":
            return self._json(200, {"name": "srp", "version": __version__})
        if u.path == "/api/fetch":
            return self._fetch(urllib.parse.parse_qs(u.query).get("url", [""])[0])
        return super().do_GET()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fetch(self, url: str):
        if not url.startswith(("http://", "https://")):
            return self._json(400, {"error": "url must start with http(s)://"})
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read(MAX_BYTES)
                ctype = r.headers.get("Content-Type", "application/octet-stream")
                final = r.geturl()
        except urllib.error.HTTPError as e:
            return self._json(502, {"error": f"HTTP {e.code} from {url}"})
        except Exception as e:  # network errors, timeouts
            return self._json(502, {"error": f"{type(e).__name__}: {e}"})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("x-content-type", ctype)
        self.send_header("x-final-url", final)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="srp serve", description="Serve the GUI + fetch helper on localhost.")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), partial(Handler, directory=str(SITE)))
    print(f"Review Pipeline on http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
