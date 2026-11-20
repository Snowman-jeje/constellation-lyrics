import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowsClockwise,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { getCalibratedAccent, isTauriRuntime, safeInvokeStrict } from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette } from '../../types/music';
import type { AudioSessionItem } from '../../types/suite';
import { AtelierSkeleton, BezelPanel, HairlineSlider } from './AtelierPrimitives';

interface AudioMixerModalProps {
  open: boolean;
  onClose: () => void;
  palette: ColorPalette;
}

export function AudioMixerModal({ open, onClose, palette }: AudioMixerModalProps) {
  const { capabilities, settings, pushToast } = useSuiteStore();
  const reducedMotion = useReducedMotion();
  const accent = getCalibratedAccent(palette);

  const [sessions, setSessions] = useState<AudioSessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!open) return;
    if (!isTauriRuntime() || !capabilities.supports_per_app_mixer) {
      setSessions([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await safeInvokeStrict<AudioSessionItem[]>('get_audio_sessions');
      setSessions(Array.isArray(items) ? items : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to enumerate audio sessions';
      setError(msg);
      pushToast('Failed to read audio mixer', 'error');
    } finally {
      setLoading(false);
    }
  }, [open, capabilities.supports_per_app_mixer, pushToast]);

  useEffect(() => {
    if (open) {
      void loadSessions();
    }
  }, [open, loadSessions]);

  const handleVolumeChange = async (id: string, volume: number) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume } : s)));
    try {
      await safeInvokeStrict('set_app_volume', { sessionId: id, volume });
    } catch {
      pushToast('Failed to update app volume', 'error');
    }
  };

  const handleMuteToggle = async (item: AudioSessionItem) => {
    const nextMuted = !item.muted;
    setSessions((prev) => prev.map((s) => (s.id === item.id ? { ...s, muted: nextMuted } : s)));
    try {
      await safeInvokeStrict('set_app_mute', { sessionId: item.id, muted: nextMuted });
      pushToast(`${item.name} ${nextMuted ? 'muted' : 'unmuted'}`, 'info');
    } catch {
      pushToast('Failed to toggle mute', 'error');
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <BezelPanel
              radiusClass="rounded-[1.75rem]"
              innerRadiusClass="rounded-[calc(1.75rem-0.375rem)]"
              innerClassName="flex max-h-[78vh] flex-col p-5"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#D6B98C]">
                    <SlidersHorizontal size={16} weight="light" />
                  </div>
                  <div>
                    <h2 className="text-sm font-medium tracking-wide text-[#F4F2ED]">
                      Audio Mixer
                    </h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8E8A82]">
                      {settings.island.timerDuckAudio ? 'Ducking Armed' : 'Per-Session Level'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void loadSessions()}
                    title="Refresh sessions"
                    aria-label="Refresh sessions"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-[#8E8A82] transition-colors hover:bg-white/[0.12] hover:text-[#F4F2ED]"
                  >
                    <ArrowsClockwise size={14} weight="light" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    title="Close (Esc)"
                    aria-label="Close mixer"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-[#8E8A82] transition-colors hover:bg-white/[0.12] hover:text-[#F4F2ED]"
                  >
                    <X size={14} weight="light" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {loading ? (
                  <div className="flex flex-col gap-3">
                    {[0, 1, 2].map((idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <AtelierSkeleton className="h-3.5 w-28" />
                          <AtelierSkeleton className="h-3.5 w-10" />
                        </div>
                        <AtelierSkeleton className="h-2 w-full" />
                      </div>
                    ))}
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
                    <Warning size={22} weight="light" className="text-[#E07A7A]" />
                    <p className="text-xs text-[#8E8A82]">{error}</p>
                    <button
                      type="button"
                      onClick={() => void loadSessions()}
                      className="flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.06] px-3.5 py-1.5 text-xs text-[#F4F2ED] hover:bg-white/[0.12]"
                    >
                      <ArrowsClockwise size={13} weight="light" />
                      <span>Retry</span>
                    </button>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7 text-center">
                    <SpeakerHigh size={22} weight="light" className="text-[#8E8A82]" />
                    <p className="text-xs text-[#F4F2ED]/85">
                      {capabilities.supports_per_app_mixer
                        ? 'No active audio streams detected'
                        : capabilities.os === 'linux'
                          ? 'Install pactl or wpctl for per-app audio control'
                          : 'Per-app audio mixer available in native desktop runtime'}
                    </p>
                  </div>
                ) : (
                  sessions.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-[#F4F2ED]">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] tabular-nums text-[#8E8A82]">
                            {item.muted ? 'MUTE' : `${Math.round(item.volume * 100)}%`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleMuteToggle(item)}
                            title={item.muted ? 'Unmute' : 'Mute'}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[#F4F2ED] transition-colors hover:bg-white/[0.14]"
                          >
                            {item.muted ? (
                              <SpeakerSlash size={13} weight="light" className="text-[#E07A7A]" />
                            ) : (
                              <SpeakerHigh size={13} weight="light" />
                            )}
                          </button>
                        </div>
                      </div>

                      <HairlineSlider
                        value={item.volume}
                        min={0}
                        max={1}
                        step={0.01}
                        accent={item.muted ? '#8E8A82' : accent.css}
                        onChange={(val) => void handleVolumeChange(item.id, val)}
                      />

                      {/* Live Peak Meter */}
                      <div className="h-[1.5px] w-full overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full transition-[width] duration-100"
                          style={{
                            width: `${Math.min(100, Math.max(0, item.peak * 100))}%`,
                            backgroundColor: item.muted ? '#8E8A82' : accent.css,
                            opacity: 0.65,
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </BezelPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
