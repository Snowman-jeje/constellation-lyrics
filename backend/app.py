"""
Constellation Lyrics Visualizer - Backend Server
Provides HTTP endpoints and SSE (Server-Sent Events) for real-time track and lyric updates.
Directly syncs live media playback from YouTube Music, Spotify, and system players.
Features server-side Pillow palette extraction to eliminate browser CORS blocks.
Disables browser/WebKit caching so frontend updates take effect immediately.
"""

import os
import sys
import json
import time
import queue
import urllib.parse
import urllib.request
import io
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import threading
from pathlib import Path
from PIL import Image

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.mpris import MPRISMonitor
from backend.lyrics import LyricsFetcher

PORT = 9876
FRONTEND_DIR = BASE_DIR / 'frontend'

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class AppState:
    def __init__(self):
        self.mpris = MPRISMonitor()
        self.lyrics_fetcher = LyricsFetcher()
        self.current_track_key = ""
        self.cached_lyrics = None
        self.cached_palette = {"r": 47, "g": 169, "b": 222}
        self.cached_art_bytes = b""
        self.cached_art_type = "image/jpeg"
        self.last_art_url = ""
        self.subscribers = []
        self.lock = threading.Lock()
        self.running = True

    def extract_palette(self, art_url: str):
        if not art_url:
            return {"r": 47, "g": 169, "b": 222}
        try:
            if art_url.startswith('file://'):
                local_path = art_url[7:]
                with open(local_path, 'rb') as f:
                    img_bytes = f.read()
                img = Image.open(local_path).convert('RGB')
                content_type = 'image/jpeg' if local_path.endswith(('.jpg', '.jpeg')) else 'image/png'
            elif art_url.startswith('/'):
                with open(art_url, 'rb') as f:
                    img_bytes = f.read()
                img = Image.open(art_url).convert('RGB')
                content_type = 'image/jpeg' if art_url.endswith(('.jpg', '.jpeg')) else 'image/png'
            else:
                req = urllib.request.Request(art_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=3.5) as resp:
                    img_bytes = resp.read()
                    content_type = resp.headers.get('Content-Type', 'image/jpeg')
                img = Image.open(io.BytesIO(img_bytes)).convert('RGB')

            with self.lock:
                self.cached_art_bytes = img_bytes
                self.cached_art_type = content_type

            img = img.resize((48, 48))
            colors = img.getcolors(2400)
            if not colors:
                return {"r": 47, "g": 169, "b": 222}

            best_rgb = (47, 169, 222)
            best_score = -1
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
        except Exception as e:
            return {"r": 47, "g": 169, "b": 222}

    def update_loop(self):
        last_track_key = ""
        while self.running:
            try:
                info = self.mpris.get_track_info()
                if info and info.get('title'):
                    track_key = f"{info.get('artist')} - {info.get('title')}"
                    art_url = info.get('art_url', '')

                    if track_key != last_track_key:
                        last_track_key = track_key
                        lyrics = self.lyrics_fetcher.fetch(
                            title=info.get('title', ''),
                            artist=info.get('artist', ''),
                            album=info.get('album', ''),
                            duration=info.get('length', 0)
                        )
                        with self.lock:
                            self.cached_lyrics = lyrics

                    if art_url and art_url != self.last_art_url:
                        self.last_art_url = art_url
                        palette = self.extract_palette(art_url)
                        with self.lock:
                            self.cached_palette = palette

                payload = self.get_full_payload(info)
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

            except Exception as e:
                pass
            time.sleep(0.1)

    def get_full_payload(self, info=None):
        if info is None:
            info = self.mpris.get_track_info() or {
                'player': 'none',
                'title': 'No Track Playing',
                'artist': 'Play music in YouTube Music or Spotify',
                'album': '',
                'art_url': '',
                'length': 0,
                'status': 'Stopped',
                'position': 0.0,
                'timestamp': time.time()
            }
        with self.lock:
            lyrics = self.cached_lyrics
            palette = self.cached_palette

        return {
            'track': info,
            'lyrics': lyrics,
            'palette': palette
        }

state = AppState()

class RequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def end_headers(self):
        # Prevent any caching in WebKitGTK, Chrome, or Firefox
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/status':
            payload = state.get_full_payload()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode('utf-8'))
            return

        elif path == '/api/art':
            parsed = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed.query)
            t_url = query_params.get('t', [''])[0]
            if t_url and t_url != state.last_art_url:
                state.extract_palette(t_url)
                state.last_art_url = t_url

            with state.lock:
                art_bytes = state.cached_art_bytes
                content_type = state.cached_art_type

            if not art_bytes:
                # If not cached yet, try extracting from active track
                info = state.mpris.get_track_info() or {}
                art_url = info.get('art_url', '')
                if art_url:
                    state.extract_palette(art_url)
                    with state.lock:
                        art_bytes = state.cached_art_bytes
                        content_type = state.cached_art_type

            if art_bytes:
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(art_bytes)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(art_bytes)
            else:
                self.send_response(404)
                self.end_headers()
            return

        elif path == '/api/stream':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            q = queue.Queue(maxsize=10)
            with state.lock:
                state.subscribers.append(q)

            try:
                initial = f"data: {json.dumps(state.get_full_payload())}\n\n"
                self.wfile.write(initial.encode('utf-8'))
                self.wfile.flush()

                while state.running:
                    try:
                        msg = q.get(timeout=2.0)
                        self.wfile.write(msg.encode('utf-8'))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                with state.lock:
                    if q in state.subscribers:
                        state.subscribers.remove(q)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/play-pause':
            state.mpris.play_pause()
            self._send_ok()
        elif path == '/api/next':
            state.mpris.next_track()
            self._send_ok()
        elif path == '/api/previous':
            state.mpris.previous_track()
            self._send_ok()
        elif path == '/api/seek':
            content_len = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_len).decode('utf-8')
            try:
                data = json.loads(post_body)
                sec = float(data.get('position', 0))
                state.mpris.seek(sec)
                self._send_ok()
            except Exception as e:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def _send_ok(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format, *args):
        return

def main():
    threading.Thread(target=state.update_loop, daemon=True).start()
    server = ThreadedHTTPServer(('127.0.0.1', PORT), RequestHandler)
    print(f"✨ Constellation Lyrics server running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        state.running = False
        server.server_close()

if __name__ == '__main__':
    main()
