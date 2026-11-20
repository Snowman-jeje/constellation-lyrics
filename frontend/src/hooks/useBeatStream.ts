import { useEffect, useRef, useState, type RefObject } from 'react';
import { isTauriRuntime, safeListen } from '../store/tauriBridge';
import type { BeatFrame } from '../types/suite';

const ZERO_FRAME: BeatFrame = {
  beat: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Subscribes to Tauri 'beat-frame' events (or /api/beat-stream SSE in browser mode),
 * smoothly interpolates beat metrics at display cadence, updates CSS variables
 * (--beat, --bass) on an optional targetRef, and returns the interpolated BeatFrame.
 */
export function useBeatStream(
  enabled: boolean,
  targetRef?: RefObject<HTMLElement | null>,
): BeatFrame;
export function useBeatStream(
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): BeatFrame;
export function useBeatStream(
  arg1: boolean | RefObject<HTMLElement | null>,
  arg2?: boolean | RefObject<HTMLElement | null>,
): BeatFrame {
  const enabled = typeof arg1 === 'boolean' ? arg1 : Boolean(arg2);
  const targetRef =
    typeof arg1 === 'boolean'
      ? (arg2 as RefObject<HTMLElement | null> | undefined)
      : arg1;

  const [frame, setFrame] = useState<BeatFrame>(ZERO_FRAME);
  const targetValuesRef = useRef<BeatFrame>({ ...ZERO_FRAME });
  const currentValuesRef = useRef<BeatFrame>({ ...ZERO_FRAME });
  const sseFailureCountRef = useRef(0);

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      targetValuesRef.current = { ...ZERO_FRAME };
      return;
    }

    if (isTauriRuntime()) {
      let cancelled = false;
      let unlisten: (() => void) | null = null;
      void safeListen<Partial<BeatFrame>>('beat-frame', (payload) => {
        if (cancelled) return;
        targetValuesRef.current = {
          beat: typeof payload.beat === 'number' ? payload.beat : 0,
          bass: typeof payload.bass === 'number' ? payload.bass : 0,
          mid: typeof payload.mid === 'number' ? payload.mid : 0,
          treble: typeof payload.treble === 'number' ? payload.treble : 0,
          energy: typeof payload.energy === 'number' ? payload.energy : 0,
        };
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    }

    // Browser SSE fallback with safe circuit breaker when Python backend is absent
    sseFailureCountRef.current = 0;
    const sse = new EventSource('/api/beat-stream');

    sse.onopen = () => {
      sseFailureCountRef.current = 0;
    };

    sse.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as {
          b?: number;
          e?: number;
          beat?: number;
          bass?: number;
          mid?: number;
          treble?: number;
          energy?: number;
        };
        const beatVal = typeof parsed.beat === 'number' ? parsed.beat : parsed.b ?? 0;
        const bassVal = typeof parsed.bass === 'number' ? parsed.bass : parsed.e ?? 0;
        targetValuesRef.current = {
          beat: beatVal,
          bass: bassVal,
          mid: typeof parsed.mid === 'number' ? parsed.mid : bassVal * 0.72,
          treble: typeof parsed.treble === 'number' ? parsed.treble : beatVal * 0.65,
          energy: typeof parsed.energy === 'number' ? parsed.energy : (beatVal + bassVal) * 0.5,
        };
      } catch {
        // Ignore malformed frame
      }
    };

    sse.onerror = () => {
      targetValuesRef.current = { ...ZERO_FRAME };
      sseFailureCountRef.current += 1;
      if (sseFailureCountRef.current >= 2) {
        sse.close();
      }
    };

    return () => {
      sse.close();
    };
  }, [enabled]);

  useEffect(() => {
    let rafId = 0;
    let lastStateEmit = 0;
    let settledZero = false;

    const tick = (now: number) => {
      const reduced = prefersReducedMotion();
      const active = enabled && !reduced;
      const target = active ? targetValuesRef.current : ZERO_FRAME;
      const curr = currentValuesRef.current;

      const lerpMetric = (cur: number, dst: number, attack: number, release: number) =>
        cur + (dst - cur) * (dst > cur ? attack : release);

      curr.beat = lerpMetric(curr.beat, target.beat, 0.45, 0.14);
      curr.bass = lerpMetric(curr.bass, target.bass, 0.35, 0.12);
      curr.mid = lerpMetric(curr.mid, target.mid, 0.35, 0.14);
      curr.treble = lerpMetric(curr.treble, target.treble, 0.42, 0.16);
      curr.energy = lerpMetric(curr.energy, target.energy, 0.32, 0.12);

      const el = targetRef?.current;
      if (el) {
        el.style.setProperty('--beat', curr.beat.toFixed(3));
        el.style.setProperty('--bass', curr.bass.toFixed(3));
      }

      const maxVal = Math.max(curr.beat, curr.bass, curr.mid, curr.treble, curr.energy);
      if (maxVal < 0.004) {
        if (!settledZero) {
          settledZero = true;
          currentValuesRef.current = { ...ZERO_FRAME };
          if (el) {
            el.style.setProperty('--beat', '0');
            el.style.setProperty('--bass', '0');
          }
          setFrame(ZERO_FRAME);
        }
        if (!active) {
          rafId = 0;
          return;
        }
      } else if (now - lastStateEmit >= 33) {
        settledZero = false;
        lastStateEmit = now;
        setFrame({
          beat: Number(curr.beat.toFixed(3)),
          bass: Number(curr.bass.toFixed(3)),
          mid: Number(curr.mid.toFixed(3)),
          treble: Number(curr.treble.toFixed(3)),
          energy: Number(curr.energy.toFixed(3)),
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [enabled, targetRef]);

  return frame;
}
