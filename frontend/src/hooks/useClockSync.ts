import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackInfo } from '../types/music';

export interface ClockSyncHandle {
  getPosition: () => number;
  displayPosition: number;
  seekOptimistic: (seconds: number) => void;
}

export function useClockSync(track: TrackInfo | null, lastUpdateAt: number): ClockSyncHandle {
  const positionRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const statusRef = useRef<string>('Stopped');
  const durationRef = useRef(0);
  const trackKeyRef = useRef('');

  const [displayPosition, setDisplayPosition] = useState(0);

  // Sync incoming snapshot using smooth PLL slewing instead of hard resets
  useEffect(() => {
    if (!track) {
      statusRef.current = 'Stopped';
      durationRef.current = 0;
      positionRef.current = 0;
      trackKeyRef.current = '';
      setDisplayPosition(0);
      return;
    }

    const key = `${track.artist}::${track.title}`;
    const isNewTrack = key !== trackKeyRef.current;
    trackKeyRef.current = key;
    statusRef.current = track.status;
    durationRef.current = track.length || 0;

    const serverPos = track.position || 0;

    if (isNewTrack || track.status !== 'Playing') {
      positionRef.current = serverPos;
      setDisplayPosition(serverPos);
      return;
    }

    const drift = serverPos - positionRef.current;
    if (Math.abs(drift) >= 1.0) {
      // User seek or new track: snap immediately
      positionRef.current = serverPos;
      setDisplayPosition(serverPos);
    } else if (Math.abs(drift) > 0.03) {
      // Gentle proportional slewing: smooth convergence without sudden stutters
      // Ensure time never jumps backward during smooth playback
      const correction = drift * 0.08;
      if (drift < 0) {
        // Slow down slightly rather than stepping backwards
        positionRef.current += Math.max(correction, -0.015);
      } else {
        positionRef.current += Math.min(correction, 0.025);
      }
    }
  }, [track, lastUpdateAt]);

  const isPlaying = track?.status === 'Playing';

  // Smooth interpolation tick ONLY while track is actively playing
  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    let lastUiSync = 0;
    lastFrameRef.current = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastFrameRef.current) * 0.001));
      lastFrameRef.current = now;

      if (statusRef.current === 'Playing') {
        const nextPos = positionRef.current + dt;
        positionRef.current =
          durationRef.current > 0 ? Math.min(durationRef.current, nextPos) : nextPos;
      }

      if (now - lastUiSync >= 100) {
        lastUiSync = now;
        setDisplayPosition(positionRef.current);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  const getPosition = useCallback(() => positionRef.current, []);

  const seekOptimistic = useCallback((seconds: number) => {
    positionRef.current = Math.max(0, seconds);
    setDisplayPosition(Math.max(0, seconds));
  }, []);

  return {
    getPosition,
    displayPosition,
    seekOptimistic,
  };
}
