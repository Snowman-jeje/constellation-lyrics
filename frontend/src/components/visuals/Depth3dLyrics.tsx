import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeActiveWordProgress,
  findActiveLineIndex,
  hashUnit,
  type LyricStyleRendererProps,
  resolveLineWords,
} from '../../engine/lyricTiming';
import { toSafeCssUrl } from '../../store/tauriBridge';

export function Depth3dLyrics({
  lines,
  getPosition,
  accent,
  isLightBackdrop,
  artUrl,
  motionMode,
  scatter,
  tilt,
  bulge,
  coverInWords,
  fontScale,
  beat,
  reducedMotion,
  onLineClick,
}: LyricStyleRendererProps) {
  const cameraRef = useRef<HTMLDivElement | null>(null);
  const activeWordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pointerTargetRef = useRef({ rx: 0, ry: 0 });
  const pointerCurrRef = useRef({ rx: 0, ry: 0 });

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

  // Track pointer for subtle 3D camera tilt
  useEffect(() => {
    if (reducedMotion || motionMode === 'standing') {
      pointerTargetRef.current = { rx: 0, ry: 0 };
      if (cameraRef.current) {
        cameraRef.current.style.transform = 'rotateX(0deg) rotateY(0deg)';
      }
      return;
    }

    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      const ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      pointerTargetRef.current = {
        rx: -ny * 4.2,
        ry: nx * 5.0,
      };
    };

    const onLeave = () => {
      pointerTargetRef.current = { rx: 0, ry: 0 };
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [reducedMotion, motionMode]);

  // 60fps RAF loop for line tracking, word sweep, and camera tilt smoothing
  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const pos = getPosition();
      const idx = findActiveLineIndex(lines, pos);
      if (idx !== activeIndexRef.current) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);
      }

      if (!reducedMotion && motionMode !== 'standing' && cameraRef.current) {
        const cur = pointerCurrRef.current;
        const tgt = pointerTargetRef.current;
        cur.rx += (tgt.rx - cur.rx) * 0.08;
        cur.ry += (tgt.ry - cur.ry) * 0.08;
        cameraRef.current.style.transform = `rotateX(${cur.rx.toFixed(3)}deg) rotateY(${cur.ry.toFixed(3)}deg)`;
      }

      if (idx >= 0 && idx < resolvedLines.length) {
        const entry = resolvedLines[idx];
        const wordProg = computeActiveWordProgress(entry.words, pos);
        const spans = activeWordRefs.current;
        const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
        const dimInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.34)' : 'rgba(244, 242, 237, 0.34)';

        for (let i = 0; i < entry.words.length; i++) {
          const span = spans[i];
          if (!span) continue;
          const isCurr = i === wordProg.activeWordIndex;
          const isSung = i < wordProg.activeWordIndex;
          const scale =
            !reducedMotion && bulge && isCurr ? 1.075 + wordProg.wordProgress * 0.04 : 1.0;

          span.style.transform = `scale(${scale.toFixed(3)})`;
          if (!coverInWords) {
            span.style.color = isCurr || isSung ? primaryInk : dimInk;
          } else {
            span.style.opacity = isCurr ? '1' : isSung ? '0.88' : '0.42';
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lines, resolvedLines, getPosition, isLightBackdrop, bulge, coverInWords, reducedMotion, motionMode]);

  const effectiveIdx = activeIndex >= 0 ? activeIndex : 0;
  const clampedScale = Math.max(0.75, Math.min(1.6, fontScale));
  const focalFontPx = Math.round(44 * clampedScale);
  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const upcomingInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.80)' : 'rgba(244, 242, 237, 0.84)';
  const safeCoverUrl = coverInWords ? toSafeCssUrl(artUrl) : undefined;
  const beatZ = reducedMotion || motionMode === 'standing' ? 0 : Math.round(beat * 20);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden px-6"
      style={{
        perspective: '1100px',
        perspectiveOrigin: '50% 48%',
      }}
    >
      <div
        ref={cameraRef}
        className="relative flex h-full w-full max-w-5xl items-center justify-center"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {resolvedLines.map(({ line, words }, idx) => {
          const offset = idx - effectiveIdx;
          if (offset < -1 || offset > 5) return null;

          const isActive = idx === activeIndex;
          const isPast = offset < 0;

          let tx = 0;
          let ty = 0;
          let tz = beatZ;
          let rotX = 0;
          let rotZ = 0;
          let opacity = 1;
          let blurPx = 0;

          if (isPast) {
            ty = 52;
            tz = 340;
            rotX = 6;
            opacity = 0;
            blurPx = 5;
          } else if (offset > 0) {
            tx =
              scatter && !reducedMotion
                ? (hashUnit(line.line_index, 1) - 0.5) * 46 * Math.min(2.2, offset)
                : 0;
            ty = -offset * 28;
            tz = -offset * 290;
            rotZ =
              tilt && !reducedMotion
                ? (hashUnit(line.line_index, 2) - 0.5) * 1.8
                : 0;
            opacity = Math.max(0.14, 0.76 - offset * 0.13);
            blurPx = Math.min(7, offset * 1.35);
          } else if (tilt && !reducedMotion && motionMode !== 'standing') {
            rotZ = (hashUnit(line.line_index, 3) - 0.5) * 0.9;
          }

          return (
            <button
              key={line.line_index}
              type="button"
              onClick={() => onLineClick?.(line.start_time)}
              disabled={isPast}
              className="group absolute max-w-4xl cursor-pointer px-4 text-center font-display leading-[1.16] tracking-[-0.02em] will-change-transform focus:outline-none"
              style={{
                fontSize: `clamp(${Math.round(focalFontPx * 0.58)}px, ${(focalFontPx * 0.082).toFixed(2)}vw, ${focalFontPx}px)`,
                color: isActive ? primaryInk : upcomingInk,
                opacity,
                filter: blurPx > 0 ? `blur(${blurPx.toFixed(1)}px)` : 'none',
                transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, ${tz.toFixed(1)}px) rotateX(${rotX}deg) rotateZ(${rotZ.toFixed(2)}deg)`,
                transition: reducedMotion
                  ? 'none'
                  : 'transform 680ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms ease, filter 520ms ease',
                pointerEvents: isPast ? 'none' : 'auto',
                zIndex: 20 - offset,
                textShadow:
                  isActive && !isLightBackdrop && !safeCoverUrl
                    ? `0 0 30px rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.38)`
                    : 'none',
              }}
            >
              {isActive && words.length > 0 ? (
                <span
                  className="inline-flex flex-wrap items-baseline justify-center gap-x-[0.26em] gap-y-1"
                  style={
                    safeCoverUrl
                      ? {
                          backgroundImage: safeCoverUrl,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          WebkitBackgroundClip: 'text',
                          backgroundClip: 'text',
                          color: 'transparent',
                        }
                      : undefined
                  }
                >
                  {words.map((w, wIdx) => (
                    <span
                      key={`${w.start}-${wIdx}`}
                      ref={(el) => {
                        activeWordRefs.current[wIdx] = el;
                      }}
                      className="inline-block origin-center will-change-transform transition-opacity duration-200"
                      style={{
                        color: safeCoverUrl ? 'transparent' : undefined,
                      }}
                    >
                      {w.word}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="inline-block transition-opacity duration-200 group-hover:opacity-100">
                  {line.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
