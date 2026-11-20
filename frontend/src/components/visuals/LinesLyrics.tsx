import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeActiveWordProgress,
  findActiveLineIndex,
  hashUnit,
  type LyricStyleRendererProps,
  resolveLineWords,
} from '../../engine/lyricTiming';
import { toSafeCssUrl } from '../../store/tauriBridge';

gsap.registerPlugin(useGSAP);

export function LinesLyrics({
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeWordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const [activeIndex, setActiveIndex] = useState<number>(() =>
    findActiveLineIndex(lines, getPosition()),
  );

  // Pre-resolve word arrays per line once per lyrics update
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

  const propsRef = useRef({
    motionMode,
    scatter,
    tilt,
    bulge,
    beat,
    reducedMotion,
  });
  propsRef.current = { motionMode, scatter, tilt, bulge, beat, reducedMotion };

  // Reset active index when lines array changes
  useEffect(() => {
    const next = findActiveLineIndex(lines, getPosition());
    setActiveIndex(next);
  }, [lines, getPosition]);

  useEffect(() => {
    activeWordRefs.current = [];
  }, [activeIndex]);

  // 60fps RAF loop: updates active line index on transitions & word-level DOM transforms directly
  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const pos = getPosition();
      const idx = findActiveLineIndex(lines, pos);
      if (idx !== activeIndexRef.current) {
        setActiveIndex(idx);
      }

      const currentIdx = idx;
      if (currentIdx >= 0 && currentIdx < resolvedLines.length) {
        const words = resolvedLines[currentIdx].words;
        const { activeWordIndex, wordProgress } = computeActiveWordProgress(words, pos);
        const cfg = propsRef.current;
        const kineticWords = cfg.motionMode === 'words' && !cfg.reducedMotion;
        const canBulge = cfg.bulge && kineticWords;
        const canScatter = cfg.scatter && kineticWords;

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const span = activeWordRefs.current[wIdx];
          if (!span) continue;

          const isPassed = wIdx < activeWordIndex;
          const isCurrent = wIdx === activeWordIndex;
          const scatterY = canScatter
            ? (hashUnit(currentIdx + 1, wIdx + 11) - 0.5) * 9 * (isCurrent || isPassed ? 0 : 1)
            : 0;
          const scatterRot = canScatter
            ? (hashUnit(currentIdx + 7, wIdx + 23) - 0.5) * 2.4 * (isCurrent || isPassed ? 0 : 1)
            : 0;

          let scale = 1.0;
          let liftY = scatterY;
          let opacity = 0.42;

          if (isPassed) {
            opacity = 0.94;
            scale = 1.0;
          } else if (isCurrent) {
            const easePop = Math.sin(wordProgress * Math.PI);
            opacity = 0.72 + 0.28 * Math.min(1, wordProgress * 2.2);
            scale = canBulge ? 1.0 + 0.065 * easePop + cfg.beat * 0.045 : 1.0;
            liftY = canBulge ? -2.5 * easePop : 0;
          } else if (!kineticWords) {
            opacity = 0.78;
          }

          span.style.opacity = opacity.toFixed(3);
          span.style.transform = `translate3d(0, ${liftY.toFixed(2)}px, 0) scale(${scale.toFixed(3)}) rotate(${scatterRot.toFixed(2)}deg)`;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lines, resolvedLines, getPosition]);

  // GSAP vertical scroll centering when activeIndex or fontScale changes
  useGSAP(
    () => {
      const stage = stageRef.current;
      const track = trackRef.current;
      if (!stage || !track) return;

      const stageH = stage.clientHeight;
      const anchorY = stageH * 0.44;
      const targetRow =
        activeIndex >= 0 ? lineRefs.current[activeIndex] : lineRefs.current[0] || null;

      let targetY = anchorY - 40;
      if (targetRow) {
        const rowCenter = targetRow.offsetTop + targetRow.offsetHeight * 0.5;
        targetY = anchorY - rowCenter;
      }

      gsap.to(track, {
        y: targetY,
        duration: reducedMotion ? 0 : 0.68,
        ease: 'power3.out',
        overwrite: 'auto',
      });
    },
    { scope: stageRef, dependencies: [activeIndex, fontScale, reducedMotion, lines.length] },
  );

  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const mutedInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.56)' : 'rgba(244, 242, 237, 0.52)';
  const accentCss = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const useCoverText = coverInWords && Boolean(artUrl);

  const baseFontPx = Math.round(44 * Math.max(0.7, Math.min(1.5, fontScale)));

  return (
    <div
      ref={stageRef}
      className="relative h-full w-full overflow-hidden px-6 md:px-16"
      style={{
        maskImage:
          'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.85) 14%, rgba(0,0,0,1) 28%, rgba(0,0,0,1) 72%, rgba(0,0,0,0.85) 86%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.85) 14%, rgba(0,0,0,1) 28%, rgba(0,0,0,1) 72%, rgba(0,0,0,0.85) 86%, transparent 100%)',
      }}
    >
      <div
        ref={trackRef}
        className="mx-auto flex max-w-4xl flex-col items-center gap-5 py-12 will-change-transform md:gap-7"
      >
        {resolvedLines.map(({ line, words }, idx) => {
          const isActive = idx === activeIndex;
          const dist = activeIndex >= 0 ? Math.abs(idx - activeIndex) : idx;
          const isVisible = dist <= 5;
          const blurPx = isActive || reducedMotion ? 0 : Math.min(4.5, dist * 1.15);
          const rowOpacity = isActive ? 1 : Math.max(0.12, 0.72 - dist * 0.14);
          const rowScale = isActive ? 1 : Math.max(0.8, 0.96 - dist * 0.038);
          const rowTilt =
            tilt && motionMode !== 'standing' && !reducedMotion && !isActive
              ? Math.max(-2.2, Math.min(2.2, (idx - activeIndex) * 0.48))
              : 0;

          return (
            <button
              key={`${line.line_index}-${line.start_time}`}
              ref={(el) => {
                lineRefs.current[idx] = el;
              }}
              type="button"
              onClick={() => onLineClick?.(line.start_time)}
              disabled={!onLineClick}
              className={`group relative w-full text-center font-display tracking-[-0.02em] transition-[opacity,filter,transform] duration-500 ease-fluid focus:outline-none ${
                onLineClick ? 'cursor-pointer' : 'cursor-default'
              } ${!isActive ? 'hover:!opacity-95 hover:!blur-none' : ''}`}
              style={{
                fontSize: `clamp(${Math.round(baseFontPx * 0.62)}px, ${(baseFontPx * 0.082).toFixed(2)}vw, ${baseFontPx}px)`,
                lineHeight: 1.2,
                opacity: isVisible ? rowOpacity : 0,
                filter: blurPx > 0 ? `blur(${blurPx.toFixed(2)}px)` : 'none',
                transform: `scale(${rowScale.toFixed(3)}) rotate(${rowTilt.toFixed(2)}deg)`,
                pointerEvents: isVisible ? 'auto' : 'none',
                color: isActive ? primaryInk : mutedInk,
                textShadow:
                  isActive && !isLightBackdrop && !useCoverText
                    ? `0 0 28px rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.35)`
                    : 'none',
              }}
            >
              {isActive && words.length > 0 ? (
                <span
                  className="inline-flex flex-wrap items-baseline justify-center gap-x-[0.26em] gap-y-1"
                  style={
                    useCoverText && toSafeCssUrl(artUrl)
                      ? {
                          backgroundImage: toSafeCssUrl(artUrl),
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
                      className="inline-block origin-center will-change-transform transition-colors duration-200"
                      style={{
                        color: useCoverText ? 'transparent' : undefined,
                      }}
                    >
                      {w.word}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="inline-block transition-colors duration-300 group-hover:text-current">
                  {line.text}
                </span>
              )}

              {isActive && (
                <span
                  aria-hidden="true"
                  className="mx-auto mt-3 block h-px w-12 rounded-full opacity-65 transition-all duration-500"
                  style={{ backgroundColor: accentCss }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
