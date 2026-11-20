import { motion, useReducedMotion } from 'framer-motion';
import { getCalibratedAccent } from '../../store/tauriBridge';
import type { ColorPalette } from '../../types/music';
import type { BuddyMood } from '../../types/suite';
import { BezelPanel } from './AtelierPrimitives';

interface TypingBuddyProps {
  wpm: number;
  peakWpm: number;
  mood: BuddyMood;
  palette: ColorPalette;
  onClick?: () => void;
}

export function TypingBuddy({
  wpm,
  peakWpm,
  mood,
  palette,
  onClick,
}: TypingBuddyProps) {
  const reducedMotion = useReducedMotion();
  const accent = getCalibratedAccent(palette);

  const ringColor =
    mood === 'celebrating' || mood === 'record'
      ? '#D6B98C'
      : mood === 'fast'
        ? accent.css
        : mood === 'typing'
          ? '#F4F2ED'
          : '#8E8A82';

  const pulseDuration =
    mood === 'celebrating'
      ? 0.55
      : mood === 'record'
        ? 0.7
        : mood === 'fast'
          ? 0.95
          : mood === 'typing'
            ? 1.5
            : 3.4;

  const scaleKeyframes =
    reducedMotion
      ? [1, 1]
      : mood === 'resting'
        ? [0.92, 1.0, 0.92]
        : mood === 'celebrating'
          ? [0.85, 1.24, 0.95]
          : [0.9, 1.12, 0.9];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      title={`Typing telemetry (${mood}, peak ${peakWpm} WPM)`}
      className="fixed bottom-6 right-6 z-20 text-left"
    >
      <BezelPanel
        radiusClass="rounded-full"
        innerRadiusClass="rounded-full"
        innerClassName="flex items-center gap-2.5 px-3 py-1.5"
      >
        {/* Minimalist Geometric Pulse Core */}
        <div className="relative flex h-5 w-5 items-center justify-center">
          <motion.span
            animate={{ scale: scaleKeyframes, opacity: mood === 'resting' ? 0.35 : 0.78 }}
            transition={{ duration: pulseDuration, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: ringColor }}
          />
          <span
            className="h-2 w-2 rounded-full transition-colors duration-300"
            style={{ backgroundColor: ringColor }}
          />
        </div>

        <div className="flex items-baseline gap-1">
          <span className="font-mono text-xs font-medium tabular-nums text-[#F4F2ED]">
            {wpm}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8E8A82]">
            wpm
          </span>
        </div>

        {mood === 'record' || mood === 'celebrating' ? (
          <span className="h-1.5 w-1.5 rounded-full bg-[#D6B98C]" title="Peak cadence" />
        ) : null}
      </BezelPanel>
    </motion.button>
  );
}
