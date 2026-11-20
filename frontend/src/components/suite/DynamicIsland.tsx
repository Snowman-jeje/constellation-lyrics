import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  BatteryCharging,
  CheckSquare,
  CloudFog,
  CloudRain,
  CloudSun,
  CornersIn,
  CornersOut,
  Cpu,
  Headphones,
  Minus,
  MoonStars,
  MusicNote,
  NotePencil,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Snowflake,
  SpeakerHigh,
  Square,
  Sun,
  Timer,
  Trash,
  Warning,
  Wind,
} from '@phosphor-icons/react';
import { useHardware } from '../../hooks/useHardware';
import { useWeather, type WeatherCategory } from '../../hooks/useWeather';
import {
  getCalibratedAccent,
  isTauriRuntime,
  safeInvoke,
  safeListen,
  setWindowIgnoreCursor,
} from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette, TrackInfo } from '../../types/music';
import type { BeatFrame, IslandMode, SystemHudEvent } from '../../types/suite';

interface SystemHudState {
  volume: number;
  muted: boolean;
  battery_pct: number;
  is_charging: boolean;
  has_battery: boolean;
}
import { AtelierSkeleton, BezelPanel } from './AtelierPrimitives';

gsap.registerPlugin(useGSAP);

interface DynamicIslandProps {
  track: TrackInfo | null;
  artUrl: string;
  palette: ColorPalette;
  displayPosition: number;
  beat: BeatFrame;
  isFullscreen?: boolean;
  standalone?: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
}

const CYCLE_MODES: IslandMode[] = [
  'peek',
  'player',
  'big',
  'weather',
  'timer',
  'notes',
  'tasks',
  'hardware',
];

function formatTimerClock(totalSec: number): string {
  const clamped = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTrackClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playFocusChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const partials = [587.33, 880, 1174.66];
    partials.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.12 / (idx + 1), now + idx * 0.08 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 1.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 1.4);
    });
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1800);
  } catch {
    // Ignore audio context block
  }
}

function WeatherGlyph({ category, size = 18 }: { category: WeatherCategory; size?: number }) {
  if (category === 'clear') return <Sun size={size} weight="light" className="text-[#D6B98C]" />;
  if (category === 'rain' || category === 'storm') {
    return <CloudRain size={size} weight="light" className="text-[#9AC2D6]" />;
  }
  if (category === 'snow') return <Snowflake size={size} weight="light" className="text-[#E6EEF4]" />;
  if (category === 'fog') return <CloudFog size={size} weight="light" className="text-[#8E8A82]" />;
  if (category === 'cloudy') return <Wind size={size} weight="light" className="text-[#8E8A82]" />;
  return <CloudSun size={size} weight="light" className="text-[#D6B98C]" />;
}

function TelemetryRing({
  label,
  pct,
  valueText,
  accent,
}: {
  label: string;
  pct: number;
  valueText: string;
  accent: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = circ - (clamped / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90">
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="2.2"
          />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dash}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
        <span className="absolute font-mono text-[10px] tabular-nums text-[#F4F2ED]">
          {valueText}
        </span>
      </div>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8E8A82]">
        {label}
      </span>
    </div>
  );
}

