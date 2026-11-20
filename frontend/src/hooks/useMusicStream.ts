import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isTauriRuntime,
  resolveTrackArtUrl,
  safeInvoke,
  safeInvokeStrict,
  safeListen,
} from '../store/tauriBridge';
import type {
  ColorPalette,
  ConnectionState,
  LyricsData,
  StreamPayload,
  TrackInfo,
} from '../types/music';

const DEFAULT_PALETTE: ColorPalette = { r: 214, g: 185, b: 140 };

export type MediaControlAction = 'play_pause' | 'next' | 'prev' | 'seek';

export interface MusicStreamState {
  connectionState: ConnectionState;
  track: TrackInfo | null;
  artUrl: string;
  lyrics: LyricsData | null;
  lyricsLoading: boolean;
  palette: ColorPalette;
  trackOffset: number;
  lastUpdateAt: number;
  retryConnection: () => void;
  setLocalOffset: (offset: number) => void;
  mediaControl: (action: MediaControlAction, position?: number) => Promise<void>;
  persistTrackOffset: (offset: number, trackKey: string) => Promise<void>;
}

async function postHttpAction(endpoint: string, body: Record<string, unknown> | null = null) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export function useMusicStream(enabled = true): MusicStreamState {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    enabled ? 'connecting' : 'connected',
  );
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [palette, setPalette] = useState<ColorPalette>(DEFAULT_PALETTE);
  const [trackOffset, setTrackOffset] = useState(0);
  const [lastUpdateAt, setLastUpdateAt] = useState(0);

  const sseRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);
  const tauriMode = isTauriRuntime();

  const applyPayload = useCallback((data: StreamPayload | null) => {
    if (!data) return;
    setConnectionState('connected');
    backoffRef.current = 1000;
    if (data.track) {
      setTrack(data.track);
    }
    setLyrics(data.lyrics ?? null);
    setLyricsLoading(Boolean(data.lyrics_loading));
    if (data.palette && typeof data.palette.r === 'number') {
      setPalette(data.palette);
    }
    if (typeof data.track_offset === 'number') {
      setTrackOffset(data.track_offset);
    }
    setLastUpdateAt(performance.now());
  }, []);

  const connect = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (tauriMode) {
      setConnectionState('connecting');
      void safeInvoke<StreamPayload>('get_media_status').then((initial) => {
        if (initial) {
          applyPayload(initial);
        } else {
          setConnectionState('connected');
        }
      });
      return;
    }

    setConnectionState((prev) => (prev === 'connected' ? 'connected' : 'connecting'));

    const sse = new EventSource('/api/stream');
    sseRef.current = sse;

    sse.onopen = () => {
      setConnectionState('connected');
      backoffRef.current = 1000;
    };

    sse.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamPayload;
        applyPayload(parsed);
      } catch {
        // Ignore malformed SSE payload
      }
    };

    sse.onerror = () => {
      sse.close();
      sseRef.current = null;
      setConnectionState('error');

      const delay = Math.min(8000, backoffRef.current);
      backoffRef.current = Math.min(8000, backoffRef.current * 1.5);

      retryTimerRef.current = window.setTimeout(() => {
        fetch('/api/status')
          .then((res) => {
            if (!res.ok) throw new Error('Status fetch failed');
            return res.json() as Promise<StreamPayload>;
          })
          .then((data) => {
            applyPayload(data);
            connect();
          })
          .catch(() => {
            connect();
          });
      }, delay);
    };
  }, [applyPayload, tauriMode]);

  useEffect(() => {
    if (!enabled) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    connect();

    let cancelled = false;
    let unlistenMusic: (() => void) | null = null;
    let unlistenLegacy: (() => void) | null = null;
    let unlistenPos: (() => void) | null = null;
    if (tauriMode) {
      void safeListen<StreamPayload>('music-stream', (payload) => {
        if (!cancelled) applyPayload(payload);
      }).then((fn) => {
        if (cancelled) fn();
        else unlistenMusic = fn;
      });
      void safeListen<StreamPayload>('media-update', (payload) => {
        if (!cancelled) applyPayload(payload);
      }).then((fn) => {
        if (cancelled) fn();
        else unlistenLegacy = fn;
      });
      void safeListen<{ position: number; status: string; timestamp: number; server_mono: number }>(
        'position-sync',
        (sync) => {
          if (cancelled || !sync) return;
          setTrack((prev) =>
            prev
              ? {
                  ...prev,
                  position: typeof sync.position === 'number' ? sync.position : prev.position,
                  status: typeof sync.status === 'string' ? sync.status : prev.status,
                  timestamp: typeof sync.timestamp === 'number' ? sync.timestamp : prev.timestamp,
                  server_mono:
                    typeof sync.server_mono === 'number' ? sync.server_mono : prev.server_mono,
                }
              : prev,
          );
          setLastUpdateAt(performance.now());
        },
      ).then((fn) => {
        if (cancelled) fn();
        else unlistenPos = fn;
      });
    }

    return () => {
      cancelled = true;
      if (unlistenMusic) unlistenMusic();
      if (unlistenLegacy) unlistenLegacy();
      if (unlistenPos) unlistenPos();
      if (sseRef.current) sseRef.current.close();
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, [applyPayload, connect, enabled, tauriMode]);

  const mediaControl = useCallback(
    async (action: MediaControlAction, position?: number) => {
      if (tauriMode) {
        if (action === 'play_pause') {
          await safeInvokeStrict('media_play_pause');
        } else if (action === 'next') {
          await safeInvokeStrict('media_next');
        } else if (action === 'prev') {
          await safeInvokeStrict('media_previous');
        } else if (action === 'seek') {
          await safeInvokeStrict('media_seek', { position: position ?? 0 });
        }
        return;
      }

      if (action === 'play_pause') {
        await postHttpAction('/api/play-pause');
      } else if (action === 'next') {
        await postHttpAction('/api/next');
      } else if (action === 'prev') {
        await postHttpAction('/api/previous');
      } else if (action === 'seek') {
        await postHttpAction('/api/seek', { position: position ?? 0 });
      }
    },
    [tauriMode],
  );

  const persistTrackOffset = useCallback(
    async (offset: number, trackKey: string) => {
      setTrackOffset(offset);
      if (tauriMode) {
        await safeInvokeStrict('set_track_offset', { trackKey, offset });
        return;
      }
      await postHttpAction('/api/offset', { offset, track_key: trackKey });
    },
    [tauriMode],
  );

  const artUrl = useMemo(() => resolveTrackArtUrl(track), [track]);

  return {
    connectionState,
    track,
    artUrl,
    lyrics,
    lyricsLoading,
    palette,
    trackOffset,
    lastUpdateAt,
    retryConnection: connect,
    setLocalOffset: setTrackOffset,
    mediaControl,
    persistTrackOffset,
  };
}
