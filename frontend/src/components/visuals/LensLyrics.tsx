import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeActiveWordProgress,
  findActiveLineIndex,
  type LyricStyleRendererProps,
  resolveLineWords,
} from '../../engine/lyricTiming';
import { toSafeCssUrl } from '../../store/tauriBridge';

interface WordBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function LensLyrics({
  lines,
  getPosition,
  accent,
  isLightBackdrop,
  artUrl,
  motionMode,
  bulge,
  coverInWords,
  fontScale,
  beat,
  reducedMotion,
  onLineClick,
}: LyricStyleRendererProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lineWrapRef = useRef<HTMLDivElement | null>(null);
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const cachedBoxesRef = useRef<WordBox[]>([]);

  const [activeIndex, setActiveIndex] = useState<number>(() =>
    findActiveLineIndex(lines, getPosition()),
  );

  const resolvedLines = useMemo(
    () =>
      lines.map((line, i) => ({
        line,
        words: resolveLineWords(line, i + 1 < lines.length ? lines[i + 1].start_time : undefined),
      })),
    [lines],
  );

  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const propsRef = useRef({ motionMode, bulge, beat, reducedMotion });
  propsRef.current = { motionMode, bulge, beat, reducedMotion };

  const measureBoxes = useCallback(() => {
    const wrap = lineWrapRef.current;
    if (!wrap) {
      cachedBoxesRef.current = [];
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const boxes: WordBox[] = [];
    for (let i = 0; i < wordRefs.current.length; i++) {
      const el = wordRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      boxes[i] = {
        cx: r.left - wrapRect.left + r.width * 0.5,
        cy: r.top - wrapRect.top + r.height * 0.5,
        w: r.width,
        h: r.height,
      };
    }
    cachedBoxesRef.current = boxes;
  }, []);

  useEffect(() => {
    const next = findActiveLineIndex(lines, getPosition());
    setActiveIndex(next);
  }, [lines, getPosition]);

  useEffect(() => {
    wordRefs.current = [];
    const frameId = requestAnimationFrame(measureBoxes);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureBoxes) : null;
    if (ro && lineWrapRef.current) ro.observe(lineWrapRef.current);
    window.addEventListener('resize', measureBoxes);

    return () => {
      cancelAnimationFrame(frameId);
      ro?.disconnect();
      window.removeEventListener('resize', measureBoxes);
    };
  }, [activeIndex, fontScale, lines, measureBoxes]);

  useEffect(() => {
    let rafId = 0;
    let loupeX = 0;
    let loupeY = 0;
    let loupeScaleX = 1;
    let loupeOpacity = 0;
    let initialized = false;

    const tick = () => {
      const pos = getPosition();
      const idx = findActiveLineIndex(lines, pos);
      if (idx !== activeIndexRef.current) {
        setActiveIndex(idx);
      }

      const boxes = cachedBoxesRef.current;
      const loupeEl = loupeRef.current;
      const cfg = propsRef.current;

      if (idx >= 0 && idx < resolvedLines.length) {
        const words = resolvedLines[idx].words;
        const { activeWordIndex } = computeActiveWordProgress(words, pos);
        const canFocusWords = cfg.motionMode !== 'standing' && !cfg.reducedMotion;
        const canBulge = cfg.bulge && cfg.motionMode === 'words' && !cfg.reducedMotion;

        for (let i = 0; i < words.length; i++) {
          const span = wordRefs.current[i];
          if (!span) continue;
          const isCurrent = i === activeWordIndex;
          const isPassed = i < activeWordIndex;
          const scale = isCurrent
            ? canBulge
              ? 1.18 + cfg.beat * 0.06
              : 1.14
            : 1.0;
          const opacity = isCurrent ? 1.0 : isPassed ? 0.58 : 0.36;

          span.style.opacity = opacity.toFixed(3);
          span.style.transform = `scale(${scale.toFixed(3)})`;
        }

        const targetBox =
          activeWordIndex >= 0 && boxes[activeWordIndex] ? boxes[activeWordIndex] : boxes[0];

        if (loupeEl && targetBox) {
          if (!initialized || !canFocusWords) {
            loupeX = targetBox.cx;
            loupeY = targetBox.cy;
            loupeScaleX = Math.max(0.85, Math.min(2.2, (targetBox.w + 46) / 116));
            loupeOpacity = 1;
            initialized = true;
          } else {
            loupeX += (targetBox.cx - loupeX) * 0.18;
            loupeY += (targetBox.cy - loupeY) * 0.18;
            const desiredScaleX = Math.max(0.85, Math.min(2.2, (targetBox.w + 46) / 116));
            loupeScaleX += (desiredScaleX - loupeScaleX) * 0.16;
            loupeOpacity += (1 - loupeOpacity) * 0.18;
          }

          const beatScale = canBulge ? 1 + cfg.beat * 0.06 : 1;
          loupeEl.style.opacity = loupeOpacity.toFixed(3);
          loupeEl.style.transform = `translate3d(${(loupeX - 58).toFixed(2)}px, ${(loupeY - 58).toFixed(2)}px, 0) scale(${(loupeScaleX * beatScale).toFixed(3)}, ${beatScale.toFixed(3)})`;
        }
      } else if (loupeEl) {
        loupeOpacity *= 0.85;
        loupeEl.style.opacity = loupeOpacity.toFixed(3);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lines, resolvedLines, getPosition]);

  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const subtleInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.38)' : 'rgba(244, 242, 237, 0.34)';
  const ringBorder = isLightBackdrop ? 'rgba(17, 17, 20, 0.22)' : 'rgba(244, 242, 237, 0.24)';
  const accentRgb = `${accent.r}, ${accent.g}, ${accent.b}`;
  const useCoverText = coverInWords && Boolean(artUrl);

  const clampedScale = Math.max(0.7, Math.min(1.5, fontScale));
  const activePx = Math.round(52 * clampedScale);
  const neighborPx = Math.round(24 * clampedScale);

  const prevLine = activeIndex > 0 ? resolvedLines[activeIndex - 1]?.line : null;
  const currentEntry = activeIndex >= 0 ? resolvedLines[activeIndex] : resolvedLines[0];
  const nextLine =
    activeIndex >= 0 && activeIndex + 1 < resolvedLines.length
      ? resolvedLines[activeIndex + 1]?.line
      : null;

  return (
    <div
      ref={stageRef}
      className="relative flex h-full w-full flex-col items-center justify-center px-6 md:px-16"
    >
      <div className="flex w-full max-w-4xl flex-col items-center gap-8 text-center">
        {/* Previous context line */}
        <button
          type="button"
          onClick={() => prevLine && onLineClick?.(prevLine.start_time)}
          disabled={!prevLine || !onLineClick}
          className={`min-h-[2rem] max-w-2xl font-display tracking-[-0.015em] transition-opacity duration-300 ${
            prevLine && onLineClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          style={{
            fontSize: `clamp(${Math.round(neighborPx * 0.78)}px, 2.2vw, ${neighborPx}px)`,
            color: subtleInk,
          }}
        >
          {prevLine ? prevLine.text : ''}
        </button>

        {/* Active line with gliding optical loupe */}
        <div ref={lineWrapRef} className="relative flex w-full items-center justify-center py-4">
          {/* Optical Loupe Ring */}
          <div
            ref={loupeRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 h-[116px] w-[116px] rounded-full will-change-transform"
            style={{
              opacity: 0,
              border: `1px solid ${ringBorder}`,
              background: isLightBackdrop
                ? `radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.45) 0%, rgba(${accentRgb}, 0.09) 56%, transparent 78%)`
                : `radial-gradient(circle at 32% 28%, rgba(244, 242, 237, 0.14) 0%, rgba(${accentRgb}, 0.11) 56%, transparent 78%)`,
              boxShadow: isLightBackdrop
                ? 'inset 0 1px 0 rgba(255, 255, 255, 0.75)'
                : 'inset 0 1px 0 rgba(255, 255, 255, 0.24)',
            }}
          >
            <div
              className="absolute inset-[6px] rounded-full border"
              style={{
                borderColor: `rgba(${accentRgb}, 0.28)`,
              }}
            />
          </div>

          {currentEntry && (
            <div
              className="relative z-[1] flex flex-wrap items-baseline justify-center gap-x-[0.34em] gap-y-2 font-display leading-[1.2] tracking-[-0.02em]"
              style={{
                fontSize: `clamp(${Math.round(activePx * 0.62)}px, ${(activePx * 0.088).toFixed(2)}vw, ${activePx}px)`,
                ...(useCoverText && toSafeCssUrl(artUrl)
                  ? {
                      backgroundImage: toSafeCssUrl(artUrl),
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    }
                  : { color: primaryInk }),
              }}
            >
              {currentEntry.words.length > 0 ? (
                currentEntry.words.map((w, wIdx) => (
                  <span
                    key={`${currentEntry.line.line_index}-${wIdx}`}
                    ref={(el) => {
                      wordRefs.current[wIdx] = el;
                    }}
                    className="inline-block origin-center will-change-transform transition-[opacity] duration-150"
                    style={{
                      color: useCoverText ? 'transparent' : primaryInk,
                      textShadow:
                        !isLightBackdrop && !useCoverText
                          ? `0 0 24px rgba(${accentRgb}, 0.25)`
                          : 'none',
                    }}
                  >
                    {w.word}
                  </span>
                ))
              ) : (
                <span>{currentEntry.line.text}</span>
              )}
            </div>
          )}
        </div>

        {/* Upcoming context line */}
        <button
          type="button"
          onClick={() => nextLine && onLineClick?.(nextLine.start_time)}
          disabled={!nextLine || !onLineClick}
          className={`min-h-[2rem] max-w-2xl font-display tracking-[-0.015em] transition-opacity duration-300 ${
            nextLine && onLineClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          style={{
            fontSize: `clamp(${Math.round(neighborPx * 0.78)}px, 2.2vw, ${neighborPx}px)`,
            color: subtleInk,
          }}
        >
          {nextLine ? nextLine.text : ''}
        </button>
      </div>
    </div>
  );
}
