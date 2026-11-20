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

interface BigWordsSnapshot {
  lineIndex: number;
  wordIndex: number;
  chunkIndex: number;
  heroText: string;
  lineText: string;
  lineStart: number;
}

export function BigWordsLyrics({
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);

  const resolvedLines = useMemo(
    () =>
      lines.map((line, i) => ({
        line,
        words: resolveLineWords(line, i + 1 < lines.length ? lines[i + 1].start_time : undefined),
      })),
    [lines],
  );

  const computeSnapshot = (): BigWordsSnapshot => {
    const pos = getPosition();
    const lIdx = findActiveLineIndex(lines, pos);
    if (lIdx < 0 || lIdx >= resolvedLines.length) {
      return {
        lineIndex: -1,
        wordIndex: -1,
        chunkIndex: 0,
        heroText: '',
        lineText: '',
        lineStart: 0,
      };
    }

    const { line, words } = resolvedLines[lIdx];
    const { activeWordIndex } = computeActiveWordProgress(words, pos);
    const wIdx = Math.max(0, activeWordIndex);

    if (motionMode === 'words') {
      const heroText = words[wIdx]?.word || line.text;
      return {
        lineIndex: lIdx,
        wordIndex: wIdx,
        chunkIndex: wIdx,
        heroText,
        lineText: line.text,
        lineStart: line.start_time,
      };
    }

    // Calmer 3-word editorial phrase chunks for 'backdrop' / 'standing' modes
    const chunkSize = 3;
    const chunkIndex = Math.floor(wIdx / chunkSize);
    const slice = words.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
    const heroText = slice.map((w) => w.word).join(' ') || line.text;

    return {
      lineIndex: lIdx,
      wordIndex: wIdx,
      chunkIndex,
      heroText,
      lineText: line.text,
      lineStart: line.start_time,
    };
  };

  const [snapshot, setSnapshot] = useState<BigWordsSnapshot>(computeSnapshot);
  const keyRef = useRef(`${snapshot.lineIndex}-${snapshot.chunkIndex}`);

  useEffect(() => {
    const initial = computeSnapshot();
    keyRef.current = `${initial.lineIndex}-${initial.chunkIndex}`;
    setSnapshot(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, motionMode]);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const pos = getPosition();
      const lIdx = findActiveLineIndex(lines, pos);

      if (lIdx >= 0 && lIdx < resolvedLines.length) {
        const { line, words } = resolvedLines[lIdx];
        const { activeWordIndex } = computeActiveWordProgress(words, pos);
        const wIdx = Math.max(0, activeWordIndex);
        const chunkIndex = motionMode === 'words' ? wIdx : Math.floor(wIdx / 3);
        const nextKey = `${lIdx}-${chunkIndex}`;

        if (nextKey !== keyRef.current) {
          keyRef.current = nextKey;
          const heroText =
            motionMode === 'words'
              ? words[wIdx]?.word || line.text
              : words
                  .slice(chunkIndex * 3, (chunkIndex + 1) * 3)
                  .map((w) => w.word)
                  .join(' ') || line.text;

          setSnapshot({
            lineIndex: lIdx,
            wordIndex: wIdx,
            chunkIndex,
            heroText,
            lineText: line.text,
            lineStart: line.start_time,
          });
        }
      } else if (keyRef.current !== '-1-0') {
        keyRef.current = '-1-0';
        setSnapshot({
          lineIndex: -1,
          wordIndex: -1,
          chunkIndex: 0,
          heroText: '',
          lineText: '',
          lineStart: 0,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lines, resolvedLines, getPosition, motionMode]);

  const scatterOffsetX =
    scatter && motionMode === 'words' && !reducedMotion && snapshot.lineIndex >= 0
      ? (hashUnit(snapshot.lineIndex + 3, snapshot.chunkIndex + 5) - 0.5) * 44
      : 0;
  const scatterOffsetY =
    scatter && motionMode === 'words' && !reducedMotion && snapshot.lineIndex >= 0
      ? (hashUnit(snapshot.lineIndex + 9, snapshot.chunkIndex + 17) - 0.5) * 18
      : 0;
  const tiltDeg =
    tilt && motionMode !== 'standing' && !reducedMotion && snapshot.lineIndex >= 0
      ? (hashUnit(snapshot.lineIndex + 13, snapshot.chunkIndex + 29) - 0.5) * 4.6
      : 0;

  useGSAP(
    () => {
      if (!heroRef.current || !snapshot.heroText) return;
      if (reducedMotion) {
        gsap.set(heroRef.current, {
          x: scatterOffsetX,
          y: scatterOffsetY,
          scale: 1,
          opacity: 1,
          rotation: tiltDeg,
        });
        return;
      }

      gsap.fromTo(
        heroRef.current,
        {
          x: scatterOffsetX,
          y: scatterOffsetY + 24,
          scale: 0.88,
          opacity: 0,
          rotation: tiltDeg * 1.4,
        },
        {
          x: scatterOffsetX,
          y: scatterOffsetY,
          scale: 1,
          opacity: 1,
          rotation: tiltDeg,
          duration: 0.36,
          ease: 'power3.out',
          overwrite: 'auto',
        },
      );
    },
    {
      scope: containerRef,
      dependencies: [snapshot.lineIndex, snapshot.chunkIndex, reducedMotion],
    },
  );

  const clampedScale = Math.max(0.7, Math.min(1.5, fontScale));
  const beatBoost = bulge && !reducedMotion ? 1 + beat * 0.085 : 1;
  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const contextInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.52)' : 'rgba(244, 242, 237, 0.50)';
  const useCoverText = coverInWords && Boolean(artUrl);
  const accentGlow = `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${isLightBackdrop ? 0.16 : 0.42})`;

  const heroMaxPx = Math.round((motionMode === 'words' ? 148 : 96) * clampedScale);
  const heroMinPx = Math.round((motionMode === 'words' ? 54 : 38) * clampedScale);

  const isItalicAccent =
    tilt && snapshot.chunkIndex % 4 === 2 && motionMode === 'words';

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col items-center justify-center px-8 text-center"
    >
      {snapshot.heroText ? (
        <>
          <div
            className="will-change-transform transition-transform duration-100"
            style={{ transform: `scale(${beatBoost.toFixed(4)})` }}
          >
            <div
              ref={heroRef}
              className={`max-w-5xl select-none font-display leading-[0.96] tracking-[-0.03em] will-change-transform ${
                isItalicAccent ? 'italic' : ''
              }`}
              style={{
                fontSize: `clamp(${heroMinPx}px, ${(clampedScale * (motionMode === 'words' ? 11.5 : 7.5)).toFixed(2)}vw, ${heroMaxPx}px)`,
                ...(useCoverText && toSafeCssUrl(artUrl)
                  ? {
                      backgroundImage: toSafeCssUrl(artUrl),
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                      WebkitTextStroke: isLightBackdrop
                        ? '1px rgba(17, 17, 20, 0.18)'
                        : '1px rgba(244, 242, 237, 0.22)',
                    }
                  : {
                      color: primaryInk,
                      textShadow: isLightBackdrop ? 'none' : `0 0 42px ${accentGlow}`,
                    }),
              }}
            >
              {snapshot.heroText}
            </div>
          </div>

          {snapshot.lineText && (
            <button
              type="button"
              onClick={() => onLineClick?.(snapshot.lineStart)}
              disabled={!onLineClick}
              className={`mt-8 max-w-2xl font-sans text-xs font-medium tracking-[0.14em] uppercase transition-opacity duration-300 sm:text-sm ${
                onLineClick ? 'cursor-pointer hover:opacity-90' : 'cursor-default'
              }`}
              style={{ color: contextInk }}
            >
              {snapshot.lineText}
            </button>
          )}
        </>
      ) : (
        <div
          className="font-display text-2xl italic tracking-wide opacity-45"
          style={{ color: primaryInk }}
        >
          ...
        </div>
      )}
    </div>
  );
}
