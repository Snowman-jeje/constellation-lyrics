import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ColorPalette, TrackInfo } from '../types/music';
import type {
  AppSettings,
  PlatformCapabilities,
  WindowRouteKind,
} from '../types/suite';
import { DEFAULT_SETTINGS } from '../types/suite';

const VALID_ROUTES = new Set<WindowRouteKind>([
  'main',
  'island',
  'clock',
  'turntable',
  'glow',
  'lock',
]);

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

export async function safeInvokeStrict<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('Native Tauri bridge is unavailable in browser preview');
  }
  return invoke<T>(cmd, args);
}

export async function safeListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  try {
    const unlisten = await listen<T>(event, (ev) => {
      handler(ev.payload);
    });
    return unlisten;
  } catch {
    return () => {};
  }
}

export async function setWindowIgnoreCursor(ignore: boolean): Promise<void> {
  await safeInvoke('set_window_ignore_cursor', { ignore });
}

export function getWindowRoute(): WindowRouteKind {
  if (typeof window === 'undefined') return 'main';
  const param = new URLSearchParams(window.location.search).get('window');
  if (param && VALID_ROUTES.has(param as WindowRouteKind)) {
    return param as WindowRouteKind;
  }
  return 'main';
}

export function isSafeMediaUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('data:image/jpeg;base64,') ||
    trimmed.startsWith('data:image/png;base64,') ||
    trimmed.startsWith('data:image/webp;base64,')
  ) {
    return !/[\s"'()\\<>]/.test(trimmed);
  }
  if (trimmed.startsWith('/api/art?k=')) {
    return !/[\s"'()\\<>]/.test(trimmed);
  }
  if (trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' && !/["'()\\]/.test(trimmed);
    } catch {
      return false;
    }
  }
  return false;
}

export function toSafeCssUrl(raw: string): string | undefined {
  if (!isSafeMediaUrl(raw)) return undefined;
  const escaped = raw.trim().replace(/[\\"()'\r\n]/g, '');
  return `url("${escaped}")`;
}

export function resolveTrackArtUrl(track: TrackInfo | null): string {
  if (!track) return '';
  if (track.art_data_url && isSafeMediaUrl(track.art_data_url)) return track.art_data_url;
  if (track.has_art && track.art_key) {
    return `/api/art?k=${encodeURIComponent(track.art_key)}`;
  }
  if (track.art_url && isSafeMediaUrl(track.art_url)) return track.art_url;
  return '';
}

export function detectBrowserCapabilities(): PlatformCapabilities {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  let os: PlatformCapabilities['os'] = 'linux';
  if (ua.includes('win')) os = 'windows';
  else if (ua.includes('mac')) os = 'macos';

  return {
    os,
    supports_taskbar_styling: false,
    supports_volume_osd_hide: false,
    supports_per_app_mixer: false,
    supports_global_key_hook: false,
  };
}

export function mergeSettings(partial?: Partial<AppSettings> | null): AppSettings {
  if (!partial) return structuredClone(DEFAULT_SETTINGS);
  return {
    lyrics: { ...DEFAULT_SETTINGS.lyrics, ...(partial.lyrics ?? {}) },
    live: { ...DEFAULT_SETTINGS.live, ...(partial.live ?? {}) },
    glow: { ...DEFAULT_SETTINGS.glow, ...(partial.glow ?? {}) },
    island: { ...DEFAULT_SETTINGS.island, ...(partial.island ?? {}) },
    desktop: { ...DEFAULT_SETTINGS.desktop, ...(partial.desktop ?? {}) },
    lock: { ...DEFAULT_SETTINGS.lock, ...(partial.lock ?? {}) },
    utilities: { ...DEFAULT_SETTINGS.utilities, ...(partial.utilities ?? {}) },
  };
}

/**
 * Calibrate album RGB against obsidian surfaces (#070709 / #0E0E12)
 * so text and border highlights remain legible even on dark album covers.
 */
export function getCalibratedAccent(palette?: ColorPalette | null): {
  r: number;
  g: number;
  b: number;
  css: string;
  rgb: string;
} {
  if (!palette) {
    return { r: 214, g: 185, b: 140, css: '#D6B98C', rgb: '214, 185, 140' };
  }
  let { r, g, b } = palette;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance < 0.34) {
    const boost = Math.min(2.4, 0.38 / Math.max(0.06, luminance));
    r = Math.min(244, Math.round(r * boost + 26));
    g = Math.min(242, Math.round(g * boost + 24));
    b = Math.min(237, Math.round(b * boost + 20));
  }
  return {
    r,
    g,
    b,
    css: `rgb(${r}, ${g}, ${b})`,
    rgb: `${r}, ${g}, ${b}`,
  };
}
