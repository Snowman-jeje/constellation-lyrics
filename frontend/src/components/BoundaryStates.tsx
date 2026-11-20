import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowsClockwise, Warning, WifiSlash } from '@phosphor-icons/react';
import type { ConnectionState, LyricsData, ToastItem, TrackInfo } from '../types/music';
import { BezelPanel } from './suite/AtelierPrimitives';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unexpected interface state',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Constellation Suite boundary caught error:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#070709] p-6 text-[#F4F2ED]">
        <BezelPanel className="w-full max-w-sm" innerClassName="flex flex-col items-center gap-4 p-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#D6B98C]">
            <Warning size={22} weight="light" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-xl tracking-wide text-[#F4F2ED]">Atelier Recovery</h2>
            <p className="text-xs text-[#8E8A82]">{this.state.message}</p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-1.5 text-xs tracking-wide text-[#F4F2ED] transition-colors hover:bg-white/[0.12]"
          >
            <ArrowsClockwise size={14} weight="light" />
            <span>Reload Stage</span>
          </button>
        </BezelPanel>
      </div>
    );
  }
}

interface StatusHudProps {
  connectionState: ConnectionState;
  lyricsLoading: boolean;
  track: TrackInfo | null;
  lyrics: LyricsData | null;
  onRetry: () => void;
  hideAmbientPill?: boolean;
}

export function StatusHud({
  connectionState,
  lyricsLoading,
  track,
  lyrics,
  onRetry,
  hideAmbientPill = false,
}: StatusHudProps) {
  const isPlaying = track?.status === 'Playing';

  return (
    <>
      {/* Disconnected HUD Pill */}
      <AnimatePresence>
        {connectionState === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="fixed right-5 top-5 z-30"
          >
            <BezelPanel
              radiusClass="rounded-full"
              innerRadiusClass="rounded-full"
              innerClassName="flex items-center gap-2.5 px-3.5 py-1.5 text-[11px] text-[#F4F2ED]"
            >
              <WifiSlash size={14} weight="light" className="text-[#D6B98C]" />
              <span className="tracking-wide text-[#8E8A82]">Offline</span>
              <button
                type="button"
                onClick={onRetry}
                title="Reconnect stream"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.07] text-[#F4F2ED] transition-transform hover:scale-105 hover:bg-white/[0.14]"
              >
                <ArrowsClockwise size={12} weight="light" />
              </button>
            </BezelPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiet Status Pill */}
      <AnimatePresence>
        {!hideAmbientPill && lyricsLoading ? (
          <motion.div
            key="loading-lyrics"
            initial={{ opacity: 0, x: '-50%', y: -6 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: -6 }}
            className="pointer-events-none fixed left-1/2 top-[3.2vh] z-10 flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0E0E12]/70 px-3.5 py-1 backdrop-blur-xl"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#D6B98C]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8E8A82]">
              Syncing
            </span>
          </motion.div>
        ) : !hideAmbientPill && isPlaying && (!lyrics || !lyrics.has_synced) ? (
          <motion.div
            key="ambient-mode"
            initial={{ opacity: 0, x: '-50%', y: -6 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: -6 }}
            className="pointer-events-none fixed left-1/2 top-[3.2vh] z-10 rounded-full border border-white/[0.07] bg-[#0E0E12]/55 px-3.5 py-1 backdrop-blur-xl"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8E8A82]/85">
              {lyrics?.plain ? 'Plain' : 'Ambient'}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <div className="pointer-events-none fixed bottom-[13vh] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <AnimatePresence>
        {toasts.map((toast) => {
          const dotColor =
            toast.tone === 'success'
              ? '#84C9A4'
              : toast.tone === 'warning'
                ? '#D6B98C'
                : toast.tone === 'error'
                  ? '#E07A7A'
                  : '#F4F2ED';
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.2 }}
            >
              <BezelPanel
                radiusClass="rounded-full"
                innerRadiusClass="rounded-full"
                innerClassName="flex items-center gap-2 px-3.5 py-1.5 text-[11px] tracking-wide text-[#F4F2ED]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <span>{toast.message}</span>
              </BezelPanel>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
