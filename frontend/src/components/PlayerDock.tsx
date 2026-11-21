import { useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CornersIn,
  CornersOut,
  GearSix,
  LockSimple,
  MusicNote,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkle,
} from '@phosphor-icons/react';
import { getCalibratedAccent, resolveTrackArtUrl } from '../store/tauriBridge';
import type { ColorPalette, TrackInfo } from '../types/music';
import type { LyricsStyle } from '../types/suite';
import { BezelPanel } from './suite/AtelierPrimitives';

interface PlayerDockProps {
  visible: boolean;
  track: TrackInfo | null;
  palette: ColorPalette;
  displayPosition: number;
  syncOffset: number;
  isFullscreen: boolean;
  lyricsStyle: LyricsStyle;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onOffsetChange: (delta: number) => void;
  onResetOffset?: () => void;
  onCycleLyricsStyle: () => void;
  onOpenMixer: () => void;
  onOpenLock: () => void;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function PlayerDock({
  visible,
  track,
  palette,
  displayPosition,
  syncOffset,
  isFullscreen,
  lyricsStyle,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onOffsetChange,
  onResetOffset,
  onCycleLyricsStyle,
  onOpenMixer,
  onOpenLock,
  onOpenSettings,
  onToggleFullscreen,
  onMouseEnter,
  onMouseLeave,
}: PlayerDockProps) {
  const trackBarRef = useRef<HTMLDivElement | null>(null);

  const isPlaying = track?.status === 'Playing';
  const duration = track?.length || 0;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (displayPosition / duration) * 100)) : 0;
  const accent = getCalibratedAccent(palette);
  const artSrc = resolveTrackArtUrl(track);

  const handleScrub = (clientX: number) => {
    if (!trackBarRef.current || duration <= 0) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <footer
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed bottom-[3vh] left-1/2 z-30 w-[min(94vw,580px)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        visible
          ? 'pointer-events-auto -translate-x-1/2 translate-y-0 opacity-100'
          : 'pointer-events-none -translate-x-1/2 translate-y-4 opacity-0'
      }`}
    >
      <BezelPanel
        radiusClass="rounded-[1.65rem]"
        innerRadiusClass="rounded-[calc(1.65rem-0.375rem)]"
        innerClassName="flex flex-col gap-2.5 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          {/* Album Art */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.04]">
            {artSrc ? (
              <img
                src={artSrc}
                alt={track?.album || 'Cover'}
                className="h-full w-full object-cover"
              />
            ) : (
              <MusicNote size={18} weight="light" className="text-[#8E8A82]" />
            )}
          </div>

          {/* Track Meta */}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="truncate text-[13px] font-medium tracking-tight text-[#F4F2ED]">
              {track?.title || 'No Active Media'}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[#8E8A82]">
              {track?.artist || 'Awaiting playback'}
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={onPrev}
              title="Previous"
              aria-label="Previous track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#F4F2ED]/85 transition-colors hover:bg-white/[0.08]"
            >
              <SkipBack size={16} weight="light" />
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={onPlayPause}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.07] text-[#F4F2ED] transition-colors hover:bg-white/[0.14]"
              style={{ borderColor: `rgba(${accent.rgb}, 0.35)` }}
            >
              {isPlaying ? (
                <Pause size={17} weight="light" />
              ) : (
                <Play size={17} weight="light" className="translate-x-[1px]" />
              )}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={onNext}
              title="Next"
              aria-label="Next track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#F4F2ED]/85 transition-colors hover:bg-white/[0.08]"
            >
              <SkipForward size={16} weight="light" />
            </motion.button>
          </div>

          {/* Sync Offset + Quick Switchers */}
          <div className="hidden items-center gap-0.5 sm:flex">
            <button
              type="button"
              onClick={() => onOffsetChange(-0.2)}
              title="Offset -0.2s"
              className="rounded-md px-1.5 py-1 font-mono text-[10px] tabular-nums text-[#8E8A82] transition-colors hover:bg-white/[0.07] hover:text-[#F4F2ED]"
            >
              -0.2
            </button>
            <button
              type="button"
              onClick={onResetOffset}
              title="Reset offset (or press 0 / Backspace)"
              className="min-w-[42px] cursor-pointer rounded px-1 text-center font-mono text-[10px] tabular-nums text-[#F4F2ED]/85 transition-colors hover:bg-white/[0.08] hover:text-[#F4F2ED]"
            >
              {syncOffset >= 0 ? '+' : ''}
              {syncOffset.toFixed(1)}s
            </button>
            <button
              type="button"
              onClick={() => onOffsetChange(0.2)}
              title="Offset +0.2s"
              className="rounded-md px-1.5 py-1 font-mono text-[10px] tabular-nums text-[#8E8A82] transition-colors hover:bg-white/[0.07] hover:text-[#F4F2ED]"
            >
              +0.2
            </button>
          </div>

          <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2">
            <button
              type="button"
              onClick={onCycleLyricsStyle}
              title={`Lyrics style: ${lyricsStyle}`}
              aria-label="Cycle lyrics style"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8A82] transition-colors hover:bg-white/[0.08] hover:text-[#F4F2ED]"
            >
              <Sparkle size={15} weight="light" />
            </button>
            <button
              type="button"
              onClick={onOpenMixer}
              title="Audio Mixer"
              aria-label="Audio Mixer"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8A82] transition-colors hover:bg-white/[0.08] hover:text-[#F4F2ED]"
            >
              <SlidersHorizontal size={15} weight="light" />
            </button>
            <button
              type="button"
              onClick={onOpenLock}
              title="Lock Mode (Ctrl+Shift+L)"
              aria-label="Lock Mode"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8A82] transition-colors hover:bg-white/[0.08] hover:text-[#F4F2ED]"
            >
              <LockSimple size={15} weight="light" />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              title="Fullscreen (F11)"
              aria-label="Toggle fullscreen"
              className="hidden h-7 w-7 items-center justify-center rounded-full text-[#8E8A82] transition-colors hover:bg-white/[0.08] hover:text-[#F4F2ED] sm:flex"
            >
              {isFullscreen ? (
                <CornersIn size={15} weight="light" />
              ) : (
                <CornersOut size={15} weight="light" />
              )}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-[#F4F2ED] transition-colors hover:bg-white/[0.14]"
            >
              <GearSix size={15} weight="light" />
            </button>
          </div>
        </div>

        {/* Scrubber */}
        <div className="flex items-center gap-2.5">
          <span className="w-8 font-mono text-[10px] tabular-nums text-[#8E8A82]">
            {formatTime(displayPosition)}
          </span>
          <div
            ref={trackBarRef}
            onClick={(e) => handleScrub(e.clientX)}
            className="group relative flex h-3 flex-1 cursor-pointer items-center"
          >
            <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.10]">
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{
                  width: `${pct}%`,
                  backgroundColor: accent.css,
                }}
              />
            </div>
          </div>
          <span className="w-8 text-right font-mono text-[10px] tabular-nums text-[#8E8A82]">
            {formatTime(duration)}
          </span>
        </div>
      </BezelPanel>
    </footer>
  );
}
