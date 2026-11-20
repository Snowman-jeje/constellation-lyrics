import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';
import {
  calibrateAccentRgb,
  deriveSecondaryPalette,
  GOLD_ACCENT,
  parseHexRgb,
  usePrefersReducedMotion,
} from '../engine/lyricTiming';
import { useBeatStream } from '../hooks/useBeatStream';
import type { ColorPalette } from '../types/music';
import type { GlowMotion, GlowStyle } from '../types/suite';

export interface BorderAuraProps {
  palette: ColorPalette;
  isPlaying: boolean;
  enabled?: boolean;
  style?: GlowStyle;
  motion?: GlowMotion;
  thickness?: number;
  brightness?: number;
  ownColors?: boolean;
  colorFirst?: string;
  colorSecond?: string;
  beat?: number;
  bass?: number;
}

export function BorderAura({
  palette,
  isPlaying,
  enabled = true,
  style = 'rim',
  motion: motionMode = 'music',
  thickness = 0.55,
  brightness = 0.75,
  ownColors = false,
  colorFirst,
  colorSecond,
  beat,
  bass,
}: BorderAuraProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const hasExternalBeat = beat !== undefined || bass !== undefined;
  const shouldUseInternalStream =
    enabled && isPlaying && motionMode === 'music' && !reducedMotion && !hasExternalBeat;

  useBeatStream(containerRef, shouldUseInternalStream);

  // Sync external beat/bass metrics directly to CSS vars without triggering re-renders
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasExternalBeat) return;
    const safeBeat =
      motionMode === 'music' && !reducedMotion && isPlaying
        ? Math.max(0, Math.min(1, beat ?? 0))
        : 0;
    const safeBass =
      motionMode === 'music' && !reducedMotion && isPlaying
        ? Math.max(0, Math.min(1, bass ?? 0))
        : 0;
    el.style.setProperty('--beat', safeBeat.toFixed(3));
    el.style.setProperty('--bass', safeBass.toFixed(3));
  }, [hasExternalBeat, beat, bass, motionMode, reducedMotion, isPlaying]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (motionMode === 'steady' || !isPlaying || reducedMotion) {
      el.style.setProperty('--beat', '0');
      el.style.setProperty('--bass', '0');
    }
  }, [motionMode, isPlaying, reducedMotion]);

  const { c1, c2 } = useMemo(() => {
    if (ownColors) {
      const first = parseHexRgb(colorFirst, GOLD_ACCENT);
      const second = parseHexRgb(colorSecond, deriveSecondaryPalette(first));
      return { c1: first, c2: second };
    }
    const first = calibrateAccentRgb(palette, false);
    const second = deriveSecondaryPalette(first);
    return { c1: first, c2: second };
  }, [ownColors, colorFirst, colorSecond, palette]);

  if (!enabled) return null;

  const clampedThickness = Math.max(0.1, Math.min(1, thickness));
  const clampedBrightness = Math.max(0.05, Math.min(1, brightness));

  const edgeReach = Math.round(8 + clampedThickness * 22); // 10% - 30%
  const sideReach = Math.round(14 + clampedThickness * 26); // 16% - 40%
  const baseAlpha = (isPlaying ? 0.36 : 0.2) * (0.35 + clampedBrightness * 0.85);
  const peakAlpha = Math.min(0.88, baseAlpha * 1.45);

  const rgb1 = `${c1.r}, ${c1.g}, ${c1.b}`;
  const rgb2 = `${c2.r}, ${c2.g}, ${c2.b}`;

  const isMusicReactive = motionMode === 'music' && !reducedMotion;
  const steadyAnimate =
    motionMode === 'steady' && !reducedMotion
      ? {
          opacity: [0.68, 0.92, 0.68],
          scale: [1, 1.012, 1],
        }
      : undefined;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-[4] overflow-hidden"
      style={
        {
          '--beat': '0',
          '--bass': '0',
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0 will-change-transform"
        animate={steadyAnimate}
        transition={
          steadyAnimate
            ? {
                duration: 10,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : undefined
        }
        style={
          isMusicReactive
            ? {
                transform: 'scale(calc(1 - var(--beat) * 0.018))',
                opacity: `calc(0.72 + var(--bass) * 0.16 + var(--beat) * 0.24)`,
              }
            : undefined
        }
      >
        {style === 'rim' && (
          <>
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(180deg, rgba(${rgb1}, ${baseAlpha}) 0%, rgba(${rgb1}, 0) ${edgeReach}%),
                  linear-gradient(0deg, rgba(${rgb2}, ${baseAlpha}) 0%, rgba(${rgb2}, 0) ${edgeReach}%),
                  linear-gradient(90deg, rgba(${rgb1}, ${baseAlpha * 0.82}) 0%, rgba(${rgb1}, 0) ${Math.round(edgeReach * 0.85)}%),
                  linear-gradient(270deg, rgba(${rgb2}, ${baseAlpha * 0.82}) 0%, rgba(${rgb2}, 0) ${Math.round(edgeReach * 0.85)}%)
                `,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                border: `1px solid rgba(${rgb1}, calc(0.18 + var(--beat) * 0.34))`,
              }}
            />
          </>
        )}

        {style === 'edges' && (
          <>
            {/* Top & Bottom alternating harmonic edges */}
            <div
              className="absolute inset-x-0 top-0 origin-top will-change-transform"
              style={{
                height: `${edgeReach + 6}vh`,
                transform: isMusicReactive ? 'scaleY(calc(0.92 + var(--beat) * 0.24))' : undefined,
                background: `linear-gradient(180deg, rgba(${rgb1}, ${peakAlpha}) 0%, rgba(${rgb1}, ${baseAlpha * 0.35}) 45%, rgba(${rgb1}, 0) 100%)`,
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 origin-bottom will-change-transform"
              style={{
                height: `${edgeReach + 6}vh`,
                transform: isMusicReactive ? 'scaleY(calc(0.92 + var(--bass) * 0.26))' : undefined,
                background: `linear-gradient(0deg, rgba(${rgb2}, ${peakAlpha}) 0%, rgba(${rgb2}, ${baseAlpha * 0.35}) 45%, rgba(${rgb2}, 0) 100%)`,
              }}
            />
            <div
              className="absolute inset-y-0 left-0 origin-left will-change-transform"
              style={{
                width: `${Math.round(edgeReach * 0.72)}vw`,
                transform: isMusicReactive ? 'scaleX(calc(0.92 + var(--beat) * 0.2))' : undefined,
                background: `linear-gradient(90deg, rgba(${rgb2}, ${baseAlpha * 0.78}) 0%, rgba(${rgb2}, 0) 100%)`,
              }}
            />
            <div
              className="absolute inset-y-0 right-0 origin-right will-change-transform"
              style={{
                width: `${Math.round(edgeReach * 0.72)}vw`,
                transform: isMusicReactive ? 'scaleX(calc(0.92 + var(--beat) * 0.2))' : undefined,
                background: `linear-gradient(270deg, rgba(${rgb1}, ${baseAlpha * 0.78}) 0%, rgba(${rgb1}, 0) 100%)`,
              }}
            />
          </>
        )}

        {style === 'corners' && (
          <div
            className="absolute inset-0 will-change-transform"
            style={{
              transform: isMusicReactive
                ? 'scale(calc(1 + var(--beat) * 0.035 + var(--bass) * 0.02))'
                : undefined,
              background: `
                radial-gradient(ellipse ${sideReach + 18}% ${edgeReach + 24}% at 0% 0%, rgba(${rgb1}, ${peakAlpha}) 0%, rgba(${rgb1}, ${baseAlpha * 0.28}) 46%, transparent 78%),
                radial-gradient(ellipse ${sideReach + 18}% ${edgeReach + 24}% at 100% 100%, rgba(${rgb1}, ${peakAlpha * 0.92}) 0%, rgba(${rgb1}, ${baseAlpha * 0.24}) 46%, transparent 78%),
                radial-gradient(ellipse ${sideReach + 16}% ${edgeReach + 22}% at 100% 0%, rgba(${rgb2}, ${peakAlpha * 0.88}) 0%, rgba(${rgb2}, ${baseAlpha * 0.24}) 46%, transparent 78%),
                radial-gradient(ellipse ${sideReach + 16}% ${edgeReach + 22}% at 0% 100%, rgba(${rgb2}, ${peakAlpha * 0.88}) 0%, rgba(${rgb2}, ${baseAlpha * 0.24}) 46%, transparent 78%)
              `,
            }}
          />
        )}

        {style === 'sides' && (
          <>
            <div
              className="absolute inset-y-0 left-0 origin-left will-change-transform"
              style={{
                width: `${sideReach}vw`,
                transform: isMusicReactive ? 'scaleX(calc(0.94 + var(--beat) * 0.22))' : undefined,
                background: `
                  radial-gradient(ellipse 95% 64% at 0% 50%, rgba(${rgb1}, ${peakAlpha}) 0%, rgba(${rgb1}, ${baseAlpha * 0.34}) 48%, transparent 82%),
                  linear-gradient(90deg, rgba(${rgb1}, ${baseAlpha * 0.55}) 0%, transparent 100%)
                `,
              }}
            />
            <div
              className="absolute inset-y-0 right-0 origin-right will-change-transform"
              style={{
                width: `${sideReach}vw`,
                transform: isMusicReactive ? 'scaleX(calc(0.94 + var(--bass) * 0.22))' : undefined,
                background: `
                  radial-gradient(ellipse 95% 64% at 100% 50%, rgba(${rgb2}, ${peakAlpha}) 0%, rgba(${rgb2}, ${baseAlpha * 0.34}) 48%, transparent 82%),
                  linear-gradient(270deg, rgba(${rgb2}, ${baseAlpha * 0.55}) 0%, transparent 100%)
                `,
              }}
            />
          </>
        )}
      </motion.div>
    </div>
  );
}
