import { Disc, MusicNotes, Sparkle, Waveform } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';
import {
  calibrateAccentRgb,
  type LyricStyleRendererProps,
  usePrefersReducedMotion,
} from '../../engine/lyricTiming';
import type { ColorPalette, LyricsData } from '../../types/music';
import type { LyricsBackdrop, LyricsMotion, LyricsStyle } from '../../types/suite';
import { ConstellationCanvas } from '../ConstellationCanvas';
import { BigWordsLyrics } from './BigWordsLyrics';
import { LensLyrics } from './LensLyrics';
import { LinesLyrics } from './LinesLyrics';
import { TerminalLyrics } from './TerminalLyrics';

export interface LyricsStageProps {
  lyrics: LyricsData | null;
  lyricsLoading: boolean;
  getPosition: () => number;
  isPlaying: boolean;
  palette: ColorPalette;
  artUrl: string;
  styleKind: LyricsStyle;
  backdrop: LyricsBackdrop;
  motionMode: LyricsMotion;
  scatter: boolean;
  tilt: boolean;
  bulge: boolean;
  coverInWords: boolean;
  fontScale: number;
  beat: number;
  bass: number;
  trackTitle?: string;
  trackArtist?: string;
  onLineClick?: (timeSec: number) => void;
  syncOffset?: number;
}

