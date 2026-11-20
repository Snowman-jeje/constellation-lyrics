import { useGSAP } from '@gsap/react';
import { TerminalWindow } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeActiveWordProgress,
  findActiveLineIndex,
  formatTerminalTimestamp,
  type LyricStyleRendererProps,
  resolveLineWords,
} from '../../engine/lyricTiming';

gsap.registerPlugin(useGSAP);

export function TerminalLyrics({
  lines,
  getPosition,
  isPlaying,
  accent,
  isLightBackdrop,
  motionMode,
  bulge,
  fontScale,
  reducedMotion,
  trackTitle,
  trackArtist,
  onLineClick,
}: LyricStyleRendererProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeWordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const clockRef = useRef<HTMLSpanElement | null>(null);

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

  const cfgRef = useRef({
    accent,
    isLightBackdrop,
    motionMode,
    bulge,
    reducedMotion,
  });
  cfgRef.current = { accent, isLightBackdrop, motionMode, bulge, reducedMotion };

  useEffect(() => {
    setActiveIndex(findActiveLineIndex(lines, getPosition()));
  }, [lines, getPosition]);

  useEffect(() => {
    activeWordRefs.current = [];
  }, [activeIndex]);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const pos = getPosition();
      if (clockRef.current) {
        clockRef.current.textContent = `[${formatTerminalTimestamp(pos)}]`;
      }

      const idx = findActiveLineIndex(lines, pos);
      if (idx !== activeIndexRef.current) {
        setActiveIndex(idx);
      }

      if (idx >= 0 && idx < resolvedLines.length) {
        const words = resolvedLines[idx].words;
        const { activeWordIndex } = computeActiveWordProgress(words, pos);
        const cfg = cfgRef.current;
        const accentHex = `rgb(${cfg.accent.r}, ${cfg.accent.g}, ${cfg.accent.b})`;
        const activeInk = cfg.isLightBackdrop ? '#111114' : '#F4F2ED';
        const pendingInk = cfg.isLightBackdrop
          ? 'rgba(17, 17, 20, 0.42)'
          : 'rgba(244, 242, 237, 0.44)';

        for (let i = 0; i < words.length; i++) {
          const span = activeWordRefs.current[i];
          if (!span) continue;

          if (i === activeWordIndex) {
            span.style.color = activeInk;
            span.style.backgroundColor = `rgba(${cfg.accent.r}, ${cfg.accent.g}, ${cfg.accent.b}, ${cfg.isLightBackdrop ? 0.16 : 0.22})`;
            span.style.borderBottom = `1px solid ${accentHex}`;
            span.style.transform =
              cfg.bulge && cfg.motionMode === 'words' && !cfg.reducedMotion
                ? 'translateY(-1px)'
                : 'none';
          } else if (i < activeWordIndex) {
            span.style.color = activeInk;
            span.style.backgroundColor = 'transparent';
            span.style.borderBottom = '1px solid transparent';
            span.style.transform = 'none';
          } else {
            span.style.color = pendingInk;
            span.style.backgroundColor = 'transparent';
            span.style.borderBottom = '1px solid transparent';
            span.style.transform = 'none';
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lines, resolvedLines, getPosition]);

  useGSAP(
    () => {
      const vp = viewportRef.current;
      const track = trackRef.current;
      if (!vp || !track) return;

      const row = activeIndex >= 0 ? rowRefs.current[activeIndex] : rowRefs.current[0] || null;
      const vpH = vp.clientHeight;
      let targetY = vpH * 0.4 - 24;

      if (row) {
        const rowCenter = row.offsetTop + row.offsetHeight * 0.5;
        targetY = Math.min(20, vpH * 0.45 - rowCenter);
      }

      gsap.to(track, {
        y: targetY,
        duration: reducedMotion ? 0 : 0.46,
        ease: 'power3.out',
        overwrite: 'auto',
      });
    },
    { scope: viewportRef, dependencies: [activeIndex, fontScale, reducedMotion, lines.length] },
  );

  const clampedScale = Math.max(0.75, Math.min(1.4, fontScale));
  const textPx = Math.round(16 * clampedScale);
  const accentCss = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const mutedInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.56)' : '#8E8A82';
  const shellStyle = isLightBackdrop
    ? {
        backgroundColor: 'rgba(17, 17, 20, 0.04)',
        borderColor: 'rgba(17, 17, 20, 0.12)',
      }
    : undefined;
  const coreStyle = isLightBackdrop
    ? {
        backgroundColor: 'rgba(255, 255, 255, 0.88)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
      }
    : undefined;

  const streamLabel = trackTitle
    ? trackArtist
      ? `${trackArtist} - ${trackTitle}`
      : trackTitle
    : 'lyric-stream';

  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-16 md:px-14">
      <div
        className="bezel-shell h-[min(68vh,560px)] w-full max-w-4xl"
        style={shellStyle}
      >
        <div
          className="bezel-core flex h-full w-full flex-col overflow-hidden"
          style={coreStyle}
        >
          {/* Console Telemetry Header */}
          <div
            className="flex shrink-0 items-center justify-between border-b px-5 py-3 font-mono text-xs tabular-nums"
            style={{
              borderColor: isLightBackdrop ? 'rgba(17, 17, 20, 0.08)' : 'rgba(255, 255, 255, 0.08)',
              color: mutedInk,
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <TerminalWindow weight="light" className="h-4 w-4 shrink-0" style={{ color: accentCss }} />
              <span className="truncate font-medium" style={{ color: primaryInk }}>
                {streamLabel}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden sm:inline" style={{ color: mutedInk }}>
                {isPlaying ? 'stdout:live' : 'stdout:paused'}
              </span>
              <span ref={clockRef} style={{ color: accentCss }}>
                [00:00.00]
              </span>
            </div>
          </div>

          {/* Live Stdout Stream Viewport */}
          <div
            ref={viewportRef}
            className="relative flex-1 overflow-hidden px-5 py-4 font-mono tabular-nums"
            style={{
              maskImage:
                'linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, transparent 100%)',
            }}
          >
            <div ref={trackRef} className="flex flex-col gap-2.5 will-change-transform">
              {resolvedLines.map(({ line, words }, idx) => {
                const isActive = idx === activeIndex;
                const isCompleted = activeIndex >= 0 && idx < activeIndex;
                const dist = activeIndex >= 0 ? Math.abs(idx - activeIndex) : idx;
                const isVisible = dist <= 16;

                const rowOpacity = isActive
                  ? 1
                  : isCompleted
                    ? Math.max(0.24, 0.5 - (activeIndex - idx) * 0.03)
                    : Math.max(0.18, 0.36 - dist * 0.02);

                return (
                  <button
                    key={`${line.line_index}-${line.start_time}`}
                    ref={(el) => {
                      rowRefs.current[idx] = el;
                    }}
                    type="button"
                    onClick={() => onLineClick?.(line.start_time)}
                    disabled={!onLineClick}
                    className={`group flex w-full items-baseline gap-3.5 rounded-lg px-2.5 py-1.5 text-left transition-opacity duration-200 focus:outline-none ${
                      onLineClick ? 'cursor-pointer hover:!opacity-95' : 'cursor-default'
                    }`}
                    style={{
                      fontSize: `${textPx}px`,
                      lineHeight: 1.55,
                      opacity: isVisible ? rowOpacity : 0,
                      pointerEvents: isVisible ? 'auto' : 'none',
                      backgroundColor: isActive
                        ? isLightBackdrop
                          ? 'rgba(17, 17, 20, 0.035)'
                          : 'rgba(255, 255, 255, 0.035)'
                        : 'transparent',
                    }}
                  >
                    <span
                      className="shrink-0 select-none text-[0.78em] tabular-nums"
                      style={{ color: isActive ? accentCss : mutedInk }}
                    >
                      [{formatTerminalTimestamp(line.start_time)}]
                    </span>

                    <span className="min-w-0 flex-1 break-words" style={{ color: primaryInk }}>
                      {isActive && words.length > 0 ? (
                        <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em]">
                          {words.map((w, wIdx) => (
                            <span
                              key={`${w.start}-${wIdx}`}
                              ref={(el) => {
                                activeWordRefs.current[wIdx] = el;
                              }}
                              className="inline-block rounded-sm px-0.5 transition-transform duration-100"
                            >
                              {w.word}
                            </span>
                          ))}
                          <span
                            aria-hidden="true"
                            className={`ml-1 inline-block h-[1em] w-[0.55em] translate-y-[0.12em] ${
                              isPlaying && !reducedMotion ? 'oa-cursor-blink' : ''
                            }`}
                            style={{ backgroundColor: accentCss }}
                          />
                        </span>
                      ) : (
                        <span>{line.text}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
