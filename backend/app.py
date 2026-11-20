"""
Constellation Lyrics Visualizer - Backend Server
Provides HTTP endpoints and SSE (Server-Sent Events) for real-time track and lyric updates.
Cross-platform media session sync (Windows SMTC + Linux MPRIS), server-side palette extraction,
non-blocking lyrics fetching, and per-track sync offset persistence.
"""

import hashlib
import io
import json
import queue
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any, Dict, Optional

from PIL import Image

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.audio_beat import AudioBeatDetector
from backend.lyrics import LyricsFetcher
from backend.media_monitor import create_media_monitor

PORT = 9876
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
FRONTEND_DIR = BASE_DIR / "frontend"
CACHE_DIR = Path.home() / ".cache" / "constellation-lyrics"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
OFFSETS_FILE = CACHE_DIR / "offsets.json"


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class AppState:
    def __init__(self) -> None:
        self.monitor = create_media_monitor()
        self.beat_detector = AudioBeatDetector()
        self.lyrics_fetcher = LyricsFetcher()
        self.current_track_key = ""
        self.cached_lyrics: Optional[Dict[str, Any]] = None
        self.lyrics_loading = False
        self.cached_palette = {"r": 47, "g": 169, "b": 222}
        self.cached_art_bytes = b""
        self.cached_art_type = "image/jpeg"
        self.current_art_key = ""
        self.offsets: Dict[str, float] = self._load_offsets()
        self.subscribers: list[queue.Queue[str]] = []
        self.lock = threading.Lock()
        self.running = True

    def _load_offsets(self) -> Dict[str, float]:
        if OFFSETS_FILE.exists():
            try:
                with open(OFFSETS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return {str(k): float(v) for k, v in data.items()}
            except Exception:
                pass
        return {}

    def _save_offsets(self) -> None:
        try:
            with open(OFFSETS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.offsets, f, indent=2)
        except Exception:
            pass

    def get_offset(self, track_key: str) -> float:
        with self.lock:
            return float(self.offsets.get(track_key, 0.0))

    def set_offset(self, track_key: str, offset: float) -> None:
        if not track_key:
            return
        with self.lock:
            self.offsets[track_key] = round(float(offset), 2)
            self._save_offsets()

    def _extract_palette_from_bytes(self, img_bytes: bytes, content_type: str = "image/jpeg") -> Dict[str, int]:
        try:
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            with self.lock:
                self.cached_art_bytes = img_bytes
                self.cached_art_type = content_type

            img = img.resize((48, 48))
            colors = img.getcolors(2400)
            if not colors:
                return {"r": 47, "g": 169, "b": 222}

            best_rgb = (47, 169, 222)
            best_score = -1.0
            for count, (r, g, b) in colors:
                bright = (r + g + b) / 3
                if bright < 30 or bright > 235:
                    continue
                max_c = max(r, g, b)
                min_c = min(r, g, b)
                sat = (max_c - min_c) / (max_c or 1)
                score = sat * (count ** 0.6)
                if score > best_score:
                    best_score = score
                    best_rgb = (r, g, b)

            return {"r": best_rgb[0], "g": best_rgb[1], "b": best_rgb[2]}
        except Exception:
            return {"r": 47, "g": 169, "b": 222}

    def extract_palette(self, art_url: str = "", art_bytes: bytes = b"") -> Dict[str, int]:
        if art_bytes:
            return self._extract_palette_from_bytes(art_bytes, "image/jpeg")

        if not art_url:
            with self.lock:
                self.cached_art_bytes = b""
            return {"r": 47, "g": 169, "b": 222}

        try:
            if art_url.startswith("file://"):
                local_path = art_url[7:]
                with open(local_path, "rb") as f:
                    img_bytes = f.read()
                ctype = "image/jpeg" if local_path.endswith((".jpg", ".jpeg")) else "image/png"
                return self._extract_palette_from_bytes(img_bytes, ctype)
            if art_url.startswith("/"):
                with open(art_url, "rb") as f:
                    img_bytes = f.read()
                ctype = "image/jpeg" if art_url.endswith((".jpg", ".jpeg")) else "image/png"
                return self._extract_palette_from_bytes(img_bytes, ctype)

            req = urllib.request.Request(art_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                img_bytes = resp.read()
                ctype = resp.headers.get("Content-Type", "image/jpeg")
            return self._extract_palette_from_bytes(img_bytes, ctype)
        except Exception:
            return {"r": 47, "g": 169, "b": 222}

    def _fetch_lyrics_async(self, track_key: str, info: Dict[str, Any]) -> None:
        lyrics = self.lyrics_fetcher.fetch(
            title=info.get("title", ""),
            artist=info.get("artist", ""),
            album=info.get("album", ""),
            duration=info.get("length", 0),
        )
        with self.lock:
            if self.current_track_key == track_key:
                self.cached_lyrics = lyrics
                self.lyrics_loading = False
        self.broadcast(self.get_full_payload(info))

    def broadcast(self, payload: Dict[str, Any]) -> None:
        data_str = f"data: {json.dumps(payload)}\n\n"
        with self.lock:
            dead_subs = []
            for q in self.subscribers:
                try:
                    q.put_nowait(data_str)
                except queue.Full:
                    dead_subs.append(q)
            for q in dead_subs:
                if q in self.subscribers:
                    self.subscribers.remove(q)

    def update_loop(self) -> None:
        while self.running:
            try:
                info = self.monitor.get_track_info()
                if info and info.get("title"):
                    track_key = f"{info.get('artist')} - {info.get('title')}"
                    art_url = info.get("art_url", "")
                    art_bytes = info.get("art_bytes", b"")

                    art_sig = art_url or (
                        hashlib.md5(art_bytes[:256] + len(art_bytes).to_bytes(4, "big")).hexdigest()
                        if art_bytes
                        else ""
                    )

                    if track_key != self.current_track_key:
                        with self.lock:
                            self.current_track_key = track_key
                            self.cached_lyrics = None
                            self.lyrics_loading = True
                        threading.Thread(
                            target=self._fetch_lyrics_async,
                            args=(track_key, dict(info)),
                            daemon=True,
                        ).start()

                    if art_sig and art_sig != self.current_art_key:
                        palette = self.extract_palette(art_url=art_url, art_bytes=art_bytes)
                        with self.lock:
                            self.current_art_key = art_sig
                            self.cached_palette = palette
                    elif not art_sig and self.current_art_key:
                        with self.lock:
                            self.current_art_key = ""
                            self.cached_art_bytes = b""
                            self.cached_palette = {"r": 47, "g": 169, "b": 222}
                else:
                    with self.lock:
                        self.current_track_key = ""
                        self.cached_lyrics = None
                        self.lyrics_loading = False

                self.broadcast(self.get_full_payload(info))
            except Exception:
                pass
            time.sleep(0.1)

    def get_full_payload(self, info: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if info is None:
            info = self.monitor.get_track_info() or {
                "player": "none",
                "title": "No Track Playing",
                "artist": "Play music in YouTube Music or Spotify",
                "album": "",
                "art_url": "",
                "length": 0,
                "status": "Stopped",
                "position": 0.0,
                "timestamp": time.time(),
                "server_mono": time.monotonic(),
            }

        clean_info = {k: v for k, v in info.items() if k != "art_bytes"}
        track_key = (
            f"{clean_info.get('artist')} - {clean_info.get('title')}"
            if clean_info.get("title") and clean_info.get("title") != "No Track Playing"
            else ""
        )

        with self.lock:
            lyrics = self.cached_lyrics
            lyrics_loading = self.lyrics_loading
            palette = self.cached_palette
            has_art = bool(self.cached_art_bytes)
            art_key = self.current_art_key
            offset = float(self.offsets.get(track_key, 0.0)) if track_key else 0.0

        clean_info["has_art"] = has_art
        clean_info["art_key"] = art_key

        return {
            "track": clean_info,
            "lyrics": lyrics,
            "lyrics_loading": lyrics_loading,
            "palette": palette,
            "track_offset": offset,
            "server_mono": time.monotonic(),
        }


state = AppState()


def _resolve_serve_dir() -> Path:
    if FRONTEND_DIST_DIR.exists() and (FRONTEND_DIST_DIR / "index.html").exists():
        return FRONTEND_DIST_DIR
    return FRONTEND_DIR


class RequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(_resolve_serve_dir()), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"status": "ok", "platform": sys.platform})
            return

        if path == "/api/status":
            self._send_json(state.get_full_payload())
            return

        if path == "/api/art":
            with state.lock:
                art_bytes = state.cached_art_bytes
                content_type = state.cached_art_type

            if art_bytes:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(art_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(art_bytes)
            else:
                self.send_response(404)
                self.end_headers()
            return

        if path == "/api/beat-stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            state.beat_detector.add_listener()
            try:
                while state.running:
                    metrics = state.beat_detector.get_metrics()
                    msg = f"data: {json.dumps(metrics)}\n\n"
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                    time.sleep(0.025)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            finally:
                state.beat_detector.remove_listener()
            return

        if path == "/api/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            q: queue.Queue[str] = queue.Queue(maxsize=10)
            with state.lock:
                state.subscribers.append(q)

            try:
                initial = f"data: {json.dumps(state.get_full_payload())}\n\n"
                self.wfile.write(initial.encode("utf-8"))
                self.wfile.flush()

                while state.running:
                    try:
                        msg = q.get(timeout=2.0)
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            finally:
                with state.lock:
                    if q in state.subscribers:
                        state.subscribers.remove(q)
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/play-pause":
            state.monitor.play_pause()
            self._send_json({"status": "ok"})
        elif path == "/api/next":
            state.monitor.next_track()
            self._send_json({"status": "ok"})
        elif path == "/api/previous":
            state.monitor.previous_track()
            self._send_json({"status": "ok"})
        elif path == "/api/seek":
            try:
                data = self._read_json_body()
                sec = float(data.get("position", 0))
                state.monitor.seek(sec)
                self._send_json({"status": "ok"})
            except Exception:
                self.send_response(400)
                self.end_headers()
        elif path == "/api/offset":
            try:
                data = self._read_json_body()
                offset = float(data.get("offset", 0.0))
                track_key = str(data.get("track_key", "")).strip() or state.current_track_key
                state.set_offset(track_key, offset)
                state.broadcast(state.get_full_payload())
                self._send_json({"status": "ok", "offset": offset})
            except Exception:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def _read_json_body(self) -> Dict[str, Any]:
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode("utf-8")
        return json.loads(post_body) if post_body else {}

    def _send_json(self, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args) -> None:
        return


def main() -> None:
    threading.Thread(target=state.update_loop, daemon=True).start()
    server = ThreadedHTTPServer(("127.0.0.1", PORT), RequestHandler)
    print(f"Constellation Lyrics server running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        state.running = False
        server.server_close()


if __name__ == "__main__":
    main()
