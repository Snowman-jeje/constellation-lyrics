import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { motion, useReducedMotion } from 'framer-motion';
import { MusicNote, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react';
import { getCalibratedAccent, isTauriRuntime, setWindowIgnoreCursor } from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette, TrackInfo } from '../../types/music';

gsap.registerPlugin(useGSAP);

interface DesktopTurntableProps {
  track: TrackInfo | null;
  artUrl: string;
  palette: ColorPalette;
  displayPosition?: number;
  standalone?: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function DesktopTurntable({
  track,
  artUrl,
  palette,
  displayPosition = 0,
  standalone = false,
  onPlayPause,
  onPrev,
  onNext,
}: DesktopTurntableProps) {
  const { settings } = useSuiteStore();
  const { desktop } = settings;
  const reducedMotion = useReducedMotion();

  const scopeRef = useRef<HTMLDivElement | null>(null);
  const armRef = useRef<HTMLDivElement | null>(null);

  const isPlaying = track?.status === 'Playing';
  const duration = track?.length || 0;
  const progress = duration > 0 ? Math.min(1, Math.max(0, displayPosition / duration)) : 0;
  const activeArmAngle = isPlaying ? -4 + progress * 11 : -28;

  useGSAP(
    () => {
      if (!armRef.current) return;
      gsap.to(armRef.current, {
        rotation: activeArmAngle,
        duration: reducedMotion ? 0 : 0.75,
        ease: 'power3.out',
        transformOrigin: '50% 14%',
      });
    },
    { scope: scopeRef, dependencies: [activeArmAngle, reducedMotion] },
  );

  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return;
    void setWindowIgnoreCursor(false);
  }, [standalone]);

  const accent = getCalibratedAccent(palette);
  const sizePx = Math.round(188 * desktop.turntableSize);

  return (
    <motion.div
      ref={scopeRef}
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: desktop.turntableOpacity, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.3 }}
      data-tauri-drag-region={standalone ? true : undefined}
      className={
        standalone
          ? 'flex h-screen w-screen items-center justify-center'
          : 'fixed bottom-24 left-8 z-[19]'
      }
    >
      <div
        className="group relative flex items-center justify-center rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-2.5 backdrop-blur-2xl"
        style={{ width: sizePx + 38, height: sizePx + 24 }}
      >
        {/* Machined Plinth Core */}
        <div className="relative flex h-full w-full items-center justify-center rounded-[calc(2rem-0.5rem)] bg-[#0E0E12]/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
          {/* Vinyl Platter */}
          <div
            className="relative flex items-center justify-center rounded-full border border-white/[0.08] shadow-[inset_0_0_24px_rgba(0,0,0,0.9)] animate-spin"
            style={{
              width: sizePx - 14,
              height: sizePx - 14,
              animationDuration: '8.5s',
              animationPlayState: isPlaying && !reducedMotion ? 'running' : 'paused',
              background:
                'repeating-radial-gradient(circle at 50% 50%, #09090C 0px, #09090C 2.2px, #131319 3px, #0A0A0D 4px)',
            }}
          >
            {/* Specular Vinyl Sheen */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full opacity-35"
              style={{
                background:
                  'conic-gradient(from 35deg, transparent 0deg, rgba(255,255,255,0.12) 28deg, transparent 64deg, transparent 180deg, rgba(255,255,255,0.10) 210deg, transparent 248deg)',
              }}
            />

            {/* Outer Groove Rim */}
            <div
              className="pointer-events-none absolute inset-2 rounded-full border"
              style={{ borderColor: `rgba(${accent.rgb}, 0.16)` }}
            />

            {/* Center Label */}
            <div
              className="relative flex items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#15151B]"
              style={{ width: '40%', height: '40%' }}
            >
              {artUrl ? (
                <img
                  src={artUrl}
                  alt={track?.title || 'Vinyl'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <MusicNote size={20} weight="light" className="text-[#D6B98C]/75" />
              )}
              <div className="absolute h-2.5 w-2.5 rounded-full border border-white/25 bg-[#070709]" />
            </div>
          </div>

          {/* Gimbal + Tonearm */}
          <div className="pointer-events-none absolute right-3.5 top-3.5 h-[72%] w-10">
            {/* Gimbal Base */}
            <div className="absolute right-1 top-1 h-5 w-5 rounded-full border border-white/15 bg-[#191920] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" />
            <div
              ref={armRef}
              className="absolute right-[11px] top-3 flex flex-col items-center"
              style={{ height: '82%' }}
            >
              <div className="h-2.5 w-2.5 rounded-full border border-white/30 bg-[#D6B98C]/85" />
              <div className="w-[2px] flex-1 bg-gradient-to-b from-[#EAE6DF] via-[#9E9A92] to-[#D6B98C]" />
              <div className="h-3 w-1.5 -rotate-12 rounded-sm border border-white/20 bg-[#1B1B22]" />
            </div>
          </div>

          {/* Minimal Hover Transport Pill */}
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.12] bg-[#0E0E12]/90 px-2 py-1 opacity-0 backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous track"
              title="Previous"
              className="flex h-6 w-6 items-center justify-center rounded-full text-[#F4F2ED]/85 transition-colors hover:bg-white/[0.1]"
            >
              <SkipBack size={13} weight="light" />
            </button>
            <button
              type="button"
              onClick={onPlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-[#F4F2ED] transition-colors hover:bg-white/[0.16]"
              style={{ color: accent.css }}
            >
              {isPlaying ? (
                <Pause size={13} weight="light" />
              ) : (
                <Play size={13} weight="light" className="translate-x-[0.5px]" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              title="Next"
              className="flex h-6 w-6 items-center justify-center rounded-full text-[#F4F2ED]/85 transition-colors hover:bg-white/[0.1]"
            >
              <SkipForward size={13} weight="light" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
