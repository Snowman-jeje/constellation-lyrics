import { useEffect, useRef } from 'react';
import { ConstellationManager } from '../engine/constellation';
import { resolveLineWords, usePrefersReducedMotion } from '../engine/lyricTiming';
import { ConstellationRenderer } from '../engine/renderer';
import type { ColorPalette, LyricLine, LyricsData } from '../types/music';

export interface ConstellationCanvasProps {
  lyrics: LyricsData | null;
  palette: ColorPalette;
  syncOffset?: number;
  trackKey: string;
  getPosition: () => number;
  fontScale?: number;
  lightMode?: boolean;
  beat?: number;
  reducedMotion?: boolean;
  showAmbientGlow?: boolean;
  positionMode?: 'fixed' | 'absolute';
}

export function ConstellationCanvas({
  lyrics,
  palette,
  syncOffset = 0,
  trackKey,
  getPosition,
  fontScale = 1.0,
  lightMode = false,
  beat = 0,
  reducedMotion = false,
  showAmbientGlow = true,
  positionMode = 'fixed',
}: ConstellationCanvasProps) {
  const ambientRef = useRef<HTMLCanvasElement | null>(null);
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const managerRef = useRef<ConstellationManager | null>(null);
  const rendererRef = useRef<ConstellationRenderer | null>(null);

  const osReducedMotion = usePrefersReducedMotion();
  const isReduced = reducedMotion || osReducedMotion;

  const lyricsRef = useRef<LyricsData | null>(lyrics);
  const syncOffsetRef = useRef(syncOffset);
  const reducedRef = useRef(isReduced);

  useEffect(() => {
    lyricsRef.current = lyrics;
  }, [lyrics]);

  useEffect(() => {
    syncOffsetRef.current = syncOffset;
  }, [syncOffset]);

  useEffect(() => {
    reducedRef.current = isReduced;
    rendererRef.current?.setOptions({ reducedMotion: isReduced });
  }, [isReduced]);

  useEffect(() => {
    rendererRef.current?.setOptions({
      fontScale,
      lightMode,
      showAmbientGlow,
      beat,
    });
  }, [fontScale, lightMode, showAmbientGlow, beat]);

  useEffect(() => {
    rendererRef.current?.setPalette(palette);
  }, [palette]);

  useEffect(() => {
    if (managerRef.current && rendererRef.current) {
      managerRef.current.setLine(null, rendererRef.current.width, rendererRef.current.height);
    }
  }, [trackKey]);

  useEffect(() => {
    const ambientCanvas = ambientRef.current;
    const mainCanvas = mainRef.current;
    if (!ambientCanvas || !mainCanvas) return;

    const manager = new ConstellationManager();
    const renderer = new ConstellationRenderer(ambientCanvas, mainCanvas, manager);
    renderer.setOptions({
      fontScale,
      lightMode,
      reducedMotion: isReduced,
      showAmbientGlow,
      beat,
    });
    renderer.setPalette(palette);

    managerRef.current = manager;
    rendererRef.current = renderer;

    const onResize = () => renderer.resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (ro && mainCanvas.parentElement) {
      ro.observe(mainCanvas.parentElement);
    }
    window.addEventListener('resize', onResize);

    let rafId = 0;
    let lastFrameTime = performance.now();

    const animate = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameTime) * 0.001));
      lastFrameTime = now;

      if (!document.hidden) {
        const adjustedPos = getPosition() + syncOffsetRef.current;
        const currentLyrics = lyricsRef.current;

        if (currentLyrics && currentLyrics.has_synced && currentLyrics.lines.length > 0) {
          const lines = currentLyrics.lines.filter((l) => (l.text || '').trim().length > 0);
          let targetLine: LyricLine | null = null;
          let targetNextStart: number | undefined;

          let i = 0;
          while (i < lines.length) {
            const lineA = lines[i];
            const lineB = i + 1 < lines.length ? lines[i + 1] : null;

            let paired = false;
            if (lineB) {
              const gapBetweenStarts = lineB.start_time - lineA.start_time;
              const estimatedEndA = lineA.end_time || lineA.start_time + 3.0;
              const pauseBetween = lineB.start_time - estimatedEndA;
              const wordsA = resolveLineWords(lineA, lineB.start_time);
              const nextAfterB =
                i + 2 < lines.length
                  ? lines[i + 2].start_time
                  : lineB.end_time || lineB.start_time + 4.5;
              const wordsB = resolveLineWords(lineB, nextAfterB);

              if (
                gapBetweenStarts <= 5.5 &&
                pauseBetween <= 2.5 &&
                wordsA.length + wordsB.length <= 18
              ) {
                paired = true;
                const gapAfterB = nextAfterB - lineB.start_time;
                const silenceAfter =
                  nextAfterB - Math.max(lineB.end_time || 0, lineB.start_time + 3.5);
                const pairEndLimit =
                  silenceAfter > 5.0 || gapAfterB > 9.0
                    ? Math.min(nextAfterB - 0.5, (lineB.end_time || lineB.start_time + 3.5) + 1.2)
                    : nextAfterB;

                if (adjustedPos >= lineA.start_time && adjustedPos < pairEndLimit) {
                  targetLine = {
                    ...lineA,
                    text: `${lineA.text} ${lineB.text}`,
                    end_time: lineB.end_time || nextAfterB,
                    words: [...wordsA, ...wordsB],
                  };
                  targetNextStart = nextAfterB;
                  break;
                }
                i += 2;
              }
            }

            if (!paired) {
              const nextStart = lineB
                ? lineB.start_time
                : lineA.end_time || lineA.start_time + 4.5;
              const gap = nextStart - lineA.start_time;
              const silenceAfter =
                nextStart - Math.max(lineA.end_time || 0, lineA.start_time + 3.5);
              const lineEndLimit =
                silenceAfter > 5.0 || gap > 9.0
                  ? Math.min(nextStart - 0.5, (lineA.end_time || lineA.start_time + 3.5) + 1.2)
                  : nextStart;

              if (adjustedPos >= lineA.start_time && adjustedPos < lineEndLimit) {
                targetLine = lineA;
                targetNextStart = nextStart;
                break;
              }
              i += 1;
            }
          }

          if (targetLine && targetLine.line_index !== manager.currentLineIndex) {
            manager.setLine(targetLine, renderer.width, renderer.height, targetNextStart);
          } else if (!targetLine && manager.currentLineIndex !== -1) {
            manager.setLine(null, renderer.width, renderer.height);
          }
        } else if (manager.currentLineIndex !== -1) {
          manager.setLine(null, renderer.width, renderer.height);
        }

        manager.update(adjustedPos, dt, reducedRef.current);
        renderer.render(dt);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
    // Intentionally initialize canvases once per getPosition callback identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPosition]);

  return (
    <>
      <canvas
        ref={ambientRef}
        className={`pointer-events-none ${positionMode} inset-0 z-[2] h-full w-full ${
          lightMode ? 'mix-blend-normal' : 'mix-blend-screen'
        }`}
        aria-hidden="true"
      />
      <canvas
        ref={mainRef}
        className={`pointer-events-none ${positionMode} inset-0 z-[3] h-full w-full`}
        aria-hidden="true"
      />
    </>
  );
}
