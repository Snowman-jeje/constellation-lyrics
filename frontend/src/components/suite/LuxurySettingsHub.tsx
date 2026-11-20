import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Aperture,
  ArrowCounterClockwise,
  Clock,
  Compass,
  Keyboard,
  LockSimple,
  SlidersHorizontal,
  Sparkle,
  Waveform,
  X,
} from '@phosphor-icons/react';
import { isTauriRuntime, getCalibratedAccent, safeInvoke, safeListen } from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette } from '../../types/music';
import type {
  ClockFaceKind,
  GlowMotion,
  GlowStyle,
  IslandGlassLook,
  IslandMode,
  KeyProfileKind,
  LiveSceneKind,
  LockBackdropKind,
  LockModeKind,
  LyricsBackdrop,
  LyricsMotion,
  LyricsStyle,
  PerformanceModeKind,
  TaskbarModeKind,
  UpdateCheckResult,
  UpdateProgressEvent,
  WallpaperWeatherKind,
} from '../../types/suite';
import { AtelierSwitch, BezelPanel, HairlineSlider } from './AtelierPrimitives';

type SettingsTab =
  | 'lyrics'
  | 'live'
  | 'glow'
  | 'island'
  | 'desktop'
  | 'lock'
  | 'utilities';

interface LuxurySettingsHubProps {
  open: boolean;
  onClose: () => void;
  palette: ColorPalette;
  onOpenMixer: () => void;
  onLaunchLock: () => void;
}

const TABS: ReadonlyArray<{ id: SettingsTab; icon: typeof Sparkle; label: string }> = [
  { id: 'lyrics', icon: Sparkle, label: 'Lyrics' },
  { id: 'live', icon: Aperture, label: 'Live' },
  { id: 'glow', icon: Waveform, label: 'Glow' },
  { id: 'island', icon: Compass, label: 'Island' },
  { id: 'desktop', icon: Clock, label: 'Desktop' },
  { id: 'lock', icon: LockSimple, label: 'Lock' },
  { id: 'utilities', icon: Keyboard, label: 'System' },
];

const LYRIC_STYLES: ReadonlyArray<{ id: LyricsStyle; label: string }> = [
  { id: 'stars', label: 'Stars' },
  { id: 'lines', label: 'Lines' },
  { id: 'bigWords', label: 'BigWords' },
  { id: 'lens', label: 'Lens' },
  { id: 'depth3d', label: 'Depth 3D' },
];

