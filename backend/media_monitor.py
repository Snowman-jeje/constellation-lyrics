"""
Cross-platform Media Monitor.
- Windows: Native SMTC (System Media Transport Controls) via WinRT.
- Linux: MPRIS D-Bus via playerctl.
"""

from __future__ import annotations

import asyncio
import datetime
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional


class BaseMediaMonitor:
    def get_track_info(self) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def play_pause(self) -> None:
        raise NotImplementedError

    def next_track(self) -> None:
        raise NotImplementedError

    def previous_track(self) -> None:
        raise NotImplementedError

    def seek(self, seconds: float) -> None:
        raise NotImplementedError


class WindowsSMTCMonitor(BaseMediaMonitor):
    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._manager = None
        self._last_thumb_key = ""
        self._cached_art_bytes: bytes = b""

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _run_coro(self, coro, timeout: float = 2.5):
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)

    async def _get_manager(self):
        if self._manager is None:
            from winrt.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            )

            self._manager = await SessionManager.request_async()
        return self._manager

    async def _get_active_session(self):
        from winrt.windows.media.control import (
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        )

        mgr = await self._get_manager()
        current = mgr.get_current_session()
        if current is not None:
            pb = current.get_playback_info()
            if pb and pb.playback_status == PlaybackStatus.PLAYING:
                return current

        sessions = mgr.get_sessions()
        best = current
        for sess in sessions:
            pb = sess.get_playback_info()
            if pb and pb.playback_status == PlaybackStatus.PLAYING:
                return sess
            if best is None:
                best = sess
        return best

    async def _read_thumbnail_bytes(self, thumb_ref) -> bytes:
        if thumb_ref is None:
            return b""
        try:
            from winrt.windows.storage.streams import DataReader

            stream = await thumb_ref.open_read_async()
            size = int(stream.size)
            if size <= 0:
                return b""
            reader = DataReader(stream)
            await reader.load_async(size)
            buf = bytearray(size)
            reader.read_bytes(buf)
            reader.close()
            stream.close()
            return bytes(buf)
        except Exception:
            return b""

    async def _fetch_track_info_async(self) -> Optional[Dict[str, Any]]:
        from winrt.windows.media.control import (
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        )

        session = await self._get_active_session()
        if session is None:
            return None

        pb = session.get_playback_info()
        pb_status = pb.playback_status if pb else PlaybackStatus.CLOSED
        if pb_status == PlaybackStatus.PLAYING:
            status_str = "Playing"
        elif pb_status == PlaybackStatus.PAUSED:
            status_str = "Paused"
        else:
            status_str = "Stopped"

        props = await session.try_get_media_properties_async()
        if props is None:
            return None

        title = (props.title or "").strip()
        artist = (props.artist or "").strip()
        album = (props.album_title or "").strip()
        player_id = (session.source_app_user_model_id or "Windows Media").split("!")[0]
        if player_id.lower().endswith(".exe"):
            player_id = player_id[:-4]

        timeline = session.get_timeline_properties()
        position = 0.0
        length_sec = 0.0
        if timeline is not None:
            raw_pos = timeline.position.total_seconds()
            length_sec = max(0.0, timeline.end_time.total_seconds())
            position = max(0.0, raw_pos)

            if status_str == "Playing" and timeline.last_updated_time is not None:
                now_utc = datetime.datetime.now(datetime.timezone.utc)
                last_upd = timeline.last_updated_time
                if last_upd.tzinfo is None:
                    last_upd = last_upd.replace(tzinfo=datetime.timezone.utc)
                elapsed = (now_utc - last_upd).total_seconds()
                if 0.0 <= elapsed < 3600.0:
                    position += elapsed
            if length_sec > 0.0:
                position = min(length_sec, position)

        thumb_key = f"{artist}::{title}::{album}"
        if thumb_key != self._last_thumb_key:
            self._last_thumb_key = thumb_key
            self._cached_art_bytes = await self._read_thumbnail_bytes(props.thumbnail)

        return {
            "player": player_id or "SMTC",
            "title": title,
            "artist": artist,
            "album": album,
            "art_url": "",
            "art_bytes": self._cached_art_bytes,
            "length": length_sec,
            "status": status_str,
            "position": round(position, 4),
            "timestamp": time.time(),
            "server_mono": time.monotonic(),
        }

    def get_track_info(self) -> Optional[Dict[str, Any]]:
        try:
            return self._run_coro(self._fetch_track_info_async(), timeout=2.0)
        except Exception:
            return None

    async def _control_async(self, action: str, seek_sec: float = 0.0) -> None:
        session = await self._get_active_session()
        if session is None:
            return
        if action == "play_pause":
            await session.try_toggle_play_pause_async()
        elif action == "next":
            await session.try_skip_next_async()
        elif action == "previous":
            await session.try_skip_previous_async()
        elif action == "seek":
            ticks = max(0, int(seek_sec * 10_000_000))
            await session.try_change_playback_position_async(ticks)

    def play_pause(self) -> None:
        try:
            self._run_coro(self._control_async("play_pause"), timeout=1.5)
        except Exception:
            pass

    def next_track(self) -> None:
        try:
            self._run_coro(self._control_async("next"), timeout=1.5)
        except Exception:
            pass

    def previous_track(self) -> None:
        try:
            self._run_coro(self._control_async("previous"), timeout=1.5)
        except Exception:
            pass

    def seek(self, seconds: float) -> None:
        try:
            self._run_coro(self._control_async("seek", seconds), timeout=1.5)
        except Exception:
            pass


