import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calibrateAccentRgb,
  deriveSecondaryPalette,
  usePrefersReducedMotion,
} from '../engine/lyricTiming';
import { toSafeCssUrl } from '../store/tauriBridge';
import type { ColorPalette } from '../types/music';
import type {
  LiveSceneKind,
  LyricsBackdrop,
  LyricsMotion,
  WallpaperWeatherKind,
} from '../types/suite';
import { LiveSceneCanvas } from './visuals/LiveSceneCanvas';
import { WallpaperWeather } from './visuals/WallpaperWeather';

export interface AlbumBackdropProps {
  artUrl: string;
  palette: ColorPalette;
  backdrop: LyricsBackdrop;
  motionMode: LyricsMotion;
  liveScene: LiveSceneKind;
  liveReaction: number;
  liveSpeed: number;
  beat: number;
  bass: number;
  parallaxEnabled?: boolean;
  parallaxAmount?: number;
  weatherKind?: WallpaperWeatherKind;
  blurOverride?: number;
  paused?: boolean;
}

export function AlbumBackdrop({
  artUrl,
  palette,
  backdrop,
  motionMode,
  liveScene,
  liveReaction,
  liveSpeed,
  beat,
  bass,
  parallaxEnabled = true,
  parallaxAmount = 0.5,
  weatherKind = 'none',
  blurOverride,
  paused = false,
}: AlbumBackdropProps) {
  const [prevSrc, setPrevSrc] = useState<string>('');
  const [currSrc, setCurrSrc] = useState<string>('');
  const [prevVisible, setPrevVisible] = useState(false);

  const parallaxRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const osReducedMotion = usePrefersReducedMotion();
  const isStanding = motionMode === 'standing';
  const reducedMotion = osReducedMotion || isStanding;

  const isLightBackdrop = backdrop === 'white';

  const primary = useMemo(
    () => calibrateAccentRgb(palette, isLightBackdrop),
    [palette, isLightBackdrop],
  );
  const secondary = useMemo(() => deriveSecondaryPalette(primary), [primary]);

  // Preload album cover art before crossfading
  useEffect(() => {
    if (!artUrl) {
      setCurrSrc('');
      setPrevSrc('');
      setPrevVisible(false);
      return;
    }
    if (artUrl === currSrc) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (currSrc) {
        setPrevSrc(currSrc);
        setPrevVisible(true);
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => {
          setPrevVisible(false);
        }, 1150);
      }
      setCurrSrc(artUrl);
    };
    img.onerror = () => {
      if (cancelled) return;
      setCurrSrc('');
    };
    img.src = artUrl;

    return () => {
      cancelled = true;
    };
  }, [artUrl, currSrc]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Pointer parallax on GPU transform layer (zero React re-renders)
  useEffect(() => {
    const el = parallaxRef.current;
    if (!el) return;

    const shouldParallax =
      parallaxEnabled &&
      !reducedMotion &&
      parallaxAmount > 0.01 &&
      backdrop !== 'black' &&
      backdrop !== 'white';

    if (!shouldParallax) {
      el.style.transform = 'translate3d(0px, 0px, 0px) scale(1.03)';
      return;
    }

    const maxOffset = Math.max(4, Math.min(28, parallaxAmount * 22));
    let targetX = 0;
    let targetY = 0;
    let currX = 0;
    let currY = 0;
    let rafId = 0;

    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      const ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      targetX = -nx * maxOffset;
      targetY = -ny * maxOffset;
    };

    const tick = () => {
      currX += (targetX - currX) * 0.075;
      currY += (targetY - currY) * 0.075;
      el.style.transform = `translate3d(${currX.toFixed(2)}px, ${currY.toFixed(2)}px, 0px) scale(1.05)`;
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(rafId);
    };
  }, [parallaxEnabled, parallaxAmount, reducedMotion, backdrop]);

  const coverBlurPx = typeof blurOverride === 'number' ? Math.max(0, blurOverride) : 36;
  const safeBeat = reducedMotion ? 0 : Math.max(0, Math.min(1, beat));
  const safeBass = reducedMotion ? 0 : Math.max(0, Math.min(1, bass));
  const auraScale = 1 + safeBeat * 0.025 + safeBass * 0.02;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-colors duration-700"
      style={{
        backgroundColor: isLightBackdrop ? '#F5F3EE' : '#070709',
      }}
      aria-hidden="true"
    >
      {/* Parallax Stage Wrapper */}
      <div
        ref={parallaxRef}
        className="absolute -inset-[3%] will-change-transform"
        style={{ transform: 'translate3d(0px, 0px, 0px) scale(1.03)' }}
      >
        {backdrop === 'black' && (
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 44%, rgba(214, 185, 140, 0.04) 0%, #070709 62%, #050507 100%)',
            }}
          />
        )}

        {backdrop === 'white' && (
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 42%, #FFFFFF 0%, #F5F3EE 62%, #EAE6DD 100%)',
            }}
          />
        )}

        {backdrop === 'cover' && (
          <>
            {!currSrc && !prevSrc && (
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 50% 46%, rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.24) 0%, #070709 72%)`,
                }}
              />
            )}
            {prevSrc && toSafeCssUrl(prevSrc) && (
              <div
                className="album-backdrop-layer"
                style={{
                  backgroundImage: toSafeCssUrl(prevSrc),
                  opacity: prevVisible ? 1 : 0,
                  filter: `blur(${coverBlurPx}px) brightness(0.62) saturate(1.28)`,
                }}
              />
            )}
            {currSrc && toSafeCssUrl(currSrc) && (
              <div
                className="album-backdrop-layer"
                style={{
                  backgroundImage: toSafeCssUrl(currSrc),
                  opacity: 1,
                  filter: `blur(${coverBlurPx}px) brightness(0.62) saturate(1.28)`,
                }}
              />
            )}
            <div
              className="absolute inset-0 z-[1]"
              style={{
                background:
                  'radial-gradient(circle at 50% 48%, rgba(7, 7, 9, 0.22) 0%, rgba(7, 7, 9, 0.56) 62%, rgba(5, 5, 7, 0.90) 100%)',
              }}
            />
          </>
        )}

        {backdrop === 'aura' && (
          <>
            {currSrc && toSafeCssUrl(currSrc) && (
              <div
                className="album-backdrop-layer"
                style={{
                  backgroundImage: toSafeCssUrl(currSrc),
                  opacity: 0.14,
                  filter: `blur(${Math.max(44, coverBlurPx)}px) saturate(1.15)`,
                }}
              />
            )}
            <div
              className="absolute inset-0 transition-transform duration-150 will-change-transform"
              style={{
                transform: `scale(${auraScale.toFixed(4)})`,
                backgroundImage: `
                  radial-gradient(ellipse 68% 58% at 28% 36%, rgba(${primary.r}, ${primary.g}, ${primary.b}, ${0.34 + safeBass * 0.14}) 0%, transparent 66%),
                  radial-gradient(ellipse 64% 60% at 74% 66%, rgba(${secondary.r}, ${secondary.g}, ${secondary.b}, ${0.26 + safeBeat * 0.12}) 0%, transparent 68%),
                  radial-gradient(circle at 50% 50%, rgba(${primary.r}, ${primary.g}, ${primary.b}, ${0.14 + safeBeat * 0.08}) 0%, rgba(7, 7, 9, 0.88) 76%)
                `,
              }}
            />
          </>
        )}

        {backdrop === 'live' && (
          <LiveSceneCanvas
            scene={liveScene}
            palette={palette}
            secondaryPalette={secondary}
            reaction={liveReaction}
            speed={isStanding ? Math.min(0.15, liveSpeed) : liveSpeed}
            beat={safeBeat}
            bass={safeBass}
            reducedMotion={reducedMotion}
            paused={paused}
          />
        )}
      </div>

      {/* Atmospheric Weather Overlay */}
      <WallpaperWeather
        kind={weatherKind}
        isLightBackdrop={isLightBackdrop}
        beat={safeBeat}
        reducedMotion={reducedMotion}
      />

      {/* Subtle Edge Contrast Scrim for Typography Legibility */}
      {!isLightBackdrop && (
        <div
          className="absolute inset-0 z-[3]"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(7, 7, 9, 0) 42%, rgba(7, 7, 9, 0.42) 100%)',
          }}
        />
      )}
    </div>
  );
}
