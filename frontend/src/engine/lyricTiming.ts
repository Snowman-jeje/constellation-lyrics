import { useEffect, useState } from 'react';
import type { ColorPalette, LyricLine, WordTimestamp } from '../types/music';
import type { LyricsMotion } from '../types/suite';

export interface LyricStyleRendererProps {
  lines: LyricLine[];
  getPosition: () => number;
  isPlaying: boolean;
  palette: ColorPalette;
  accent: ColorPalette;
  isLightBackdrop: boolean;
  artUrl: string;
  motionMode: LyricsMotion;
  scatter: boolean;
  tilt: boolean;
  bulge: boolean;
  coverInWords: boolean;
  fontScale: number;
  beat: number;
  bass: number;
  reducedMotion: boolean;
  trackTitle?: string;
  trackArtist?: string;
  onLineClick?: (timeSec: number) => void;
}

export const GOLD_ACCENT: ColorPalette = { r: 214, g: 185, b: 140 };

/**
 * Resolves word-level timestamps for a lyric line, synthesizing character-weighted
 * word timings when only line-level LRC timestamps are present.
 */
export function resolveLineWords(line: LyricLine, nextLineStart?: number): WordTimestamp[] {
  if (line.words && line.words.length > 0) {
    return line.words;
  }

  const tokens = (line.text || '')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];

  const start = Number.isFinite(line.start_time) ? line.start_time : 0;
  const rawEnd =
    line.end_time && line.end_time > start
      ? line.end_time
      : nextLineStart && nextLineStart > start
        ? nextLineStart
        : start + Math.max(1.8, tokens.length * 0.42);
  const duration = Math.max(0.5, rawEnd - start);

  const totalChars = tokens.reduce((acc, word) => acc + Math.max(1, word.length), 0);
  let cursor = start;

  return tokens.map((word, idx) => {
    const weight = Math.max(1, word.length) / totalChars;
    const span = duration * weight;
    const wordStart = cursor;
    const wordEnd = idx === tokens.length - 1 ? start + duration : cursor + span;
    cursor = wordEnd;
    return {
      word,
      start: wordStart,
      end: wordEnd,
    };
  });
}

/**
 * Finds the currently active line index for a playback position (in seconds).
 * Returns -1 before the first lyric line starts or when lines are empty.
 */
export function findActiveLineIndex(lines: LyricLine[], position: number): number {
  if (!lines || lines.length === 0) return -1;
  if (position < lines[0].start_time) return -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextStart =
      i + 1 < lines.length
        ? lines[i + 1].start_time
        : line.end_time && line.end_time > line.start_time
          ? line.end_time + 1.0
          : line.start_time + 5.0;

    if (position >= line.start_time && position < nextStart) {
      return i;
    }
  }

  const last = lines[lines.length - 1];
  const lastEnd =
    last.end_time && last.end_time > last.start_time ? last.end_time + 1.2 : last.start_time + 5.0;
  if (position >= last.start_time && position <= lastEnd) {
    return lines.length - 1;
  }

  return lines.length - 1;
}

/**
 * Computes active word index and intra-word sweep progress [0..1].
 */
export function computeActiveWordProgress(
  words: WordTimestamp[],
  position: number,
): { activeWordIndex: number; wordProgress: number } {
  if (words.length === 0) {
    return { activeWordIndex: -1, wordProgress: 0 };
  }

  let activeIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (position >= w.start && position <= w.end) {
      activeIdx = i;
      break;
    }
    if (position > w.end) {
      activeIdx = i;
    }
  }

  if (activeIdx === -1) {
    return { activeWordIndex: -1, wordProgress: 0 };
  }

  const activeWord = words[activeIdx];
  const span = Math.max(0.06, activeWord.end - activeWord.start);
  const wordProgress = Math.max(0, Math.min(1, (position - activeWord.start) / span));
  return { activeWordIndex: activeIdx, wordProgress };
}

/**
 * Calibrates extracted album RGB for high-contrast WCAG legibility
 * against Obsidian Void (#070709) or Gallery Paper (#FFFFFF).
 */
export function calibrateAccentRgb(
  palette: ColorPalette | undefined,
  isLightBackdrop: boolean,
): ColorPalette {
  const base =
    palette &&
    Number.isFinite(palette.r) &&
    Number.isFinite(palette.g) &&
    Number.isFinite(palette.b)
      ? palette
      : GOLD_ACCENT;

  let r = Math.max(0, Math.min(255, base.r));
  let g = Math.max(0, Math.min(255, base.g));
  let b = Math.max(0, Math.min(255, base.b));

  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  if (isLightBackdrop) {
    // Darken overly pale tones so ink/accents remain crisp on white backdrop
    if (lum > 0.56) {
      const scale = 0.56 / Math.max(0.01, lum);
      r *= scale;
      g *= scale;
      b *= scale;
    }
    return {
      r: Math.round(Math.max(16, Math.min(210, r))),
      g: Math.round(Math.max(16, Math.min(210, g))),
      b: Math.round(Math.max(20, Math.min(215, b))),
    };
  }

  // On dark backdrops, lift muddy/too-dark colors toward Champagne Gold
  if (lum < 0.14) {
    return GOLD_ACCENT;
  }
  if (lum < 0.45) {
    const boost = Math.min(2.1, 0.48 / Math.max(0.08, lum));
    r = r * boost * 0.78 + GOLD_ACCENT.r * 0.22;
    g = g * boost * 0.78 + GOLD_ACCENT.g * 0.22;
    b = b * boost * 0.78 + GOLD_ACCENT.b * 0.22;
  }

  return {
    r: Math.round(Math.max(30, Math.min(255, r))),
    g: Math.round(Math.max(30, Math.min(255, g))),
    b: Math.round(Math.max(30, Math.min(255, b))),
  };
}

/**
 * Derives a warm, coherent secondary color from a primary RGB palette
 * without producing harsh purple-blue neon clashes.
 */
export function deriveSecondaryPalette(primary: ColorPalette): ColorPalette {
  const r = Math.min(255, Math.max(24, Math.round(primary.r * 0.68 + GOLD_ACCENT.r * 0.24)));
  const g = Math.min(255, Math.max(24, Math.round(primary.g * 0.76 + GOLD_ACCENT.g * 0.2)));
  const b = Math.min(255, Math.max(24, Math.round(primary.b * 0.82 + 28)));
  return { r, g, b };
}

/**
 * Safely parses a CSS #RRGGBB or #RGB hex string to an RGB palette.
 */
export function parseHexRgb(hex: string | undefined, fallback: ColorPalette): ColorPalette {
  if (!hex || typeof hex !== 'string') return fallback;
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3 && /^[0-9a-fA-F]{3}$/.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6 && /^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return fallback;
}

/**
 * Formats seconds into [mm:ss.cc] console telemetry string.
 */
export function formatTerminalTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe % 1) * 100);
  const mm = mins < 10 ? `0${mins}` : `${mins}`;
  const ss = secs < 10 ? `0${secs}` : `${secs}`;
  const cc = centis < 10 ? `0${centis}` : `${centis}`;
  return `${mm}:${ss}.${cc}`;
}

/**
 * Deterministic lightweight hash in [0, 1] for organic word scatter offsets.
 */
export function hashUnit(seed: number, salt: number): number {
  let t = (seed * 374761393 + salt * 668265263) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tracks OS/browser prefers-reduced-motion preference reactively.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