export function LyricsStage({
  lyrics,
  lyricsLoading,
  getPosition,
  isPlaying,
  palette,
  artUrl,
  styleKind,
  backdrop,
  motionMode,
  scatter,
  tilt,
  bulge,
  coverInWords,
  fontScale,
  beat,
  bass,
  trackTitle,
  trackArtist,
  onLineClick,
  syncOffset = 0,
}: LyricsStageProps) {
  const osReducedMotion = usePrefersReducedMotion();
  const reducedMotion = osReducedMotion || motionMode === 'standing';
  const isLightBackdrop = backdrop === 'white';

  const accent = useMemo(
    () => calibrateAccentRgb(palette, isLightBackdrop),
    [palette, isLightBackdrop],
  );

  const adjustedGetPosition = useCallback(
    () => getPosition() + syncOffset,
    [getPosition, syncOffset],
  );

  const trackKey = `${trackArtist ?? ''} - ${trackTitle ?? ''}`;
  const hasSynced = Boolean(lyrics && lyrics.has_synced && lyrics.lines.length > 0);
  const plainText = lyrics?.plain?.trim() || '';

  const primaryInk = isLightBackdrop ? '#111114' : '#F4F2ED';
  const mutedInk = isLightBackdrop ? 'rgba(17, 17, 20, 0.54)' : '#8E8A82';
  const accentCss = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;

  const rendererProps: LyricStyleRendererProps = {
    lines: lyrics?.lines || [],
    getPosition: adjustedGetPosition,
    isPlaying,
    palette,
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
    bass,
    reducedMotion,
    trackTitle,
    trackArtist,
    onLineClick,
  };

  const shellLightStyle = isLightBackdrop
    ? {
        backgroundColor: 'rgba(17, 17, 20, 0.04)',
        borderColor: 'rgba(17, 17, 20, 0.10)',
      }
    : undefined;
  const coreLightStyle = isLightBackdrop
    ? {
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.95)',
      }
    : undefined;

  const renderLoadingSkeleton = () => (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <div className="bezel-shell rounded-full" style={shellLightStyle}>
          <div
            className="bezel-core flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs tracking-[0.14em] uppercase"
            style={{ ...coreLightStyle, color: mutedInk }}
          >
            <Waveform weight="light" className="h-4 w-4" style={{ color: accentCss }} />
            <span>Synchronizing lyric stream</span>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          <div
            className={`h-7 w-3/5 rounded-full ${reducedMotion ? 'opacity-25' : 'oa-skeleton-pulse'}`}
            style={{
              backgroundColor: isLightBackdrop
                ? 'rgba(17, 17, 20, 0.10)'
                : 'rgba(244, 242, 237, 0.12)',
            }}
          />
          <div
            className={`h-10 w-4/5 rounded-full ${reducedMotion ? 'opacity-35' : 'oa-skeleton-pulse'}`}
            style={{
              animationDelay: '180ms',
              backgroundColor: isLightBackdrop
                ? 'rgba(17, 17, 20, 0.14)'
                : 'rgba(244, 242, 237, 0.18)',
            }}
          />
          <div
            className={`h-7 w-2/3 rounded-full ${reducedMotion ? 'opacity-20' : 'oa-skeleton-pulse'}`}
            style={{
              animationDelay: '360ms',
              backgroundColor: isLightBackdrop
                ? 'rgba(17, 17, 20, 0.08)'
                : 'rgba(244, 242, 237, 0.10)',
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderPlainLyrics = () => (
    <div className="relative flex h-full w-full flex-col items-center justify-center px-6 py-20 md:px-16">
      <div className="mb-4 bezel-shell rounded-full" style={shellLightStyle}>
        <div
          className="bezel-core flex items-center gap-2 rounded-full px-3.5 py-1 text-[11px] font-medium tracking-[0.16em] uppercase"
          style={{ ...coreLightStyle, color: mutedInk }}
        >
          <MusicNotes weight="light" className="h-3.5 w-3.5" style={{ color: accentCss }} />
          <span>Unsynced lyric sheet</span>
        </div>
      </div>

      <div
        className={`max-h-[62vh] w-full max-w-2xl overflow-y-auto px-4 py-4 text-center whitespace-pre-line ${
          styleKind === 'terminal' ? 'font-mono text-sm leading-7' : 'font-display text-2xl leading-relaxed sm:text-3xl'
        }`}
        style={{
          color: primaryInk,
          maskImage:
            'linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 8%, rgba(0,0,0,1) 92%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 8%, rgba(0,0,0,1) 92%, transparent 100%)',
        }}
      >
        {plainText}
      </div>
    </div>
  );

  const renderEmptyState = () => {
    const hasTrack = Boolean(trackTitle && trackTitle !== 'No Track Playing');
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <div className="bezel-shell max-w-md" style={shellLightStyle}>
          <div
            className="bezel-core flex flex-col items-center gap-3 px-8 py-7 text-center"
            style={coreLightStyle}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full border"
              style={{
                borderColor: isLightBackdrop
                  ? 'rgba(17, 17, 20, 0.12)'
                  : 'rgba(255, 255, 255, 0.10)',
                backgroundColor: `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.10)`,
              }}
            >
              {hasTrack ? (
                <Sparkle weight="light" className="h-5 w-5" style={{ color: accentCss }} />
              ) : (
                <Disc weight="light" className="h-5 w-5" style={{ color: accentCss }} />
              )}
            </div>

            <div className="font-display text-2xl tracking-tight" style={{ color: primaryInk }}>
              {hasTrack ? trackTitle : 'Awaiting Audio Signal'}
            </div>

            <p className="font-sans text-xs tracking-wide" style={{ color: mutedInk }}>
              {hasTrack
                ? `${trackArtist ? `${trackArtist} : ` : ''}Instrumental or no timed lyrics available`
                : 'Start playback in your media player to illuminate the stage'}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const transition = reducedMotion
    ? { duration: 0.01 }
    : { duration: 0.35, ease: [0.32, 0.72, 0, 1] as const };

  return (
    <section
      className="relative z-[5] h-full w-full overflow-hidden"
      style={
        {
          '--oa-accent-rgb': `${accent.r}, ${accent.g}, ${accent.b}`,
        } as React.CSSProperties
      }
      aria-label="Lyrics Stage"
    >
      {/* Keep Constellation starfield mounted cleanly when stars mode is active */}
      {styleKind === 'stars' && (
        <ConstellationCanvas
          lyrics={lyrics}
          palette={palette}
          syncOffset={syncOffset}
          trackKey={trackKey}
          getPosition={getPosition}
          fontScale={fontScale}
          lightMode={isLightBackdrop}
          beat={beat}
          reducedMotion={reducedMotion}
          showAmbientGlow={backdrop !== 'live' && backdrop !== 'white'}
          positionMode="absolute"
        />
      )}

      <AnimatePresence mode="wait">
        {lyricsLoading && !hasSynced ? (
          <motion.div
            key="stage-loading"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={transition}
            className="h-full w-full"
          >
            {renderLoadingSkeleton()}
          </motion.div>
        ) : !hasSynced ? (
          plainText ? (
            <motion.div
              key="stage-plain"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              className="h-full w-full"
            >
              {renderPlainLyrics()}
            </motion.div>
          ) : styleKind === 'stars' ? (
            <motion.div
              key="stage-stars-ambient"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              className="pointer-events-none flex h-full w-full items-end justify-center pb-28"
            >
              <div className="bezel-shell rounded-full" style={shellLightStyle}>
                <div
                  className="bezel-core flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] tracking-[0.16em] uppercase"
                  style={{ ...coreLightStyle, color: mutedInk }}
                >
                  <Sparkle weight="light" className="h-3.5 w-3.5" style={{ color: accentCss }} />
                  <span>
                    {isPlaying
                      ? 'Ambient Starfield'
                      : trackTitle && trackTitle !== 'No Track Playing'
                        ? trackTitle
                        : 'Awaiting Playback'}
                  </span>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="stage-empty"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={transition}
              className="h-full w-full"
            >
              {renderEmptyState()}
            </motion.div>
          )
        ) : styleKind === 'stars' ? (
          <motion.div
            key="style-stars"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="pointer-events-none h-full w-full"
          />
        ) : (
          <motion.div
            key={`style-${styleKind}`}
            initial={{ opacity: 0, scale: 0.988 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.988 }}
            transition={transition}
            className="h-full w-full"
          >
            {styleKind === 'lines' && <LinesLyrics {...rendererProps} />}
            {styleKind === 'bigWords' && <BigWordsLyrics {...rendererProps} />}
            {styleKind === 'lens' && <LensLyrics {...rendererProps} />}
            {styleKind === 'terminal' && <TerminalLyrics {...rendererProps} />}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