export function DynamicIsland({
  track,
  artUrl,
  palette,
  displayPosition,
  beat,
  isFullscreen = false,
  standalone = false,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
}: DynamicIslandProps) {
  const { settings, updateSection, notesTasks, saveNotesTasks, pushToast } = useSuiteStore();
  const { island } = settings;
  const reducedMotion = useReducedMotion();

  const [hovered, setHovered] = useState(false);
  const [osFullscreen, setOsFullscreen] = useState(false);
  const [hudOverlay, setHudOverlay] = useState<SystemHudEvent | null>(null);
  const [systemHudState, setSystemHudState] = useState<SystemHudState | null>(null);
  const [cityEditing, setCityEditing] = useState(false);
  const [cityDraft, setCityDraft] = useState(island.weatherCity);
  const [newTaskText, setNewTaskText] = useState('');

  // Focus timer state
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(() => island.timerMinutes * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  const hudTimeoutRef = useRef<number | null>(null);
  const wheelLockRef = useRef(0);
  const bigScopeRef = useRef<HTMLDivElement | null>(null);
  const bigArmRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);

  const activeMode: IslandMode = hudOverlay ? 'hud' : island.mode;
  const isPlaying = track?.status === 'Playing';
  const accent = getCalibratedAccent(palette);

  const { weather, loading: weatherLoading, error: weatherError, refresh: refreshWeather } =
    useWeather(island.weatherCity, activeMode === 'weather');

  const {
    snapshot: hwSnapshot,
    loading: hwLoading,
    error: hwError,
    refresh: refreshHw,
  } = useHardware(activeMode === 'hardware');

  // Sync timer duration when idle and user changes minutes
  useEffect(() => {
    if (!timerRunning) {
      setTimerSecondsLeft(island.timerMinutes * 60);
    }
  }, [island.timerMinutes, timerRunning]);

  // Countdown tick + audio ducker integration
  useEffect(() => {
    if (!timerRunning) return;

    if (island.timerDuckAudio && isTauriRuntime()) {
      void safeInvoke('set_timer_ducking', { active: true });
    }

    const id = window.setInterval(() => {
      setTimerSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          if (island.timerDuckAudio && isTauriRuntime()) {
            void safeInvoke('set_timer_ducking', { active: false });
          }
          playFocusChime();
          pushToast('Focus session complete', 'success');
          return island.timerMinutes * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(id);
      if (island.timerDuckAudio && isTauriRuntime()) {
        void safeInvoke('set_timer_ducking', { active: false });
      }
    };
  }, [timerRunning, island.timerDuckAudio, island.timerMinutes, pushToast]);

  // Listen to native system-hud events
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlistenHudEvent: (() => void) | null = null;
    let unlistenHudLegacy: (() => void) | null = null;
    let unlistenState: (() => void) | null = null;

    void safeInvoke<SystemHudState>('get_system_hud_state').then((st) => {
      if (!cancelled && st) setSystemHudState(st);
    });

    const onHud = (payload: SystemHudEvent) => {
      if (cancelled) return;
      setHudOverlay(payload);
      if (hudTimeoutRef.current) window.clearTimeout(hudTimeoutRef.current);
      hudTimeoutRef.current = window.setTimeout(() => {
        setHudOverlay(null);
      }, 2200);
    };

    void safeListen<SystemHudEvent>('system-hud-event', onHud).then((fn) => {
      if (cancelled) fn();
      else unlistenHudEvent = fn;
    });
    void safeListen<SystemHudEvent>('system-hud', onHud).then((fn) => {
      if (cancelled) fn();
      else unlistenHudLegacy = fn;
    });

    void safeListen<SystemHudState>('system-hud-state', (payload) => {
      if (!cancelled) setSystemHudState(payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenState = fn;
    });

    return () => {
      cancelled = true;
      if (unlistenHudEvent) unlistenHudEvent();
      if (unlistenHudLegacy) unlistenHudLegacy();
      if (unlistenState) unlistenState();
      if (hudTimeoutRef.current) window.clearTimeout(hudTimeoutRef.current);
    };
  }, []);

  // Poll OS fullscreen state & sync native window bounds in standalone mode
  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return;
    void safeInvoke('set_island_bounds', { mode: activeMode, scale: island.scale });
  }, [standalone, activeMode, island.scale]);

  useEffect(() => {
    if (!standalone || !isTauriRuntime() || !island.hideInFullscreen) {
      setOsFullscreen(false);
      return;
    }
    let active = true;
    const check = async () => {
      const fs = await safeInvoke<boolean>('is_fullscreen_app');
      if (active && typeof fs === 'boolean') setOsFullscreen(fs);
    };
    void check();
    const id = window.setInterval(() => void check(), 1500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [standalone, island.hideInFullscreen]);

  const hideInFs = (standalone ? osFullscreen : isFullscreen) && island.hideInFullscreen && !hovered;

  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return;
    void setWindowIgnoreCursor(hideInFs);
  }, [standalone, hideInFs]);

  // GSAP tonearm for expanded Big vinyl card
  const duration = track?.length || 0;
  const trackProgress = duration > 0 ? Math.min(1, Math.max(0, displayPosition / duration)) : 0;
  const bigArmAngle = isPlaying ? -4 + trackProgress * 10 : -26;

  useGSAP(
    () => {
      if (!bigArmRef.current) return;
      gsap.to(bigArmRef.current, {
        rotation: bigArmAngle,
        duration: reducedMotion ? 0 : 0.7,
        ease: 'power3.out',
        transformOrigin: '50% 15%',
      });
    },
    { scope: bigScopeRef, dependencies: [bigArmAngle, activeMode, reducedMotion] },
  );

  const setMode = useCallback(
    (mode: IslandMode) => {
      setHudOverlay(null);
      updateSection('island', { mode });
    },
    [updateSection],
  );

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - wheelLockRef.current < 260) return;
    if (Math.abs(e.deltaY) < 12) return;
    wheelLockRef.current = now;
    const idx = CYCLE_MODES.indexOf(activeMode);
    const curIdx = idx >= 0 ? idx : 0;
    const nextIdx = (curIdx + (e.deltaY > 0 ? 1 : -1) + CYCLE_MODES.length) % CYCLE_MODES.length;
    setMode(CYCLE_MODES[nextIdx]);
  };

  const handleScrub = (clientX: number) => {
    if (!scrubRef.current || duration <= 0) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskText.trim();
    if (!trimmed) return;
    const nextTasks = [
      ...notesTasks.tasks,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: trimmed, done: false },
    ];
    saveNotesTasks({ ...notesTasks, tasks: nextTasks });
    setNewTaskText('');
  };

  const handleToggleTask = (id: string) => {
    const nextTasks = notesTasks.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    saveNotesTasks({ ...notesTasks, tasks: nextTasks });
  };

  const handleDeleteTask = (id: string) => {
    saveNotesTasks({
      ...notesTasks,
      tasks: notesTasks.tasks.filter((t) => t.id !== id),
    });
  };

  const isCharging = Boolean(systemHudState?.is_charging || hwSnapshot?.charging);
  const batteryPct = systemHudState?.has_battery
    ? systemHudState.battery_pct
    : hwSnapshot?.battery_pct ?? null;

  const levelBars = [
    Math.max(0.22, Math.min(1, beat.bass * 1.15 + 0.18)),
    Math.max(0.25, Math.min(1, beat.energy * 1.2 + 0.2)),
    Math.max(0.22, Math.min(1, beat.mid * 1.15 + 0.16)),
    Math.max(0.2, Math.min(1, beat.treble * 1.15 + 0.14)),
  ];

  const widthClass =
    activeMode === 'closed'
      ? 'w-[76px]'
      : activeMode === 'peek'
        ? 'w-[min(88vw,272px)]'
        : activeMode === 'player'
          ? 'w-[min(92vw,368px)]'
          : activeMode === 'hud'
            ? 'w-[min(88vw,288px)]'
            : 'w-[min(92vw,428px)]';

  const pillRadius =
    activeMode === 'big' || activeMode === 'weather' || activeMode === 'timer' || activeMode === 'notes' || activeMode === 'tasks' || activeMode === 'hardware'
      ? 'rounded-[1.85rem]'
      : 'rounded-full';
  const pillInnerRadius =
    activeMode === 'big' || activeMode === 'weather' || activeMode === 'timer' || activeMode === 'notes' || activeMode === 'tasks' || activeMode === 'hardware'
      ? 'rounded-[calc(1.85rem-0.375rem)]'
      : 'rounded-full';

  const totalTimerSec = Math.max(60, island.timerMinutes * 60);
  const timerProgress = Math.max(0, Math.min(1, timerSecondsLeft / totalTimerSec));
  const timerCirc = 2 * Math.PI * 30;

  return (
    <div
      className={
        standalone
          ? 'pointer-events-none flex h-screen w-screen items-start justify-center pt-1.5'
          : 'pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center'
      }
    >
      <motion.div
        layoutId="island-shell"
        onWheel={handleWheel}
        onMouseEnter={() => {
          setHovered(true);
          if (standalone && isTauriRuntime()) void setWindowIgnoreCursor(false);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        animate={{
          opacity: hideInFs ? 0 : 1,
          y: hideInFs ? -18 : 0,
          scale: island.scale,
        }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 360, damping: 32, mass: 0.85 }
        }
        style={{ transformOrigin: 'top center' }}
        className={`pointer-events-auto transition-opacity ${widthClass}`}
      >
        <BezelPanel
          look={island.look}
          radiusClass={pillRadius}
          innerRadiusClass={pillInnerRadius}
          innerClassName="relative overflow-hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            {activeMode === 'closed' && (
              <motion.button
                key="closed"
                type="button"
                onClick={() => setMode('peek')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-label="Expand Dynamic Island"
                title="Expand Dynamic Island"
                className="flex h-3 w-full items-center justify-center px-3"
              >
                <span
                  className="h-[2.5px] w-8 rounded-full transition-colors"
                  style={{ backgroundColor: isPlaying ? accent.css : 'rgba(244,242,237,0.3)' }}
                />
              </motion.button>
            )}

            {activeMode === 'peek' && (
              <motion.div
                key="peek"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between gap-2.5 px-3 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => setMode('player')}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title="Open player pill"
                >
                  <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/[0.05]">
                    {artUrl ? (
                      <img src={artUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <MusicNote size={10} weight="light" className="text-[#8E8A82]" />
                      </div>
                    )}
                  </div>
                  <span className="truncate text-[11px] font-medium text-[#F4F2ED]">
                    {track?.title && track.title !== 'No Track Playing'
                      ? track.title
                      : 'Atelier Standby'}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  {island.focusMode && (
                    <MoonStars size={12} weight="light" className="text-[#D6B98C]" />
                  )}
                  {island.showHeadphones && (
                    <Headphones size={12} weight="light" className="text-[#8E8A82]" />
                  )}
                  {island.showCharging && isCharging && (
                    <BatteryCharging size={12} weight="light" className="text-[#84C9A4]" />
                  )}
                  {island.showLevels && (
                    <div className="flex h-3 items-end gap-[2px]">
                      {levelBars.map((val, idx) => (
                        <span
                          key={idx}
                          className="w-[2px] rounded-full transition-[height] duration-75"
                          style={{
                            height: `${Math.round((isPlaying ? val : 0.25) * 12)}px`,
                            backgroundColor: isPlaying ? accent.css : '#8E8A82',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeMode === 'player' && (
              <motion.div
                key="player"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative flex items-center gap-2.5 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => setMode('big')}
                  className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/[0.04]"
                  title="Expand studio card"
                >
                  {artUrl ? (
                    <img src={artUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <MusicNote size={14} weight="light" className="text-[#8E8A82]" />
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setMode('big')}
                  className="flex min-w-0 flex-1 flex-col text-left"
                >
                  <span className="truncate text-xs font-medium text-[#F4F2ED]">
                    {track?.title || 'No Active Media'}
                  </span>
                  <span className="truncate text-[10px] text-[#8E8A82]">
                    {track?.artist || 'Idle'}
                  </span>
                </button>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={onPrev}
                    aria-label="Previous"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/80 hover:bg-white/[0.08]"
                  >
                    <SkipBack size={13} weight="light" />
                  </button>
                  <button
                    type="button"
                    onClick={onPlayPause}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-[#F4F2ED] hover:bg-white/[0.14]"
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
                    aria-label="Next"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/80 hover:bg-white/[0.08]"
                  >
                    <SkipForward size={13} weight="light" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('big')}
                    aria-label="Expand"
                    title="Expand"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[#8E8A82] hover:text-[#F4F2ED]"
                  >
                    <CornersOut size={12} weight="light" />
                  </button>
                </div>

                {/* Hairline Progress */}
                <div className="absolute inset-x-4 bottom-0 h-[1.5px] overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full transition-[width] duration-100"
                    style={{
                      width: `${Math.round(trackProgress * 1000) / 10}%`,
                      backgroundColor: accent.css,
                    }}
                  />
                </div>
              </motion.div>
            )}

            {activeMode === 'hud' && (
              <motion.div
                key="hud"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="text-[#D6B98C]">
                  {hudOverlay?.kind === 'brightness' ? (
                    <Sun size={16} weight="light" />
                  ) : hudOverlay?.kind === 'charging' ? (
                    <BatteryCharging size={16} weight="light" />
                  ) : hudOverlay?.kind === 'headphones' ? (
                    <Headphones size={16} weight="light" />
                  ) : (
                    <SpeakerHigh size={16} weight="light" />
                  )}
                </span>
                <span className="text-[11px] text-[#8E8A82]">
                  {hudOverlay?.label || 'System Level'}
                </span>
                <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/[0.1]">
                  <div
                    className="h-full rounded-full transition-[width] duration-150"
                    style={{
                      width: `${Math.max(0, Math.min(100, (hudOverlay?.value ?? 0.6) * 100))}%`,
                      backgroundColor: accent.css,
                    }}
                  />
                </div>
                <span className="font-mono text-[11px] tabular-nums text-[#F4F2ED]">
                  {Math.round((hudOverlay?.value ?? 0.6) * 100)}%
                </span>
              </motion.div>
            )}

            {(activeMode === 'big' ||
              activeMode === 'weather' ||
              activeMode === 'timer' ||
              activeMode === 'notes' ||
              activeMode === 'tasks' ||
              activeMode === 'hardware') && (
              <motion.div
                key={`expanded-${activeMode}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-3 p-4"
              >
                {activeMode === 'big' && (
                  <div ref={bigScopeRef} className="flex items-center gap-3.5">
                    {/* Spinning Vinyl or Cover */}
                    {island.bigVinyl ? (
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#08080B]">
                        <div
                          className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/10 animate-spin"
                          style={{
                            animationDuration: '8s',
                            animationPlayState:
                              isPlaying && !reducedMotion ? 'running' : 'paused',
                            background:
                              'repeating-radial-gradient(circle, #0A0A0D 0px, #0A0A0D 2px, #15151C 3px, #09090B 4px)',
                          }}
                        >
                          <div className="h-7 w-7 overflow-hidden rounded-full border border-white/20 bg-[#15151B]">
                            {artUrl ? (
                              <img src={artUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <MusicNote size={11} weight="light" className="text-[#D6B98C]" />
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Mini GSAP Tonearm */}
                        <div
                          ref={bigArmRef}
                          className="pointer-events-none absolute right-2 top-2 flex h-12 flex-col items-center"
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-[#D6B98C]" />
                          <div className="w-[1.5px] flex-1 bg-[#F4F2ED]/80" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.04]">
                        {artUrl ? (
                          <img src={artUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <MusicNote size={22} weight="light" className="text-[#8E8A82]" />
                        )}
                      </div>
                    )}

                    {/* Track Meta & Controls */}
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-display text-lg leading-tight text-[#F4F2ED]">
                          {track?.title || 'No Active Media'}
                        </div>
                        <div className="truncate text-xs text-[#8E8A82]">
                          {track?.artist || 'Awaiting playback'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onPrev}
                          aria-label="Previous"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/85 hover:bg-white/[0.08]"
                        >
                          <SkipBack size={14} weight="light" />
                        </button>
                        <button
                          type="button"
                          onClick={onPlayPause}
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.08] text-[#F4F2ED] hover:bg-white/[0.14]"
                        >
                          {isPlaying ? (
                            <Pause size={15} weight="light" />
                          ) : (
                            <Play size={15} weight="light" className="translate-x-[0.5px]" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={onNext}
                          aria-label="Next"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#F4F2ED]/85 hover:bg-white/[0.08]"
                        >
                          <SkipForward size={14} weight="light" />
                        </button>
                      </div>

                      {/* Scrubber */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] tabular-nums text-[#8E8A82]">
                          {formatTrackClock(displayPosition)}
                        </span>
                        <div
                          ref={scrubRef}
                          onClick={(e) => handleScrub(e.clientX)}
                          className="flex h-3 flex-1 cursor-pointer items-center"
                        >
                          <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.1]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${trackProgress * 100}%`,
                                backgroundColor: accent.css,
                              }}
                            />
                          </div>
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-[#8E8A82]">
                          {formatTrackClock(duration)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeMode === 'weather' && (
                  <div className="flex flex-col gap-2.5">
                    {weatherLoading ? (
                      <div className="flex items-center justify-between py-2">
                        <AtelierSkeleton className="h-8 w-24" />
                        <AtelierSkeleton className="h-8 w-20" />
                      </div>
                    ) : weatherError ? (
                      <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                        <div className="flex items-center gap-2 text-xs text-[#E07A7A]">
                          <Warning size={15} weight="light" />
                          <span className="truncate">{weatherError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => refreshWeather(true)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-[#F4F2ED]"
                        >
                          <ArrowsClockwise size={13} weight="light" />
                        </button>
                      </div>
                    ) : weather ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                            <WeatherGlyph category={weather.category} size={22} />
                          </div>
                          <div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-display text-2xl tabular-nums text-[#F4F2ED]">
                                {weather.tempC}°
                              </span>
                              <span className="text-xs text-[#8E8A82]">{weather.condition}</span>
                            </div>
                            <div className="text-[11px] text-[#8E8A82]">
                              {weather.city}
                              {weather.country ? `, ${weather.country}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 font-mono text-[10px] tabular-nums text-[#8E8A82]">
                          <span>HUM {weather.humidity}%</span>
                          <span>WIND {weather.windKmh} km/h</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-2 text-center text-xs text-[#8E8A82]">
                        Set a city to inspect weather
                      </div>
                    )}

                    {cityEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (cityDraft.trim()) {
                            updateSection('island', { weatherCity: cityDraft.trim() });
                          }
                          setCityEditing(false);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          value={cityDraft}
                          onChange={(e) => setCityDraft(e.target.value)}
                          placeholder="City..."
                          className="flex-1 rounded-xl border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs text-[#F4F2ED] outline-none focus:border-white/25"
                        />
                        <button
                          type="submit"
                          className="rounded-xl bg-white/[0.08] px-2.5 py-1 text-[11px] text-[#F4F2ED]"
                        >
                          Set
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between text-[10px] text-[#8E8A82]">
                        <button
                          type="button"
                          onClick={() => {
                            setCityDraft(island.weatherCity);
                            setCityEditing(true);
                          }}
                          className="hover:text-[#F4F2ED]"
                        >
                          City: {island.weatherCity}
                        </button>
                        <button
                          type="button"
                          onClick={() => refreshWeather(true)}
                          title="Refresh weather"
                          className="flex items-center gap-1 hover:text-[#F4F2ED]"
                        >
                          <ArrowsClockwise size={11} weight="light" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeMode === 'timer' && (
                  <div className="flex items-center justify-between gap-4">
                    <div className="relative flex h-18 w-18 items-center justify-center">
                      <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90">
                        <circle
                          cx="36"
                          cy="36"
                          r="30"
                          fill="none"
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="36"
                          cy="36"
                          r="30"
                          fill="none"
                          stroke={accent.css}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={timerCirc}
                          strokeDashoffset={timerCirc * (1 - timerProgress)}
                          className="transition-[stroke-dashoffset] duration-300"
                        />
                      </svg>
                      <span className="absolute font-mono text-sm font-medium tabular-nums text-[#F4F2ED]">
                        {formatTimerClock(timerSecondsLeft)}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#F4F2ED]">Focus Timer</span>
                        <button
                          type="button"
                          onClick={() =>
                            updateSection('island', { timerDuckAudio: !island.timerDuckAudio })
                          }
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                            island.timerDuckAudio
                              ? 'border-[#D6B98C]/40 bg-[#D6B98C]/15 text-[#D6B98C]'
                              : 'border-white/[0.08] text-[#8E8A82]'
                          }`}
                        >
                          Duck {island.timerDuckAudio ? 'On' : 'Off'}
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateSection('island', {
                              timerMinutes: Math.max(5, island.timerMinutes - 5),
                            })
                          }
                          disabled={timerRunning}
                          aria-label="Decrease 5 minutes"
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#F4F2ED] disabled:opacity-40"
                        >
                          <Minus size={12} weight="light" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setTimerRunning((r) => !r)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.08] py-1 text-xs text-[#F4F2ED] hover:bg-white/[0.14]"
                        >
                          {timerRunning ? (
                            <>
                              <Pause size={13} weight="light" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play size={13} weight="light" />
                              <span>Start</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSection('island', {
                              timerMinutes: Math.min(120, island.timerMinutes + 5),
                            })
                          }
                          disabled={timerRunning}
                          aria-label="Increase 5 minutes"
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#F4F2ED] disabled:opacity-40"
                        >
                          <Plus size={12} weight="light" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTimerRunning(false);
                            setTimerSecondsLeft(island.timerMinutes * 60);
                          }}
                          title="Reset timer"
                          aria-label="Reset timer"
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#8E8A82] hover:text-[#F4F2ED]"
                        >
                          <ArrowCounterClockwise size={12} weight="light" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeMode === 'notes' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] text-[#8E8A82]">
                      <span>Quick Scratchpad</span>
                      <span className="font-mono tabular-nums">{notesTasks.notes.length} ch</span>
                    </div>
                    <textarea
                      value={notesTasks.notes}
                      onChange={(e) =>
                        saveNotesTasks({ ...notesTasks, notes: e.target.value })
                      }
                      rows={3}
                      placeholder="Jot a lyric note or thought..."
                      className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-xs leading-relaxed text-[#F4F2ED] placeholder:text-[#8E8A82]/60 focus:border-white/20 focus:outline-none"
                    />
                  </div>
                )}

                {activeMode === 'tasks' && (
                  <div className="flex flex-col gap-2">
                    <form onSubmit={handleAddTask} className="flex items-center gap-1.5">
                      <input
                        value={newTaskText}
                        onChange={(e) => setNewTaskText(e.target.value)}
                        placeholder="Add task..."
                        className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-[#F4F2ED] placeholder:text-[#8E8A82]/60 focus:border-white/20 focus:outline-none"
                      />
                      <button
                        type="submit"
                        aria-label="Add task"
                        className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.07] text-[#F4F2ED] hover:bg-white/[0.14]"
                      >
                        <Plus size={13} weight="light" />
                      </button>
                    </form>

                    <div className="flex max-h-28 flex-col gap-1 overflow-y-auto pr-0.5">
                      {notesTasks.tasks.length === 0 ? (
                        <div className="py-3 text-center text-[11px] text-[#8E8A82]">
                          No tasks queued
                        </div>
                      ) : (
                        notesTasks.tasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5"
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleTask(task.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {task.done ? (
                                <CheckSquare size={14} weight="light" className="shrink-0 text-[#D6B98C]" />
                              ) : (
                                <Square size={14} weight="light" className="shrink-0 text-[#8E8A82]" />
                              )}
                              <span
                                className={`truncate text-xs ${
                                  task.done ? 'line-through text-[#8E8A82]' : 'text-[#F4F2ED]'
                                }`}
                              >
                                {task.text}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              aria-label="Delete task"
                              className="text-[#8E8A82] hover:text-[#E07A7A]"
                            >
                              <Trash size={12} weight="light" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeMode === 'hardware' && (
                  <div className="flex flex-col gap-2">
                    {hwLoading ? (
                      <div className="grid grid-cols-4 gap-2 py-2">
                        {[0, 1, 2, 3].map((i) => (
                          <AtelierSkeleton key={i} className="h-12 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : hwError ? (
                      <div className="flex items-center justify-between text-xs text-[#E07A7A]">
                        <span>{hwError}</span>
                        <button type="button" onClick={() => void refreshHw()}>
                          <ArrowsClockwise size={13} weight="light" />
                        </button>
                      </div>
                    ) : hwSnapshot ? (
                      <div className="grid grid-cols-4 gap-2">
                        <TelemetryRing
                          label="CPU"
                          pct={hwSnapshot.cpu_pct}
                          valueText={`${Math.round(hwSnapshot.cpu_pct)}%`}
                          accent={accent.css}
                        />
                        <TelemetryRing
                          label="RAM"
                          pct={
                            hwSnapshot.ram_total_gb > 0
                              ? (hwSnapshot.ram_used_gb / hwSnapshot.ram_total_gb) * 100
                              : 0
                          }
                          valueText={
                            hwSnapshot.ram_total_gb > 0
                              ? `${hwSnapshot.ram_used_gb.toFixed(0)}G`
                              : 'N/A'
                          }
                          accent={accent.css}
                        />
                        <TelemetryRing
                          label="NET"
                          pct={Math.min(100, (hwSnapshot.net_rx_kbps / 1024) * 20)}
                          valueText={`${Math.round(hwSnapshot.net_rx_kbps)}k`}
                          accent={accent.css}
                        />
                        <TelemetryRing
                          label={hwSnapshot.charging ? 'CHG' : 'BAT'}
                          pct={batteryPct ?? 0}
                          valueText={batteryPct !== null ? `${batteryPct}%` : 'AC'}
                          accent={hwSnapshot.charging ? '#84C9A4' : accent.css}
                        />
                      </div>
                    ) : (
                      <div className="py-2 text-center text-[11px] text-[#8E8A82]">
                        System telemetry active in desktop Tauri runtime
                      </div>
                    )}
                  </div>
                )}

                {/* Mode Switcher Strip */}
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'big', icon: MusicNote, label: 'Studio Player' },
                        { id: 'weather', icon: CloudSun, label: 'Weather' },
                        { id: 'timer', icon: Timer, label: 'Focus Timer' },
                        { id: 'notes', icon: NotePencil, label: 'Notes' },
                        { id: 'tasks', icon: CheckSquare, label: 'Tasks' },
                        { id: 'hardware', icon: Cpu, label: 'Telemetry' },
                      ] as const
                    ).map((item) => {
                      const IconComp = item.icon;
                      const isActive = activeMode === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setMode(item.id)}
                          title={item.label}
                          aria-label={item.label}
                          className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                            isActive
                              ? 'bg-white/[0.12] text-[#F4F2ED]'
                              : 'text-[#8E8A82] hover:bg-white/[0.06] hover:text-[#F4F2ED]'
                          }`}
                          style={isActive ? { color: accent.css } : undefined}
                        >
                          <IconComp size={14} weight="light" />
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setMode('peek')}
                    title="Collapse to peek"
                    aria-label="Collapse island"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8A82] hover:bg-white/[0.06] hover:text-[#F4F2ED]"
                  >
                    <CornersIn size={13} weight="light" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </BezelPanel>
      </motion.div>
    </div>
  );
}