const SCENE_SWATCHES: ReadonlyArray<{
  id: LiveSceneKind;
  label: string;
  bg: string;
}> = [
  { id: 'aurora', label: 'Aurora', bg: 'radial-gradient(circle at 30% 30%, #2B6E63 0%, #0D161A 65%, #070709 100%)' },
  { id: 'orb', label: 'Orb', bg: 'radial-gradient(circle at 50% 50%, #D6B98C 0%, #4A3E2A 32%, #070709 74%)' },
  { id: 'sea', label: 'Sea', bg: 'linear-gradient(160deg, #10252E 0%, #1F4E5F 50%, #070B0E 100%)' },
  { id: 'dream', label: 'Dream', bg: 'radial-gradient(circle at 70% 30%, #8A6B4A 0%, #2A211C 52%, #09080A 100%)' },
  { id: 'fall', label: 'Fall', bg: 'repeating-linear-gradient(90deg, #090A0D 0px, #090A0D 5px, rgba(244,242,237,0.14) 6px, #090A0D 7px)' },
  { id: 'silk', label: 'Silk', bg: 'linear-gradient(135deg, #1E1D22 0%, #524B42 48%, #0B0B0F 100%)' },
  { id: 'shoal', label: 'Shoal', bg: 'radial-gradient(circle at 25% 65%, #3C6E71 0%, transparent 45%), radial-gradient(circle at 75% 35%, #D6B98C 0%, #090A0D 65%)' },
  { id: 'veil', label: 'Veil', bg: 'linear-gradient(180deg, rgba(214,185,140,0.32) 0%, #151419 55%, #070709 100%)' },
  { id: 'lane', label: 'Lane', bg: 'linear-gradient(180deg, #09090C 0%, #191E24 55%, #D6B98C44 100%)' },
  { id: 'tide', label: 'Tide', bg: 'radial-gradient(circle at 50% 85%, #466C78 0%, #16242C 45%, #070709 85%)' },
  { id: 'city', label: 'City', bg: 'radial-gradient(circle at 22% 55%, #D6B98C66 0%, transparent 22%), radial-gradient(circle at 65% 42%, #8C6D4655 0%, #09090D 70%)' },
  { id: 'wall', label: 'Wall', bg: 'linear-gradient(120deg, #141418 0%, #24232A 45%, #0A0A0D 100%)' },
];

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <span className="truncate text-xs text-[#F4F2ED]/90">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentedPills<T extends string>({
  options,
  value,
  accent,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  accent: string;
  onChange: (val: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              active
                ? 'text-[#F4F2ED]'
                : 'border-white/[0.07] bg-white/[0.02] text-[#8E8A82] hover:border-white/[0.14] hover:text-[#F4F2ED]'
            }`}
            style={
              active
                ? { borderColor: `${accent}88`, backgroundColor: `${accent}22` }
                : undefined
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function LuxurySettingsHub({
  open,
  onClose,
  palette,
  onOpenMixer,
  onLaunchLock,
}: LuxurySettingsHubProps) {
  const { settings, updateSection, resetSettings, capabilities, pushToast } = useSuiteStore();
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<SettingsTab>('lyrics');
  const accent = getCalibratedAccent(palette);

  const { lyrics, live, glow, island, desktop, lock, utilities } = settings;
  const [cityDraft, setCityDraft] = useState(island.weatherCity);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);

  useEffect(() => {
    setCityDraft(island.weatherCity);
  }, [island.weatherCity]);

  useEffect(() => {
    if (!open || !isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void safeListen<UpdateProgressEvent>('update-progress', (ev) => {
      if (!cancelled) setUpdateProgress(ev);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [open]);

  const handleCheckUpdates = async () => {
    if (!isTauriRuntime()) {
      pushToast('Updater available in desktop build', 'info');
      return;
    }
    setCheckingUpdate(true);
    try {
      const res = await safeInvoke<UpdateCheckResult>('check_for_updates');
      if (res) {
        setUpdateInfo(res);
        pushToast(
          res.has_update
            ? `Update v${res.latest_version} ready`
            : `Up to date (v${res.current_version})`,
          res.has_update ? 'success' : 'info',
        );
      } else {
        pushToast('Unable to reach GitHub releases', 'warning');
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!isTauriRuntime()) return;
    setInstallingUpdate(true);
    try {
      await safeInvoke('download_and_install_update');
    } catch {
      pushToast('Update install failed', 'error');
    } finally {
      setInstallingUpdate(false);
    }
  };

  const commitWeatherCity = () => {
    const trimmed = cityDraft.trim();
    if (trimmed !== island.weatherCity) {
      updateSection('island', { weatherCity: trimmed });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className="fixed inset-0 z-40 flex justify-end bg-black/45 p-3 sm:p-4 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.aside
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="h-full w-[min(94vw,600px)]"
          >
            <BezelPanel
              radiusClass="rounded-[1.75rem]"
              innerRadiusClass="rounded-[calc(1.75rem-0.375rem)]"
              className="h-full"
              innerClassName="flex h-full overflow-hidden"
            >
              {/* Vertical Icon Rail */}
              <nav className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-white/[0.07] bg-white/[0.015] py-3">
                <div className="flex flex-col items-center gap-2">
                  {TABS.map((tab) => {
                    const IconComp = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        title={tab.label}
                        aria-label={tab.label}
                        className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                          active
                            ? 'text-[#F4F2ED]'
                            : 'text-[#8E8A82] hover:bg-white/[0.05] hover:text-[#F4F2ED]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="settings-rail-pill"
                            className="absolute inset-0 rounded-xl border border-white/[0.14] bg-white/[0.08]"
                            style={{ borderColor: `rgba(${accent.rgb}, 0.45)` }}
                          />
                        )}
                        <IconComp size={17} weight="light" className="relative z-10" />
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={resetSettings}
                  title="Restore defaults"
                  aria-label="Restore default settings"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#8E8A82] transition-colors hover:bg-white/[0.06] hover:text-[#F4F2ED]"
                >
                  <ArrowCounterClockwise size={15} weight="light" />
                </button>
              </nav>

              {/* Content Pane */}
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-display text-lg tracking-wide text-[#F4F2ED]">
                      {TABS.find((t) => t.id === activeTab)?.label}
                    </h2>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                      Atelier
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    title="Close (Esc)"
                    aria-label="Close settings"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-[#8E8A82] transition-colors hover:bg-white/[0.12] hover:text-[#F4F2ED]"
                  >
                    <X size={14} weight="light" />
                  </button>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-5">
                  {activeTab === 'lyrics' && (
                    <>
                      {/* 5 Interactive Style Preview Tiles */}
                      <div className="grid grid-cols-5 gap-2">
                        {LYRIC_STYLES.map((st) => {
                          const active = lyrics.style === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => updateSection('lyrics', { style: st.id })}
                              className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 transition-all ${
                                active
                                  ? 'bg-white/[0.08]'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
                              }`}
                              style={active ? { borderColor: accent.css } : undefined}
                            >
                              <div className="flex h-10 w-full items-center justify-center rounded-lg bg-[#070709] text-[#F4F2ED]">
                                {st.id === 'stars' && (
                                  <svg viewBox="0 0 36 22" className="h-5 w-8">
                                    <line x1="6" y1="15" x2="18" y2="7" stroke={accent.css} strokeWidth="0.9" strokeOpacity="0.6" />
                                    <line x1="18" y1="7" x2="30" y2="13" stroke={accent.css} strokeWidth="0.9" strokeOpacity="0.6" />
                                    <circle cx="6" cy="15" r="1.5" fill="#F4F2ED" />
                                    <circle cx="18" cy="7" r="2" fill={accent.css} />
                                    <circle cx="30" cy="13" r="1.5" fill="#F4F2ED" />
                                  </svg>
                                )}
                                {st.id === 'lines' && (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="h-[1.5px] w-6 rounded bg-white/30" />
                                    <span className="h-[2px] w-7 rounded" style={{ backgroundColor: accent.css }} />
                                    <span className="h-[1.5px] w-5 rounded bg-white/30" />
                                  </div>
                                )}
                                {st.id === 'bigWords' && (
                                  <span className="font-display text-sm tracking-tight" style={{ color: accent.css }}>
                                    Aa
                                  </span>
                                )}
                                {st.id === 'lens' && (
                                  <div className="h-5 w-5 rounded-full border border-white/30 bg-white/[0.08]" />
                                )}
                                {st.id === 'depth3d' && (
                                  <div className="flex flex-col items-center gap-0.5" style={{ perspective: '40px' }}>
                                    <span className="h-[1px] w-3 rounded bg-white/25" />
                                    <span className="h-[1.5px] w-5 rounded bg-white/45" />
                                    <span className="h-[2px] w-7 rounded" style={{ backgroundColor: accent.css }} />
                                  </div>
                                )}
                              </div>
                              <span className="text-[10px] text-[#8E8A82]">{st.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Backdrop
                        </span>
                        <SegmentedPills<LyricsBackdrop>
                          value={lyrics.backdrop}
                          accent={accent.css}
                          onChange={(backdrop) => updateSection('lyrics', { backdrop })}
                          options={[
                            { id: 'black', label: 'Obsidian' },
                            { id: 'white', label: 'Ivory' },
                            { id: 'cover', label: 'Cover' },
                            { id: 'aura', label: 'Aura' },
                            { id: 'live', label: 'Live' },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Motion
                        </span>
                        <SegmentedPills<LyricsMotion>
                          value={lyrics.motion}
                          accent={accent.css}
                          onChange={(motion) => updateSection('lyrics', { motion })}
                          options={[
                            { id: 'words', label: 'Words' },
                            { id: 'backdrop', label: 'Backdrop' },
                            { id: 'standing', label: 'Still' },
                          ]}
                        />
                      </div>

                      <HairlineSlider
                        label="Scale"
                        value={lyrics.fontScale}
                        min={0.7}
                        max={1.6}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${lyrics.fontScale.toFixed(2)}x`}
                        onChange={(fontScale) => updateSection('lyrics', { fontScale })}
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Scatter">
                          <AtelierSwitch
                            checked={lyrics.scatter}
                            accent={accent.css}
                            onChange={(scatter) => updateSection('lyrics', { scatter })}
                          />
                        </SettingRow>
                        <SettingRow label="Tilt">
                          <AtelierSwitch
                            checked={lyrics.tilt}
                            accent={accent.css}
                            onChange={(tilt) => updateSection('lyrics', { tilt })}
                          />
                        </SettingRow>
                        <SettingRow label="Bulge">
                          <AtelierSwitch
                            checked={lyrics.bulge}
                            accent={accent.css}
                            onChange={(bulge) => updateSection('lyrics', { bulge })}
                          />
                        </SettingRow>
                        <SettingRow label="Cover Words">
                          <AtelierSwitch
                            checked={lyrics.coverInWords}
                            accent={accent.css}
                            onChange={(coverInWords) => updateSection('lyrics', { coverInWords })}
                          />
                        </SettingRow>
                        <SettingRow label="Wake Lock">
                          <AtelierSwitch
                            checked={lyrics.keepScreenOn}
                            accent={accent.css}
                            onChange={(keepScreenOn) => updateSection('lyrics', { keepScreenOn })}
                          />
                        </SettingRow>
                        <SettingRow label="Open on Lock">
                          <AtelierSwitch
                            checked={lyrics.openOnLock}
                            accent={accent.css}
                            onChange={(openOnLock) => updateSection('lyrics', { openOnLock })}
                          />
                        </SettingRow>
                      </div>
                    </>
                  )}

                  {activeTab === 'live' && (
                    <>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {SCENE_SWATCHES.map((sc) => {
                          const active = live.scene === sc.id;
                          return (
                            <button
                              key={sc.id}
                              type="button"
                              onClick={() => updateSection('live', { scene: sc.id })}
                              className={`group flex flex-col items-center gap-1.5 rounded-2xl border p-1.5 transition-all ${
                                active
                                  ? 'bg-white/[0.08]'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.15]'
                              }`}
                              style={active ? { borderColor: accent.css } : undefined}
                            >
                              <div
                                className="h-11 w-full rounded-xl border border-white/[0.08]"
                                style={{ background: sc.bg }}
                              />
                              <span className="text-[10px] text-[#8E8A82] group-hover:text-[#F4F2ED]">
                                {sc.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <HairlineSlider
                        label="Audio Reaction"
                        value={live.reaction}
                        min={0}
                        max={1.5}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(live.reaction * 100)}%`}
                        onChange={(reaction) => updateSection('live', { reaction })}
                      />
                      <HairlineSlider
                        label="Drift Speed"
                        value={live.speed}
                        min={0.2}
                        max={2.4}
                        step={0.1}
                        accent={accent.css}
                        displayValue={`${live.speed.toFixed(1)}x`}
                        onChange={(speed) => updateSection('live', { speed })}
                      />
                    </>
                  )}

                  {activeTab === 'glow' && (
                    <>
                      <SettingRow label="Border Aura">
                        <AtelierSwitch
                          checked={glow.enabled}
                          accent={accent.css}
                          onChange={(enabled) => updateSection('glow', { enabled })}
                        />
                      </SettingRow>

                      {/* 4 Glow Edge Diagrams */}
                      <div className="grid grid-cols-4 gap-2">
                        {(
                          [
                            { id: 'rim', label: 'Rim' },
                            { id: 'edges', label: 'Edges' },
                            { id: 'corners', label: 'Corners' },
                            { id: 'sides', label: 'Sides' },
                          ] as const satisfies ReadonlyArray<{ id: GlowStyle; label: string }>
                        ).map((g) => {
                          const active = glow.style === g.id;
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => updateSection('glow', { style: g.id })}
                              className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 ${
                                active
                                  ? 'bg-white/[0.08]'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
                              }`}
                              style={active ? { borderColor: accent.css } : undefined}
                            >
                              <div
                                className="relative h-9 w-full rounded-lg bg-[#070709]"
                                style={{
                                  boxShadow:
                                    g.id === 'rim'
                                      ? `inset 0 0 8px ${accent.css}`
                                      : g.id === 'edges'
                                        ? `inset 0 2px 5px ${accent.css}, inset 0 -2px 5px ${accent.css}`
                                        : g.id === 'sides'
                                          ? `inset 3px 0 6px ${accent.css}, inset -3px 0 6px ${accent.css}`
                                          : 'none',
                                }}
                              >
                                {g.id === 'corners' && (
                                  <>
                                    <span className="absolute left-1 top-1 h-2 w-2 rounded-full blur-[2px]" style={{ backgroundColor: accent.css }} />
                                    <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full blur-[2px]" style={{ backgroundColor: accent.css }} />
                                  </>
                                )}
                              </div>
                              <span className="text-[10px] text-[#8E8A82]">{g.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Pulse Mode
                        </span>
                        <SegmentedPills<GlowMotion>
                          value={glow.motion}
                          accent={accent.css}
                          onChange={(motion) => updateSection('glow', { motion })}
                          options={[
                            { id: 'music', label: 'Audio Beat' },
                            { id: 'steady', label: 'Steady' },
                          ]}
                        />
                      </div>

                      <HairlineSlider
                        label="Thickness"
                        value={glow.thickness}
                        min={0.15}
                        max={1}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(glow.thickness * 100)}%`}
                        onChange={(thickness) => updateSection('glow', { thickness })}
                      />
                      <HairlineSlider
                        label="Brightness"
                        value={glow.brightness}
                        min={0.1}
                        max={1.4}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(glow.brightness * 100)}%`}
                        onChange={(brightness) => updateSection('glow', { brightness })}
                      />

                      <SettingRow label="Custom Dual Colors">
                        <AtelierSwitch
                          checked={glow.ownColors}
                          accent={accent.css}
                          onChange={(ownColors) => updateSection('glow', { ownColors })}
                        />
                      </SettingRow>

                      {glow.ownColors && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-[#8E8A82]">
                            <span>Primary</span>
                            <input
                              type="color"
                              value={glow.colorFirst}
                              onChange={(e) => updateSection('glow', { colorFirst: e.target.value })}
                              className="h-5 w-8 cursor-pointer rounded border-0 bg-transparent"
                            />
                          </label>
                          <label className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-[#8E8A82]">
                            <span>Secondary</span>
                            <input
                              type="color"
                              value={glow.colorSecond}
                              onChange={(e) => updateSection('glow', { colorSecond: e.target.value })}
                              className="h-5 w-8 cursor-pointer rounded border-0 bg-transparent"
                            />
                          </label>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Active on Lock">
                          <AtelierSwitch
                            checked={glow.onLock}
                            accent={accent.css}
                            onChange={(onLock) => updateSection('glow', { onLock })}
                          />
                        </SettingRow>
                        <SettingRow label="Overlay Window">
                          <AtelierSwitch
                            checked={glow.overlayWindow}
                            accent={accent.css}
                            onChange={(overlayWindow) => updateSection('glow', { overlayWindow })}
                          />
                        </SettingRow>
                      </div>
                    </>
                  )}

                  {activeTab === 'island' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Dynamic Island">
                          <AtelierSwitch
                            checked={island.enabled}
                            accent={accent.css}
                            onChange={(enabled) => updateSection('island', { enabled })}
                          />
                        </SettingRow>
                        <SettingRow label="Studio Vinyl">
                          <AtelierSwitch
                            checked={island.bigVinyl}
                            accent={accent.css}
                            onChange={(bigVinyl) => updateSection('island', { bigVinyl })}
                          />
                        </SettingRow>
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Mode
                        </span>
                        <SegmentedPills<IslandMode>
                          value={island.mode}
                          accent={accent.css}
                          onChange={(mode) => updateSection('island', { mode })}
                          options={[
                            { id: 'peek', label: 'Peek' },
                            { id: 'player', label: 'Player' },
                            { id: 'big', label: 'Big' },
                            { id: 'weather', label: 'Weather' },
                            { id: 'timer', label: 'Timer' },
                            { id: 'notes', label: 'Notes' },
                            { id: 'tasks', label: 'Tasks' },
                            { id: 'hardware', label: 'Stats' },
                            { id: 'closed', label: 'Closed' },
                          ]}
                        />
                      </div>

                      {/* 3 Island Glass Looks */}
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { id: 'bottomFloor', label: 'Bottom Floor' },
                            { id: 'lensBuild', label: 'Lens Build' },
                            { id: 'rimFrost', label: 'Rim Frost' },
                          ] as const satisfies ReadonlyArray<{ id: IslandGlassLook; label: string }>
                        ).map((lk) => {
                          const active = island.look === lk.id;
                          return (
                            <button
                              key={lk.id}
                              type="button"
                              onClick={() => updateSection('island', { look: lk.id })}
                              className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 ${
                                active
                                  ? 'bg-white/[0.08]'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
                              }`}
                              style={active ? { borderColor: accent.css } : undefined}
                            >
                              <BezelPanel
                                look={lk.id}
                                radiusClass="rounded-full"
                                innerRadiusClass="rounded-full"
                                className="w-full"
                                innerClassName="h-4 w-full"
                              >
                                <span className="sr-only">{lk.label}</span>
                              </BezelPanel>
                              <span className="text-[10px] text-[#8E8A82]">{lk.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <HairlineSlider
                        label="Island Scale"
                        value={island.scale}
                        min={0.75}
                        max={1.35}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${island.scale.toFixed(2)}x`}
                        onChange={(scale) => updateSection('island', { scale })}
                      />
                      <HairlineSlider
                        label="Focus Timer"
                        value={island.timerMinutes}
                        min={5}
                        max={90}
                        step={5}
                        accent={accent.css}
                        displayValue={`${island.timerMinutes}m`}
                        onChange={(timerMinutes) => updateSection('island', { timerMinutes })}
                      />

                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                        <span className="text-xs text-[#F4F2ED]/90">Weather City</span>
                        <input
                          value={cityDraft}
                          onChange={(e) => setCityDraft(e.target.value)}
                          onBlur={commitWeatherCity}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-36 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-right text-xs text-[#F4F2ED] focus:border-white/25 focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Hide Fullscreen">
                          <AtelierSwitch
                            checked={island.hideInFullscreen}
                            accent={accent.css}
                            onChange={(hideInFullscreen) =>
                              updateSection('island', { hideInFullscreen })
                            }
                          />
                        </SettingRow>
                        <SettingRow label="Audio Levels">
                          <AtelierSwitch
                            checked={island.showLevels}
                            accent={accent.css}
                            onChange={(showLevels) => updateSection('island', { showLevels })}
                          />
                        </SettingRow>
                        <SettingRow label="Charging Badge">
                          <AtelierSwitch
                            checked={island.showCharging}
                            accent={accent.css}
                            onChange={(showCharging) => updateSection('island', { showCharging })}
                          />
                        </SettingRow>
                        <SettingRow label="Headphones">
                          <AtelierSwitch
                            checked={island.showHeadphones}
                            accent={accent.css}
                            onChange={(showHeadphones) =>
                              updateSection('island', { showHeadphones })
                            }
                          />
                        </SettingRow>
                        <SettingRow label="Focus Mode">
                          <AtelierSwitch
                            checked={island.focusMode}
                            accent={accent.css}
                            onChange={(focusMode) => updateSection('island', { focusMode })}
                          />
                        </SettingRow>
                        <SettingRow label="Timer Ducking">
                          <AtelierSwitch
                            checked={island.timerDuckAudio}
                            accent={accent.css}
                            onChange={(timerDuckAudio) =>
                              updateSection('island', { timerDuckAudio })
                            }
                          />
                        </SettingRow>
                      </div>
                    </>
                  )}

                  {activeTab === 'desktop' && (
                    <>
                      <SettingRow label="Desktop Clock">
                        <AtelierSwitch
                          checked={desktop.clockEnabled}
                          accent={accent.css}
                          onChange={(clockEnabled) => updateSection('desktop', { clockEnabled })}
                        />
                      </SettingRow>

                      {/* 4 Clock Face Previews */}
                      <div className="grid grid-cols-4 gap-2">
                        {(
                          [
                            { id: 'atelier', label: 'Atelier', sample: '12:40' },
                            { id: 'roman', label: 'Roman', sample: 'XII' },
                            { id: 'minimal', label: 'Minimal', sample: '12:40' },
                            { id: 'mono', label: 'Mono', sample: '12:40' },
                          ] as const satisfies ReadonlyArray<{
                            id: ClockFaceKind;
                            label: string;
                            sample: string;
                          }>
                        ).map((cf) => {
                          const active = desktop.clockFace === cf.id;
                          return (
                            <button
                              key={cf.id}
                              type="button"
                              onClick={() => updateSection('desktop', { clockFace: cf.id })}
                              className={`flex flex-col items-center gap-1 rounded-2xl border p-2 ${
                                active
                                  ? 'bg-white/[0.08]'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
                              }`}
                              style={active ? { borderColor: accent.css } : undefined}
                            >
                              <span
                                className={`text-sm text-[#F4F2ED] ${
                                  cf.id === 'atelier' || cf.id === 'roman'
                                    ? 'font-display'
                                    : cf.id === 'mono'
                                      ? 'font-mono'
                                      : 'font-sans font-extralight'
                                }`}
                              >
                                {cf.sample}
                              </span>
                              <span className="text-[10px] text-[#8E8A82]">{cf.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <HairlineSlider
                        label="Clock Scale"
                        value={desktop.clockSize}
                        min={0.6}
                        max={1.6}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${desktop.clockSize.toFixed(2)}x`}
                        onChange={(clockSize) => updateSection('desktop', { clockSize })}
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Show Date">
                          <AtelierSwitch
                            checked={desktop.clockShowDate}
                            accent={accent.css}
                            onChange={(clockShowDate) => updateSection('desktop', { clockShowDate })}
                          />
                        </SettingRow>
                        <SettingRow label="Clock Glow">
                          <AtelierSwitch
                            checked={desktop.clockGlow}
                            accent={accent.css}
                            onChange={(clockGlow) => updateSection('desktop', { clockGlow })}
                          />
                        </SettingRow>
                        <SettingRow label="Transparent">
                          <AtelierSwitch
                            checked={desktop.clockTransparent}
                            accent={accent.css}
                            onChange={(clockTransparent) =>
                              updateSection('desktop', { clockTransparent })
                            }
                          />
                        </SettingRow>
                        <label className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs text-[#F4F2ED]/90">
                          <span>Ink</span>
                          <input
                            type="color"
                            value={desktop.clockColor}
                            onChange={(e) => updateSection('desktop', { clockColor: e.target.value })}
                            className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent"
                          />
                        </label>
                      </div>

                      <SettingRow label="Vinyl Turntable">
                        <AtelierSwitch
                          checked={desktop.turntableEnabled}
                          accent={accent.css}
                          onChange={(turntableEnabled) =>
                            updateSection('desktop', { turntableEnabled })
                          }
                        />
                      </SettingRow>
                      <HairlineSlider
                        label="Turntable Scale"
                        value={desktop.turntableSize}
                        min={0.65}
                        max={1.45}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${desktop.turntableSize.toFixed(2)}x`}
                        onChange={(turntableSize) => updateSection('desktop', { turntableSize })}
                      />
                      <HairlineSlider
                        label="Turntable Opacity"
                        value={desktop.turntableOpacity}
                        min={0.35}
                        max={1}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(desktop.turntableOpacity * 100)}%`}
                        onChange={(turntableOpacity) =>
                          updateSection('desktop', { turntableOpacity })
                        }
                      />

                      <SettingRow label="Parallax Drift">
                        <AtelierSwitch
                          checked={desktop.wallpaperParallax}
                          accent={accent.css}
                          onChange={(wallpaperParallax) =>
                            updateSection('desktop', { wallpaperParallax })
                          }
                        />
                      </SettingRow>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Atmosphere Overlay
                        </span>
                        <SegmentedPills<WallpaperWeatherKind>
                          value={desktop.wallpaperWeather}
                          accent={accent.css}
                          onChange={(wallpaperWeather) =>
                            updateSection('desktop', { wallpaperWeather })
                          }
                          options={[
                            { id: 'none', label: 'None' },
                            { id: 'rain', label: 'Rain' },
                            { id: 'snow', label: 'Snow' },
                            { id: 'mist', label: 'Mist' },
                            { id: 'stars', label: 'Stars' },
                          ]}
                        />
                      </div>
                    </>
                  )}

                  {activeTab === 'lock' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onLaunchLock();
                        }}
                        className="flex w-full items-center justify-between rounded-2xl border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-[#F4F2ED] transition-colors hover:bg-white/[0.12]"
                      >
                        <span>Enter Lock Mode</span>
                        <LockSimple size={15} weight="light" style={{ color: accent.css }} />
                      </button>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Layout
                        </span>
                        <SegmentedPills<LockModeKind>
                          value={lock.mode}
                          accent={accent.css}
                          onChange={(mode) => updateSection('lock', { mode })}
                          options={[
                            { id: 'normal', label: 'Balanced' },
                            { id: 'enlarged', label: 'Hero Clock' },
                            { id: 'lyrics', label: 'Lyrics Stage' },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Backdrop
                        </span>
                        <SegmentedPills<LockBackdropKind>
                          value={lock.backdrop}
                          accent={accent.css}
                          onChange={(backdrop) => updateSection('lock', { backdrop })}
                          options={[
                            { id: 'cover', label: 'Cover' },
                            { id: 'picture', label: 'Aura' },
                            { id: 'live', label: 'Live' },
                          ]}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Glass Clock">
                          <AtelierSwitch
                            checked={lock.clockGlass}
                            accent={accent.css}
                            onChange={(clockGlass) => updateSection('lock', { clockGlass })}
                          />
                        </SettingRow>
                        <SettingRow label="Vinyl Disc">
                          <AtelierSwitch
                            checked={lock.showRecord}
                            accent={accent.css}
                            onChange={(showRecord) => updateSection('lock', { showRecord })}
                          />
                        </SettingRow>
                      </div>

                      <HairlineSlider
                        label="Clock Scale"
                        value={lock.clockSize}
                        min={0.7}
                        max={1.5}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${lock.clockSize.toFixed(2)}x`}
                        onChange={(clockSize) => updateSection('lock', { clockSize })}
                      />
                      <HairlineSlider
                        label="Backdrop Blur"
                        value={lock.blur}
                        min={0}
                        max={1}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(lock.blur * 100)}%`}
                        onChange={(blur) => updateSection('lock', { blur })}
                      />
                      <HairlineSlider
                        label="Idle Auto-Lock"
                        value={lock.idleMinutes}
                        min={0}
                        max={30}
                        step={1}
                        accent={accent.css}
                        displayValue={lock.idleMinutes === 0 ? 'Off' : `${lock.idleMinutes}m`}
                        onChange={(idleMinutes) => updateSection('lock', { idleMinutes })}
                      />
                    </>
                  )}

                  {activeTab === 'utilities' && (
                    <>
                      <SettingRow label="Mechanical Key Sounds">
                        <AtelierSwitch
                          checked={utilities.keySounds}
                          accent={accent.css}
                          onChange={(keySounds) => {
                            updateSection('utilities', { keySounds });
                            pushToast(keySounds ? 'Key acoustics enabled' : 'Key acoustics muted');
                          }}
                        />
                      </SettingRow>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Switch Profile
                        </span>
                        <SegmentedPills<KeyProfileKind>
                          value={utilities.keyProfile}
                          accent={accent.css}
                          onChange={(keyProfile) => updateSection('utilities', { keyProfile })}
                          options={[
                            { id: 'tactile', label: 'Tactile' },
                            { id: 'office', label: 'Office' },
                            { id: 'thocky', label: 'Thocky' },
                            { id: 'typewriter', label: 'Typewriter' },
                          ]}
                        />
                      </div>

                      <HairlineSlider
                        label="Key Volume"
                        value={utilities.keyVolume}
                        min={0.05}
                        max={1}
                        step={0.05}
                        accent={accent.css}
                        displayValue={`${Math.round(utilities.keyVolume * 100)}%`}
                        onChange={(keyVolume) => updateSection('utilities', { keyVolume })}
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <SettingRow label="Key Upstroke">
                          <AtelierSwitch
                            checked={utilities.keyRelease}
                            accent={accent.css}
                            onChange={(keyRelease) => updateSection('utilities', { keyRelease })}
                          />
                        </SettingRow>
                        <SettingRow label="Typing Telemetry">
                          <AtelierSwitch
                            checked={utilities.buddyEnabled}
                            accent={accent.css}
                            onChange={(buddyEnabled) =>
                              updateSection('utilities', { buddyEnabled })
                            }
                          />
                        </SettingRow>
                        <SettingRow label="Mirror Widget">
                          <AtelierSwitch
                            checked={utilities.mirrorEnabled}
                            accent={accent.css}
                            onChange={(mirrorEnabled) =>
                              updateSection('utilities', { mirrorEnabled })
                            }
                          />
                        </SettingRow>
                        <button
                          type="button"
                          onClick={onOpenMixer}
                          className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-[#F4F2ED] hover:bg-white/[0.1]"
                        >
                          <span>Audio Mixer</span>
                          <SlidersHorizontal size={14} weight="light" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                          Performance Tier
                        </span>
                        <SegmentedPills<PerformanceModeKind>
                          value={utilities.performanceMode}
                          accent={accent.css}
                          onChange={(performanceMode) =>
                            updateSection('utilities', { performanceMode })
                          }
                          options={[
                            { id: 'high', label: 'High' },
                            { id: 'balanced', label: 'Balanced' },
                            { id: 'eco', label: 'Eco' },
                          ]}
                        />
                      </div>

                      {capabilities.supports_taskbar_styling && (
                        <div className="space-y-2 border-t border-white/[0.07] pt-3">
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8E8A82]">
                            Windows Taskbar
                          </span>
                          <SegmentedPills<TaskbarModeKind>
                            value={utilities.taskbarMode}
                            accent={accent.css}
                            onChange={(taskbarMode) => updateSection('utilities', { taskbarMode })}
                            options={[
                              { id: 'normal', label: 'Normal' },
                              { id: 'opaque', label: 'Opaque' },
                              { id: 'clear', label: 'Clear' },
                              { id: 'blur', label: 'Blur' },
                              { id: 'acrylic', label: 'Acrylic' },
                              { id: 'album', label: 'Album' },
                              { id: 'beat', label: 'Beat' },
                            ]}
                          />
                        </div>
                      )}

                      {capabilities.supports_volume_osd_hide && (
                        <SettingRow label="Suppress System Volume HUD">
                          <AtelierSwitch
                            checked={utilities.hideSystemVolume}
                            accent={accent.css}
                            onChange={(hideSystemVolume) =>
                              updateSection('utilities', { hideSystemVolume })
                            }
                          />
                        </SettingRow>
                      )}

                      <div className="space-y-2 border-t border-white/[0.07] pt-3">
                        <SettingRow label="Auto Update">
                          <AtelierSwitch
                            checked={utilities.autoUpdate}
                            accent={accent.css}
                            onChange={(autoUpdate) =>
                              updateSection('utilities', { autoUpdate })
                            }
                          />
                        </SettingRow>

                        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                          <span className="font-mono text-[11px] tabular-nums text-[#8E8A82]">
                            v{updateInfo?.current_version ?? '3.1.0'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={checkingUpdate || installingUpdate}
                              onClick={() => void handleCheckUpdates()}
                              className="rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1 text-[11px] text-[#F4F2ED] transition-colors hover:bg-white/[0.1] disabled:opacity-50"
                            >
                              {checkingUpdate ? 'Checking...' : 'Check'}
                            </button>
                            {updateInfo?.has_update && updateInfo.download_url && (
                              <button
                                type="button"
                                disabled={installingUpdate}
                                onClick={() => void handleInstallUpdate()}
                                className="rounded-full px-3 py-1 text-[11px] font-medium text-[#070709] transition-opacity hover:opacity-90 disabled:opacity-50"
                                style={{ backgroundColor: accent.css }}
                              >
                                {installingUpdate
                                  ? 'Installing...'
                                  : `Install v${updateInfo.latest_version}`}
                              </button>
                            )}
                          </div>
                        </div>

                        {updateProgress && installingUpdate && (
                          <div className="space-y-1 px-1">
                            <div className="flex items-center justify-between font-mono text-[10px] text-[#8E8A82]">
                              <span className="truncate">{updateProgress.message}</span>
                              <span>{updateProgress.progress}%</span>
                            </div>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                              <div
                                className="h-full transition-all duration-300"
                                style={{
                                  width: `${Math.min(100, Math.max(0, updateProgress.progress))}%`,
                                  backgroundColor: accent.css,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </BezelPanel>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
