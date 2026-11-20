import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Disc,
  LockOpen,
  MusicNote,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkle,
  TextT,
} from '@phosphor-icons/react';
import { getCalibratedAccent } from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette, LyricsData, TrackInfo } from '../../types/music';
import type { BeatFrame, LockModeKind, LyricsBackdrop } from '../../types/suite';
import { AlbumBackdrop } from '../AlbumBackdrop';
import { BorderAura } from '../BorderAura';
import { LyricsStage } from '../visuals/LyricsStage';
import { BezelPanel } from './AtelierPrimitives';

interface LockScreenModeProps {
  open: boolean;
  standalone?: boolean;
  track: TrackInfo | null;
  artUrl: string;
  lyrics: LyricsData | null;
  lyricsLoading: boolean;
  palette: ColorPalette;
  getPosition: () => number;
  beat: BeatFrame;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLineClick?: (seconds: number) => void;
  onDismiss: () => void;
}

export function LockScreenMode({
  open,
  standalone = false,
  track,
  artUrl,
  lyrics,
  lyricsLoading,
  palette,
  getPosition,
  beat,
  onPlayPause,
  onPrev,
  onNext,
  onLineClick,
  onDismiss,
}: LockScreenModeProps) {
  const { settings, updateSection } = useSuiteStore();
  const { lock, lyrics: lyricsCfg, live, glow, desktop } = settings;
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!open && !standalone) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [open, standalone]);

  useEffect(() => {
    if (!open && !standalone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, standalone, onDismiss]);

  const isPlaying = track?.status === 'Playing';
  const accent = getCalibratedAccent(palette);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const mappedBackdrop: LyricsBackdrop =
    lock.backdrop === 'cover' ? 'cover' : lock.backdrop === 'picture' ? 'aura' : 'live';

  const clockBlock = (compact: boolean) => {
    const timeEl = (
      <div className="flex flex-col items-center text-center select-none">
        <div
          className={`font-display font-medium leading-none tracking-[0.02em] text-[#F4F2ED] tabular-nums ${
            compact
              ? 'text-[clamp(2.2rem,5vw,3.4rem)]'
              : lock.mode === 'enlarged'
                ? 'text-[clamp(4.8rem,14vw,9.5rem)]'
                : 'text-[clamp(3.6rem,9vw,6.2rem)]'
          }`}
        >
          {hh}
          <span style={{ color: accent.css }} className="mx-1 font-light">
            :
          </span>
          {mm}
        </div>
        <div className="mt-1.5 font-sans text-[11px] uppercase tracking-[0.3em] text-[#8E8A82]">
          {dateLabel}
        </div>
      </div>
    );

    return (
      <div
        style={{
          transform: `scale(${compact ? Math.min(1.05, lock.clockSize) : lock.clockSize})`,
          transformOrigin: 'top center',
        }}
      >
        {lock.clockGlass ? (
          <BezelPanel
            radiusClass="rounded-[2rem]"
            innerRadiusClass="rounded-[calc(2rem-0.375rem)]"
            innerClassName={compact ? 'px-6 py-3' : 'px-10 py-6'}
          >
            {timeEl}
          </BezelPanel>
        ) : (
          timeEl
        )}
      </div>
    );
  };

  const vinylRecord = (sizePx: number) => (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full border border-white/[0.12] shadow-[inset_0_0_24px_rgba(0,0,0,0.85)] animate-spin"
      style={{
        width: sizePx,
        height: sizePx,
        animationDuration: '10s',
        animationPlayState: isPlaying && !reducedMotion ? 'running' : 'paused',
        background:
          'repeating-radial-gradient(circle, #09090C 0px, #09090C 2.5px, #15151C 3.2px, #0A0A0D 4.5px)',
      }}
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded-full border border-white/20 bg-[#15151B]"
        style={{ width: '42%', height: '42%' }}
      >
        {artUrl ? (
          <img src={artUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <MusicNote size={Math.round(sizePx * 0.16)} weight="light" className="text-[#D6B98C]" />
        )}
      </div>
      <div className="absolute h-2.5 w-2.5 rounded-full border border-white/25 bg-[#070709]" />
    </div>
  );

  return (
    <AnimatePresence>
      {(open || standalone) && (
        <motion.div
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-[#070709]"
        >
          {/* Ambient Lock Backdrop */}
          <AlbumBackdrop
            artUrl={artUrl}
            palette={palette}
            backdrop={mappedBackdrop}
            motionMode={lyricsCfg.motion}
            liveScene={live.scene}
            liveReaction={live.reaction}
            liveSpeed={live.speed}
            beat={beat.beat}
            bass={beat.bass}
            parallaxEnabled={desktop.wallpaperParallax}
            parallaxAmount={desktop.wallpaperParallaxAmount}
            weatherKind={desktop.wallpaperWeather}
            blurOverride={lock.blur}
          />

          {glow.enabled && glow.onLock && (
            <BorderAura
              palette={palette}
              isPlaying={isPlaying}
              enabled={glow.enabled && glow.onLock}
              style={glow.style}
              motion={glow.motion}
              thickness={glow.thickness}
              brightness={glow.brightness}
              ownColors={glow.ownColors}
              colorFirst={glow.colorFirst}
              colorSecond={glow.colorSecond}
              beat={beat.beat}
              bass={beat.bass}
            />
          )}

          {/* Lock Content Stage */}
          {lock.mode === 'lyrics' ? (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-between pt-8 pb-20">
              <div className="z-20">{clockBlock(true)}</div>

              <div className="relative w-full flex-1">
                <LyricsStage
                  lyrics={lyrics}
                  lyricsLoading={lyricsLoading}
                  getPosition={getPosition}
                  isPlaying={isPlaying}
                  palette={palette}
                  artUrl={artUrl}
                  styleKind={lyricsCfg.style}
                  backdrop={mappedBackdrop}
                  motionMode={lyricsCfg.motion}
                  scatter={lyricsCfg.scatter}
                  tilt={lyricsCfg.tilt}
                  bulge={lyricsCfg.bulge}
                  coverInWords={lyricsCfg.coverInWords}
                  fontScale={lyricsCfg.fontScale}
                  beat={beat.beat}
                  bass={beat.bass}
                  trackTitle={track?.title}
                  trackArtist={track?.artist}
                  onLineClick={onLineClick}
                />
              </div>

              {lock.showRecord && (
                <div className="pointer-events-none fixed bottom-20 left-8 z-20 hidden sm:block">
                  {vinylRecord(86)}
                </div>
              )}
            </div>
          ) : (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
              {clockBlock(false)}

              {lock.showRecord &&
                vinylRecord(lock.mode === 'enlarged' ? 164 : 118)}

              <BezelPanel
                radiusClass="rounded-full"
                innerRadiusClass="rounded-full"
                innerClassName="flex items-center gap-3.5 px-5 py-2.5 max-w-[min(88vw,420px)]"
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/[0.04]">
                  {artUrl ? (
                    <img src={artUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <MusicNote size={14} weight="light" className="text-[#8E8A82]" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#F4F2ED]">
                    {track?.title || 'Ambient Standby'}
                  </div>
                  <div className="truncate text-[10px] text-[#8E8A82]">
                    {track?.artist || 'Constellation Suite'}
                  </div>
                </div>
              </BezelPanel>
            </div>
          )}

          {/* Subtle Lock Footer Controls */}
          <div className="relative z-30 flex items-center justify-center pb-6">
            <BezelPanel
              radiusClass="rounded-full"
              innerRadiusClass="rounded-full"
              innerClassName="flex items-center gap-2 px-3 py-1.5 opacity-75 transition-opacity hover:opacity-100"
            >
              {/* Mode Chips */}
              {(
                [
                  { id: 'normal', icon: Disc, label: 'Balanced' },
                  { id: 'enlarged', icon: TextT, label: 'Hero Clock' },
                  { id: 'lyrics', icon: Sparkle, label: 'Lyrics' },
                ] as const satisfies ReadonlyArray<{
                  id: LockModeKind;
                  icon: typeof Disc;
                  label: string;
                }>
              ).map((item) => {
                const IconComp = item.icon;
                const active = lock.mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateSection('lock', { mode: item.id })}
                    title={item.label}
                    aria-label={item.label}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                      active ? 'bg-white/[0.14] text-[#F4F2ED]' : 'text-[#8E8A82] hover:text-[#F4F2ED]'
                    }`}
                  >
                    <IconComp size={14} weight="light" />
                  </button>
                );
              })}

              <div className="mx-1 h-4 w-[1px] bg-white/[0.1]" />

              <button
                type="button"
                onClick={onPrev}
                aria-label="Previous"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/80 hover:bg-white/[0.08]"
              >
                <SkipBack size={14} weight="light" />
              </button>
              <button
                type="button"
                onClick={onPlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-[#F4F2ED] hover:bg-white/[0.14]"
              >
                {isPlaying ? (
                  <Pause size={14} weight="light" />
                ) : (
                  <Play size={14} weight="light" className="translate-x-[0.5px]" />
                )}
              </button>
              <button
                type="button"
                onClick={onNext}
                aria-label="Next"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/80 hover:bg-white/[0.08]"
              >
                <SkipForward size={14} weight="light" />
              </button>

              <div className="mx-1 h-4 w-[1px] bg-white/[0.1]" />

              <button
                type="button"
                onClick={onDismiss}
                title="Dismiss Lock Screen (Esc)"
                aria-label="Unlock"
                className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-[11px] text-[#F4F2ED] hover:bg-white/[0.16]"
              >
                <LockOpen size={13} weight="light" />
                <span>Unlock</span>
              </button>
            </BezelPanel>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
