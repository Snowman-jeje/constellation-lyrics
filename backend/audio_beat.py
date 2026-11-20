"""
Real-time System Audio Beat & Bass Energy Detector.
Uses WASAPI loopback via `soundcard` + `numpy` rFFT on Windows,
with graceful silent fallback on unsupported platforms or missing devices.
"""

from __future__ import annotations

import collections
import sys
import threading
import time
from typing import Deque, Dict


class AudioBeatDetector:
    def __init__(self, sample_rate: int = 48000, chunk_size: int = 1024) -> None:
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self._lock = threading.Lock()
        self._bass = 0.0
        self._beat = 0.0
        self._active_listeners = 0
        self._running = True
        self._thread: threading.Thread | None = None

    def add_listener(self) -> None:
        with self._lock:
            self._active_listeners += 1
            if self._thread is None or not self._thread.is_alive():
                self._running = True
                self._thread = threading.Thread(target=self._capture_loop, daemon=True)
                self._thread.start()

    def remove_listener(self) -> None:
        with self._lock:
            self._active_listeners = max(0, self._active_listeners - 1)

    def get_metrics(self) -> Dict[str, float]:
        with self._lock:
            return {
                "b": round(self._beat, 3),
                "e": round(self._bass, 3),
            }

    def _capture_loop(self) -> None:
        if sys.platform != "win32":
            return

        try:
            import numpy as np
            import soundcard as sc
        except Exception:
            return

        # Precompute Hann window and FFT frequency bins for bass (25-150 Hz)
        window = np.hanning(self.chunk_size).astype(np.float32)
        freqs = np.fft.rfftfreq(self.chunk_size, d=1.0 / self.sample_rate)
        bass_mask = (freqs >= 25.0) & (freqs <= 160.0)
        history: Deque[float] = collections.deque(maxlen=40)

        smooth_bass = 0.0
        beat_pulse = 0.0
        peak_ref = 0.02

        while self._running:
            with self._lock:
                listeners = self._active_listeners
            if listeners <= 0:
                time.sleep(0.25)
                continue

            try:
                speaker = sc.default_speaker()
                if speaker is None:
                    time.sleep(0.5)
                    continue
                mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
                with mic.recorder(samplerate=self.sample_rate, blocksize=self.chunk_size) as rec:
                    while self._running:
                        with self._lock:
                            if self._active_listeners <= 0:
                                break
                        data = rec.record(numframes=self.chunk_size)
                        if data is None or len(data) == 0:
                            continue
                        mono = data.mean(axis=1) if data.ndim > 1 else data
                        if len(mono) < self.chunk_size:
                            continue

                        spectrum = np.abs(np.fft.rfft(mono[: self.chunk_size] * window))
                        raw_bass = float(np.mean(spectrum[bass_mask])) if np.any(bass_mask) else 0.0

                        # Adaptive normalization so both quiet and loud songs react
                        peak_ref = max(0.015, peak_ref * 0.992, raw_bass)
                        norm_bass = min(1.0, raw_bass / (peak_ref * 0.85))

                        history.append(norm_bass)
                        avg_bass = sum(history) / len(history)

                        # Beat onset detection when instantaneous bass spikes above rolling average
                        if norm_bass > max(0.18, avg_bass * 1.28):
                            beat_pulse = max(beat_pulse, min(1.0, (norm_bass - avg_bass) * 2.6 + 0.35))
                        else:
                            beat_pulse *= 0.82

                        smooth_bass = smooth_bass * 0.65 + norm_bass * 0.35

                        with self._lock:
                            self._bass = smooth_bass
                            self._beat = beat_pulse
            except Exception:
                with self._lock:
                    self._bass = 0.0
                    self._beat = 0.0
                time.sleep(0.8)
