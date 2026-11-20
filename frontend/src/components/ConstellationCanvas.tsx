import { useEffect, useRef } from 'react';
import { ConstellationManager } from '../engine/constellation';
import { usePrefersReducedMotion } from '../engine/lyricTiming';
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
          const lines = currentLyrics.lines;
          let targetLine: LyricLine | null = null;
          let targetNextStart: number | undefined;

          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const nextStart =
              i + 1 < lines.length ? lines[i + 1].start_time : l.end_time || l.start_time + 4.5;
            if (adjustedPos >= l.start_time && adjustedPos < nextStart) {
              targetLine = l;
              targetNextStart = nextStart;
              break;
            }
          }

          if (targetLine && targetLine.line_index !== manager.currentLineIndex) {
            manager.setLine(targetLine, renderer.width, renderer.height, targetNextStart);
          } else if (!targetLine && manager.currentLineIndex !== -1) {
            const firstLine = lines[0];
            const lastLine = lines[lines.length - 1];
            if (
              adjustedPos < firstLine.start_time ||
              adjustedPos > (lastLine.end_time || lastLine.start_time + 4.5) + 1.0
            ) {
              manager.setLine(null, renderer.width, renderer.height);
            }
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
