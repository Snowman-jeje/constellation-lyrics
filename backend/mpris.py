"""
MPRIS D-Bus media player monitor using playerctl.
Optimized for YouTube Music, Spotify, Browser integration, and local players.
"""

import subprocess
import time
import re
from typing import Optional, Dict, Any, List

class MPRISMonitor:
    def __init__(self):
        self.last_player: Optional[str] = None

    def list_players(self) -> List[str]:
        try:
            out = subprocess.check_output(['playerctl', '-l'], text=True, stderr=subprocess.DEVNULL).strip()
            return [p.strip() for p in out.splitlines() if p.strip()]
        except Exception:
            return []

    def score_player(self, player: str) -> int:
        score = 0
        try:
            status = subprocess.check_output(['playerctl', '-p', player, 'status'], text=True, stderr=subprocess.DEVNULL).strip()
            if status == 'Playing':
                score += 50
            elif status == 'Paused':
                score += 10
        except Exception:
            return -1

        try:
            fmt = '{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}}'
            meta = subprocess.check_output(['playerctl', '-p', player, 'metadata', '--format', fmt], text=True, stderr=subprocess.DEVNULL).strip()
            parts = meta.split(';;;')
            title = parts[0].strip() if len(parts) > 0 else ''
            artist = parts[1].strip() if len(parts) > 1 else ''
            album = parts[2].strip() if len(parts) > 2 else ''
            art_url = parts[3].strip() if len(parts) > 3 else ''

            # If title is just a generic site name without track, penalize
            if title.lower() in ('youtube music', 'mozilla firefox', 'google chrome', 'chromium', ''):
                score -= 30
            else:
                score += 20

            if artist:
                score += 15
            if album and album.lower() != 'youtube music':
                score += 5
            if art_url:
                score += 5

            # plasma-browser-integration usually has rich metadata for YouTube Music
            if 'plasma-browser-integration' in player:
                score += 10

        except Exception:
            pass

        return score

    def get_active_player(self) -> Optional[str]:
        players = self.list_players()
        if not players:
            return None

        # Sort players by quality score descending
        scored = []
        for p in players:
            sc = self.score_player(p)
            if sc >= 0:
                scored.append((sc, p))

        if scored:
            scored.sort(key=lambda x: x[0], reverse=True)
            best_player = scored[0][1]
            self.last_player = best_player
            return best_player

        return players[0]

    def get_track_info(self) -> Optional[Dict[str, Any]]:
        player = self.get_active_player()
        if not player:
            return None

        try:
            status = subprocess.check_output(['playerctl', '-p', player, 'status'], text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:
            return None

        fmt = '{{playerName}};;;{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}};;;{{mpris:length}}'
        try:
            meta = subprocess.check_output(['playerctl', '-p', player, 'metadata', '--format', fmt], text=True, stderr=subprocess.DEVNULL).strip()
            parts = meta.split(';;;')
            
            p_name = parts[0] if len(parts) > 0 else player
            title = parts[1] if len(parts) > 1 else ''
            artist = parts[2] if len(parts) > 2 else ''
            album = parts[3] if len(parts) > 3 else ''
            art_url = parts[4] if len(parts) > 4 else ''
            raw_len = parts[5] if len(parts) > 5 else ''
            
            length_sec = float(raw_len) / 1e6 if (raw_len and raw_len.isdigit()) else 0.0
        except Exception:
            title = ''
            artist = ''
            album = ''
            art_url = ''
            length_sec = 0.0
            p_name = player

        position = 0.0
        try:
            pos_str = subprocess.check_output(['playerctl', '-p', player, 'position'], text=True, stderr=subprocess.DEVNULL).strip()
            if pos_str:
                position = float(pos_str)
        except Exception:
            position = 0.0

        # Clean art_url if file://
        if art_url.startswith('file://'):
            art_url = art_url[7:]

        return {
            'player': p_name,
            'title': title,
            'artist': artist,
            'album': album,
            'art_url': art_url,
            'length': length_sec,
            'status': status,
            'position': position,
            'timestamp': time.time()
        }

    def play_pause(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(['playerctl', '-p', player, 'play-pause'], stderr=subprocess.DEVNULL)

    def next_track(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(['playerctl', '-p', player, 'next'], stderr=subprocess.DEVNULL)

    def previous_track(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(['playerctl', '-p', player, 'previous'], stderr=subprocess.DEVNULL)

    def seek(self, seconds: float) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(['playerctl', '-p', player, 'position', str(seconds)], stderr=subprocess.DEVNULL)
