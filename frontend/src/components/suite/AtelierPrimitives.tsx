import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface BezelPanelProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  radiusClass?: string;
  innerRadiusClass?: string;
  look?: 'bottomFloor' | 'lensBuild' | 'rimFrost';
}

export function BezelPanel({
  children,
  className = '',
  innerClassName = '',
  radiusClass = 'rounded-[1.75rem]',
  innerRadiusClass = 'rounded-[calc(1.75rem-0.375rem)]',
  look = 'lensBuild',
}: BezelPanelProps) {
  const outerTone =
    look === 'rimFrost'
      ? 'bg-white/[0.06] border-white/[0.15]'
      : look === 'bottomFloor'
        ? 'bg-[#070709]/85 border-white/[0.09]'
        : 'bg-white/[0.03] border-white/[0.08]';

  const innerTone =
    look === 'rimFrost'
      ? 'bg-[#121218]/80 backdrop-blur-[28px] saturate-[150%] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
      : look === 'bottomFloor'
        ? 'bg-[#08080B]/95 backdrop-blur-xl shadow-[inset_0_-1px_0_rgba(214,185,140,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]'
        : 'bg-[#0E0E12]/88 backdrop-blur-[24px] saturate-[140%] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]';

  return (
    <div className={`border p-1.5 ${outerTone} ${radiusClass} ${className}`}>
      <div className={`${innerTone} ${innerRadiusClass} ${innerClassName}`}>{children}</div>
    </div>
  );
}

interface HairlineSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  accent?: string;
  label?: string;
  displayValue?: string;
  onChange: (value: number) => void;
  className?: string;
}

export function HairlineSlider({
  value,
  min,
  max,
  step = 0.05,
  accent = '#D6B98C',
  label,
  displayValue,
  onChange,
  className = '',
}: HairlineSliderProps) {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label || displayValue) && (
        <div className="flex items-center justify-between text-[11px] tracking-wide text-[#8E8A82]">
          {label && <span>{label}</span>}
          {displayValue && (
            <span className="font-mono tabular-nums text-[#F4F2ED]/85">{displayValue}</span>
          )}
        </div>
      )}
      <div className="relative flex h-5 items-center">
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.10]">
          <div
            className="h-full rounded-full transition-[width] duration-75"
            style={{ width: `${pct}%`, backgroundColor: accent }}
          />
        </div>
        <div
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/25 bg-[#F4F2ED] transition-transform"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label || 'Slider'}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

interface AtelierSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  accent?: string;
  label?: string;
}

export function AtelierSwitch({
  checked,
  onChange,
  accent = '#D6B98C',
  label,
}: AtelierSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 ${
        checked ? 'border-white/20 bg-white/[0.12]' : 'border-white/[0.08] bg-white/[0.04]'
      }`}
      style={checked ? { borderColor: `${accent}66`, backgroundColor: `${accent}26` } : undefined}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          x: checked ? 18 : 3,
          backgroundColor: checked ? accent : '#8E8A82',
        }}
      />
    </button>
  );
}

interface AtelierSkeletonProps {
  className?: string;
}

export function AtelierSkeleton({ className = 'h-4 w-full' }: AtelierSkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gradient-to-r from-white/[0.04] via-white/[0.09] to-white/[0.04] ${className}`}
    />
  );
}