class LinuxMPRISMonitor(BaseMediaMonitor):
    def __init__(self) -> None:
        self.last_player: Optional[str] = None

    def list_players(self) -> List[str]:
        try:
            out = subprocess.check_output(
                ["playerctl", "-l"], text=True, stderr=subprocess.DEVNULL
            ).strip()
            return [p.strip() for p in out.splitlines() if p.strip()]
        except Exception:
            return []

    def score_player(self, player: str) -> int:
        score = 0
        try:
            status = subprocess.check_output(
                ["playerctl", "-p", player, "status"], text=True, stderr=subprocess.DEVNULL
            ).strip()
            if status == "Playing":
                score += 50
            elif status == "Paused":
                score += 10
        except Exception:
            return -1

        try:
            fmt = "{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}}"
            meta = subprocess.check_output(
                ["playerctl", "-p", player, "metadata", "--format", fmt],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            parts = meta.split(";;;")
            title = parts[0].strip() if len(parts) > 0 else ""
            artist = parts[1].strip() if len(parts) > 1 else ""
            album = parts[2].strip() if len(parts) > 2 else ""
            art_url = parts[3].strip() if len(parts) > 3 else ""

            if title.lower() in ("youtube music", "mozilla firefox", "google chrome", "chromium", ""):
                score -= 30
            else:
                score += 20
            if artist:
                score += 15
            if album and album.lower() != "youtube music":
                score += 5
            if art_url:
                score += 5
            if "plasma-browser-integration" in player:
                score += 10
        except Exception:
            pass

        return score

    def get_active_player(self) -> Optional[str]:
        players = self.list_players()
        if not players:
            return None

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
            status = subprocess.check_output(
                ["playerctl", "-p", player, "status"], text=True, stderr=subprocess.DEVNULL
            ).strip()
        except Exception:
            return None

        fmt = "{{playerName}};;;{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}};;;{{mpris:length}}"
        try:
            meta = subprocess.check_output(
                ["playerctl", "-p", player, "metadata", "--format", fmt],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            parts = meta.split(";;;")
            p_name = parts[0] if len(parts) > 0 else player
            title = parts[1] if len(parts) > 1 else ""
            artist = parts[2] if len(parts) > 2 else ""
            album = parts[3] if len(parts) > 3 else ""
            art_url = parts[4] if len(parts) > 4 else ""
            raw_len = parts[5] if len(parts) > 5 else ""
            length_sec = float(raw_len) / 1e6 if (raw_len and raw_len.isdigit()) else 0.0
        except Exception:
            title = artist = album = art_url = ""
            length_sec = 0.0
            p_name = player

        position = 0.0
        try:
            pos_str = subprocess.check_output(
                ["playerctl", "-p", player, "position"], text=True, stderr=subprocess.DEVNULL
            ).strip()
            if pos_str:
                position = float(pos_str)
        except Exception:
            position = 0.0

        if art_url.startswith("file://"):
            art_url = art_url[7:]

        return {
            "player": p_name,
            "title": title,
            "artist": artist,
            "album": album,
            "art_url": art_url,
            "art_bytes": b"",
            "length": length_sec,
            "status": status,
            "position": position,
            "timestamp": time.time(),
            "server_mono": time.monotonic(),
        }

    def play_pause(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(["playerctl", "-p", player, "play-pause"], stderr=subprocess.DEVNULL)

    def next_track(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(["playerctl", "-p", player, "next"], stderr=subprocess.DEVNULL)

    def previous_track(self) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(["playerctl", "-p", player, "previous"], stderr=subprocess.DEVNULL)

    def seek(self, seconds: float) -> None:
        player = self.get_active_player()
        if player:
            subprocess.run(
                ["playerctl", "-p", player, "position", str(seconds)], stderr=subprocess.DEVNULL
            )


def create_media_monitor() -> BaseMediaMonitor:
    if sys.platform == "win32":
        return WindowsSMTCMonitor()
    return LinuxMPRISMonitor()
