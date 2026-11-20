import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlbumBackdrop } from './components/AlbumBackdrop';
import { BorderAura } from './components/BorderAura';
import { StatusHud, ToastContainer } from './components/BoundaryStates';
import { PlayerDock } from './components/PlayerDock';
import { AudioMixerModal } from './components/suite/AudioMixerModal';
import { DesktopClock } from './components/suite/DesktopClock';
import { DesktopTurntable } from './components/suite/DesktopTurntable';
import { DynamicIsland } from './components/suite/DynamicIsland';
import { LockScreenMode } from './components/suite/LockScreenMode';
import { LuxurySettingsHub } from './components/suite/LuxurySettingsHub';
import { MirrorWidget } from './components/suite/MirrorWidget';
import { TypingBuddy } from './components/suite/TypingBuddy';
import { VerticalSidebar } from './components/VerticalSidebar';
import { LyricsStage } from './components/visuals/LyricsStage';
import { useBeatStream } from './hooks/useBeatStream';
import { useClockSync } from './hooks/useClockSync';
import { useKeySounds } from './hooks/useKeySounds';
import { useMusicStream } from './hooks/useMusicStream';
import type { UpdateCheckResult } from './types/suite';
import { getCalibratedAccent, isTauriRuntime, safeInvoke } from './store/tauriBridge';
import { useSuiteStore } from './store/useSuiteStore';
import type { LyricsStyle } from './types/suite';

const LYRIC_STYLE_ORDER: LyricsStyle[] = ['stars', 'lines', 'bigWords', 'lens', 'depth3d'];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export default function App() {
  const {
    settings,
    updateSection,
    toasts,
    pushToast,
    settingsOpen,
    setSettingsOpen,
    mixerOpen,
    setMixerOpen,
    lockOpen,
    setLockOpen,
    windowRoute,
  } = useSuiteStore();

  const {
    connectionState,
    track,
    artUrl,
    lyrics,
    lyricsLoading,
    palette,
    trackOffset,
    lastUpdateAt,
    retryConnection,
    mediaControl,
    persistTrackOffset,
  } = useMusicStream(windowRoute !== 'clock');

  const { getPosition, displayPosition, seekOptimistic } = useClockSync(track, lastUpdateAt);

  const isPlaying = track?.status === 'Playing';
  const beatActive =
    windowRoute !== 'clock' &&
    settings.utilities.performanceMode !== 'eco' &&
    (windowRoute === 'glow'
      ? settings.glow.enabled && settings.glow.motion === 'music'
      : isPlaying || settings.glow.enabled || settings.lyrics.backdrop === 'live');
  const beatFrame = useBeatStream(beatActive);

  const keySounds = useKeySounds({
    enabled: windowRoute === 'main' && settings.utilities.keySounds,
    profile: settings.utilities.keyProfile,
    volume: settings.utilities.keyVolume,
    release: settings.utilities.keyRelease,
    buddyEnabled: windowRoute === 'main' && settings.utilities.buddyEnabled,
  });

  const [dockVisible, setDockVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const hoveringDockRef = useRef(false);

  // Sync adaptive accent CSS variables on :root
  useEffect(() => {
    const accent = getCalibratedAccent(palette);
    const root = document.documentElement;
    root.style.setProperty('--oa-accent-r', String(accent.r));
    root.style.setProperty('--oa-accent-g', String(accent.g));
    root.style.setProperty('--oa-accent-b', String(accent.b));
    root.style.setProperty('--oa-accent-rgb', accent.rgb);
    root.style.setProperty('--accent-color', accent.css);
  }, [palette]);

  // Ensure transparent document root for standalone Tauri overlay windows
  useEffect(() => {
    const isTransparentOverlay =
      windowRoute === 'island' ||
      windowRoute === 'clock' ||
      windowRoute === 'turntable' ||
      windowRoute === 'glow';

    const rootEl = document.getElementById('root');
    if (isTransparentOverlay) {
      document.documentElement.style.backgroundColor = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      if (rootEl) rootEl.style.backgroundColor = 'transparent';
    } else {
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
      if (rootEl) rootEl.style.backgroundColor = '';
    }
  }, [windowRoute]);

  // Wake lock when lyrics.keepScreenOn is active
  useEffect(() => {
    if (windowRoute !== 'main' || !settings.lyrics.keepScreenOn) return;
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    void nav.wakeLock
      .request('screen')
      .then((lock) => {
        sentinel = lock;
      })
      .catch(() => {});

    return () => {
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [windowRoute, settings.lyrics.keepScreenOn]);

  // Silent startup auto-update check against GitHub Releases
  useEffect(() => {
    if (windowRoute !== 'main' || !isTauriRuntime() || !settings.utilities.autoUpdate) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void safeInvoke<UpdateCheckResult>('check_for_updates').then((res) => {
        if (active && res?.has_update) {
          pushToast(`Update v${res.latest_version} available in Settings`, 'info');
        }
      });
    }, 4500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [windowRoute, settings.utilities.autoUpdate, pushToast]);

  // Auto-hide PlayerDock after 2.5 seconds of inactivity
  const scheduleHideDock = useCallback((delayMs = 2500) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!hoveringDockRef.current) {
        setDockVisible(false);
      }
    }, delayMs);
  }, []);

  const handleDockEnter = useCallback(() => {
    hoveringDockRef.current = true;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setDockVisible(true);
  }, []);

  const handleDockLeave = useCallback(() => {
    hoveringDockRef.current = false;
    scheduleHideDock(2500);
  }, [scheduleHideDock]);

  useEffect(() => {
    if (windowRoute !== 'main') return;

    const onMouseMove = () => {
      setDockVisible(true);
      scheduleHideDock(2500);
    };

    const onMouseLeave = () => {
      hoveringDockRef.current = false;
      scheduleHideDock(500);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [windowRoute, scheduleHideDock]);

  // Idle auto-lock timer
  useEffect(() => {
    if (windowRoute !== 'main' || settings.lock.idleMinutes <= 0) return;
    let timer = 0;

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!settingsOpen && !mixerOpen) {
          setLockOpen(true);
        }
      }, settings.lock.idleMinutes * 60_000);
    };

    arm();
    window.addEventListener('mousemove', arm, { passive: true });
    window.addEventListener('keydown', arm, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [windowRoute, settings.lock.idleMinutes, settingsOpen, mixerOpen, setLockOpen]);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isTauriRuntime()) {
      const next = !isFullscreen;
      setIsFullscreen(next);
      void safeInvoke('set_main_fullscreen', { fullscreen: next });
      return;
    }
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [isFullscreen]);

  const handlePlayPause = useCallback(() => {
    void mediaControl('play_pause').catch(() =>
      pushToast('Failed to toggle playback', 'error'),
    );
  }, [mediaControl, pushToast]);

  const handleNext = useCallback(() => {
    void mediaControl('next').catch(() => pushToast('Failed to skip track', 'error'));
  }, [mediaControl, pushToast]);

  const handlePrev = useCallback(() => {
    void mediaControl('prev').catch(() => pushToast('Failed to go back', 'error'));
  }, [mediaControl, pushToast]);

  const handleSeek = useCallback(
    (seconds: number) => {
      seekOptimistic(seconds);
      void mediaControl('seek', seconds).catch(() =>
        pushToast('Seek unsupported by active player', 'warning'),
      );
    },
    [seekOptimistic, mediaControl, pushToast],
  );

  const handleOffsetChange = useCallback(
    (delta: number) => {
      const next = Math.round((trackOffset + delta) * 10) / 10;
      const trackKey = track?.title ? `${track.artist} - ${track.title}` : '';
      void persistTrackOffset(next, trackKey)
        .then(() => {
          pushToast(`Sync offset: ${next >= 0 ? '+' : ''}${next.toFixed(1)}s`, 'success');
        })
        .catch(() => pushToast('Failed to save offset', 'error'));
    },
    [trackOffset, track, persistTrackOffset, pushToast],
  );

  const handleCycleLyricsStyle = useCallback(() => {
    const idx = LYRIC_STYLE_ORDER.indexOf(settings.lyrics.style);
    const next = LYRIC_STYLE_ORDER[(idx + 1) % LYRIC_STYLE_ORDER.length];
    updateSection('lyrics', { style: next });
    pushToast(`Lyrics style: ${next}`, 'info');
  }, [settings.lyrics.style, updateSection, pushToast]);

  const handleDismissLock = useCallback(() => {
    if (windowRoute === 'lock' && isTauriRuntime()) {
      void safeInvoke('close_overlay_window', { label: 'lock' });
      return;
    }
    setLockOpen(false);
  }, [windowRoute, setLockOpen]);

  // Global keyboard shortcuts for main route
  useEffect(() => {
    if (windowRoute !== 'main') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(!settingsOpen);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault();
        setLockOpen(!lockOpen);
        return;
      }

      if (e.key === 'Escape') {
        if (lockOpen) {
          setLockOpen(false);
          return;
        }
        if (mixerOpen) {
          setMixerOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
      }

      if (isEditableTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.code === 'F11' || (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === '[' || e.key === '-') {
        handleOffsetChange(-0.2);
      } else if (e.key === ']' || e.key === '=') {
        handleOffsetChange(0.2);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    windowRoute,
    settingsOpen,
    mixerOpen,
    lockOpen,
    setSettingsOpen,
    setMixerOpen,
    setLockOpen,
    handlePlayPause,
    handleNext,
    handlePrev,
    toggleFullscreen,
    handleOffsetChange,
  ]);

  // Standalone multi-window routes for Tauri overlay windows
  if (windowRoute === 'island') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <DynamicIsland
          standalone
          track={track}
          artUrl={artUrl}
          palette={palette}
          displayPosition={displayPosition}
          beat={beatFrame}
          onPlayPause={handlePlayPause}
          onPrev={handlePrev}
          onNext={handleNext}
          onSeek={handleSeek}
        />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (windowRoute === 'clock') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <DesktopClock standalone palette={palette} />
      </div>
    );
  }

  if (windowRoute === 'turntable') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <DesktopTurntable
          standalone
          track={track}
          artUrl={artUrl}
          palette={palette}
          displayPosition={displayPosition}
          onPlayPause={handlePlayPause}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      </div>
    );
  }

  if (windowRoute === 'glow') {
    return (
      <div className="pointer-events-none h-screen w-screen overflow-hidden bg-transparent">
        <BorderAura
          palette={palette}
          isPlaying={isPlaying}
          enabled={settings.glow.enabled}
          style={settings.glow.style}
          motion={settings.glow.motion}
          thickness={settings.glow.thickness}
          brightness={settings.glow.brightness}
          ownColors={settings.glow.ownColors}
          colorFirst={settings.glow.colorFirst}
          colorSecond={settings.glow.colorSecond}
          beat={beatFrame.beat}
          bass={beatFrame.bass}
        />
      </div>
    );
  }

  if (windowRoute === 'lock') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-[#070709]">
        <LockScreenMode
          open
          standalone
          track={track}
          artUrl={artUrl}
          lyrics={lyrics}
          lyricsLoading={lyricsLoading}
          palette={palette}
          getPosition={getPosition}
          beat={beatFrame}
          onPlayPause={handlePlayPause}
          onPrev={handlePrev}
          onNext={handleNext}
          onLineClick={handleSeek}
          onDismiss={handleDismissLock}
        />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  // Main Atelier Stage
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#070709]">
      <AlbumBackdrop
        artUrl={artUrl}
        palette={palette}
        backdrop={settings.lyrics.backdrop}
        motionMode={settings.lyrics.motion}
        liveScene={settings.live.scene}
        liveReaction={settings.live.reaction}
        liveSpeed={settings.live.speed}
        beat={beatFrame.beat}
        bass={beatFrame.bass}
        parallaxEnabled={settings.desktop.wallpaperParallax}
        parallaxAmount={settings.desktop.wallpaperParallaxAmount}
        weatherKind={settings.desktop.wallpaperWeather}
        paused={lockOpen}
      />

      {!lockOpen && settings.glow.enabled && (
        <BorderAura
          palette={palette}
          isPlaying={isPlaying}
          enabled={settings.glow.enabled}
          style={settings.glow.style}
          motion={settings.glow.motion}
          thickness={settings.glow.thickness}
          brightness={settings.glow.brightness}
          ownColors={settings.glow.ownColors}
          colorFirst={settings.glow.colorFirst}
          colorSecond={settings.glow.colorSecond}
          beat={beatFrame.beat}
          bass={beatFrame.bass}
        />
      )}

      {!lockOpen && (
        <LyricsStage
          lyrics={lyrics}
          lyricsLoading={lyricsLoading}
          getPosition={getPosition}
          syncOffset={trackOffset}
          isPlaying={isPlaying}
          palette={palette}
          artUrl={artUrl}
          styleKind={settings.lyrics.style}
          backdrop={settings.lyrics.backdrop}
          motionMode={settings.lyrics.motion}
          scatter={settings.lyrics.scatter}
          tilt={settings.lyrics.tilt}
          bulge={settings.lyrics.bulge}
          coverInWords={settings.lyrics.coverInWords}
          fontScale={settings.lyrics.fontScale}
          beat={beatFrame.beat}
          bass={beatFrame.bass}
          trackTitle={track?.title}
          trackArtist={track?.artist}
          onLineClick={(sec) => handleSeek(Math.max(0, sec - trackOffset))}
        />
      )}

      <VerticalSidebar track={track} palette={palette} />

      <StatusHud
        connectionState={connectionState}
        lyricsLoading={lyricsLoading}
        track={track}
        lyrics={lyrics}
        onRetry={retryConnection}
        hideAmbientPill={settings.island.enabled && settings.island.mode !== 'closed'}
      />

      {/* In-app widgets render in browser preview; Tauri spawns dedicated transparent overlay windows */}
      {!isTauriRuntime() && settings.island.enabled && (
        <DynamicIsland
          track={track}
          artUrl={artUrl}
          palette={palette}
          displayPosition={displayPosition}
          beat={beatFrame}
          isFullscreen={isFullscreen}
          onPlayPause={handlePlayPause}
          onPrev={handlePrev}
          onNext={handleNext}
          onSeek={handleSeek}
        />
      )}

      <AnimatePresence>
        {!isTauriRuntime() && settings.desktop.clockEnabled && (
          <DesktopClock key="desktop-clock" palette={palette} />
        )}
        {!isTauriRuntime() && settings.desktop.turntableEnabled && (
          <DesktopTurntable
            key="desktop-turntable"
            track={track}
            artUrl={artUrl}
            palette={palette}
            displayPosition={displayPosition}
            onPlayPause={handlePlayPause}
            onPrev={handlePrev}
            onNext={handleNext}
          />
        )}
        {settings.utilities.buddyEnabled && (
          <TypingBuddy
            key="typing-buddy"
            wpm={keySounds.wpm}
            peakWpm={keySounds.peakWpm}
            mood={keySounds.mood}
            palette={palette}
            onClick={() => setSettingsOpen(true)}
          />
        )}
        {settings.utilities.mirrorEnabled && <MirrorWidget key="mirror-widget" />}
      </AnimatePresence>

      <PlayerDock
        visible={dockVisible && !lockOpen && !settingsOpen && !mixerOpen}
        track={track}
        palette={palette}
        displayPosition={displayPosition}
        syncOffset={trackOffset}
        isFullscreen={isFullscreen}
        lyricsStyle={settings.lyrics.style}
        onPlayPause={handlePlayPause}
        onPrev={handlePrev}
        onNext={handleNext}
        onSeek={handleSeek}
        onOffsetChange={handleOffsetChange}
        onCycleLyricsStyle={handleCycleLyricsStyle}
        onOpenMixer={() => setMixerOpen(true)}
        onOpenLock={() => setLockOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleFullscreen={toggleFullscreen}
        onMouseEnter={handleDockEnter}
        onMouseLeave={handleDockLeave}
      />

      <LuxurySettingsHub
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        palette={palette}
        onOpenMixer={() => {
          setSettingsOpen(false);
          setMixerOpen(true);
        }}
        onLaunchLock={() => setLockOpen(true)}
      />

      <AudioMixerModal
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        palette={palette}
      />

      <LockScreenMode
        open={lockOpen}
        track={track}
        artUrl={artUrl}
        lyrics={lyrics}
        lyricsLoading={lyricsLoading}
        palette={palette}
        getPosition={getPosition}
        beat={beatFrame}
        onPlayPause={handlePlayPause}
        onPrev={handlePrev}
        onNext={handleNext}
        onLineClick={(sec) => handleSeek(Math.max(0, sec - trackOffset))}
        onDismiss={handleDismissLock}
      />

      <ToastContainer toasts={toasts} />

      <div className="oa-film-grain" aria-hidden="true" />
    </main>
  );
}
