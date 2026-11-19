/**
 * Constellation Lyrics Application Controller
 * Directly synchronizes live playback from YouTube Music, Spotify, etc.
 * Features server-side color adaptation and one-by-one sequential word reveals.
 */

(function () {
  const ambientCanvas = document.getElementById('ambient-canvas');
  const mainCanvas = document.getElementById('constellation-canvas');
  const manager = new ConstellationManager();
  const renderer = new ConstellationRenderer(ambientCanvas, mainCanvas, manager);

  // DOM Elements
  const backdropPrev = document.getElementById('album-backdrop-prev');
  const backdropCurr = document.getElementById('album-backdrop-curr');
  let currentBackdropUrl = '';

  const albumTitleText = document.getElementById('album-title-text');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');

  const playerBar = document.getElementById('player-bar');
  const trackArtImg = document.getElementById('track-art-img');
  const trackArtPlaceholder = document.getElementById('track-art-placeholder');
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');

  const btnPlay = document.getElementById('btn-play');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  const btnSyncDown = document.getElementById('btn-sync-down');
  const btnSyncUp = document.getElementById('btn-sync-up');
  const syncOffsetLabel = document.getElementById('sync-offset-label');

  const progressFill = document.getElementById('progress-fill');
  const progressBarContainer = document.getElementById('progress-bar-container');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');

  // Application State
  let currentTrack = null;
  let currentLyrics = null;
  let localPosition = 0;
  let lastServerPosition = 0;
  let lastServerTimestamp = 0;
  let playbackStatus = 'Stopped';
  let trackDuration = 0;

  // Sync Offset (persisted in localStorage)
  let syncOffset = parseFloat(localStorage.getItem('constellation_sync_offset') || '0.0');
  function updateSyncLabel() {
    syncOffsetLabel.textContent = (syncOffset >= 0 ? '+' : '') + syncOffset.toFixed(1) + 's';
  }
  updateSyncLabel();

  if (btnSyncDown && btnSyncUp) {
    btnSyncDown.addEventListener('click', (e) => {
      e.stopPropagation();
      syncOffset = Math.round((syncOffset - 0.1) * 10) / 10;
      localStorage.setItem('constellation_sync_offset', syncOffset.toString());
      updateSyncLabel();
    });
    btnSyncUp.addEventListener('click', (e) => {
      e.stopPropagation();
      syncOffset = Math.round((syncOffset + 0.1) * 10) / 10;
      localStorage.setItem('constellation_sync_offset', syncOffset.toString());
      updateSyncLabel();
    });
  }

  // Format Seconds -> MM:SS
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Apply Album Color Palette
  function applyColorPalette(palette) {
    if (!palette || typeof palette.r !== 'number') return;
    const { r, g, b } = palette;

    renderer.setPalette(palette);

    // Apply CSS Variables so all shadows, center glow, and borders react
    document.documentElement.style.setProperty('--accent-color', `rgb(${r}, ${g}, ${b})`);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.55)`);

    // Apply color to left vertical title
    albumTitleText.style.color = `rgba(${r}, ${g}, ${b}, 0.95)`;
    albumTitleText.style.textShadow = `0 0 30px rgba(${r}, ${g}, ${b}, 0.75)`;

    // Apply color to player progress fill and glowing shadow
    progressFill.style.background = `linear-gradient(90deg, rgb(${r}, ${g}, ${b}), #ffffff)`;
    playerBar.style.boxShadow = `0 20px 45px rgba(0, 0, 0, 0.7), 0 0 40px rgba(${r}, ${g}, ${b}, 0.55)`;
  }

  // Cross-fade cinematic album artwork backdrop
  function updateBackdrop(artUrl) {
    if (!artUrl || artUrl === currentBackdropUrl) return;

    const proxyUrl = `/api/art?t=${encodeURIComponent(artUrl)}`;
    const img = new Image();
    img.onload = function () {
      if (backdropCurr && backdropPrev) {
        if (backdropCurr.style.backgroundImage) {
          backdropPrev.style.backgroundImage = backdropCurr.style.backgroundImage;
          backdropPrev.classList.add('active');
        }
        backdropCurr.style.backgroundImage = `url('${proxyUrl}')`;
        backdropCurr.classList.add('active');

        setTimeout(() => {
          backdropPrev.classList.remove('active');
        }, 1200);
      }
      currentBackdropUrl = artUrl;
    };
    img.onerror = function () {
      if (backdropCurr) {
        backdropCurr.style.backgroundImage = `url('${artUrl}')`;
        backdropCurr.classList.add('active');
      }
      currentBackdropUrl = artUrl;
    };
    img.src = proxyUrl;
  }

  // Update UI with Track and Lyrics State
  function handleStateUpdate(data) {
    if (!data || !data.track) return;
    const track = data.track;
    const lyrics = data.lyrics;

    // Apply server-extracted album color palette
    if (data.palette) {
      applyColorPalette(data.palette);
    }

    const isNewTrack = !currentTrack || currentTrack.title !== track.title || currentTrack.artist !== track.artist;
    currentTrack = track;
    currentLyrics = lyrics;

    playbackStatus = track.status;
    trackDuration = track.length || 0;
    lastServerPosition = track.position || 0;
    lastServerTimestamp = performance.now();
    localPosition = lastServerPosition;

    // Update play/pause icon
    if (playbackStatus === 'Playing') {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
    }

    if (isNewTrack) {
      trackTitle.textContent = track.title || 'Waiting for playback';
      trackArtist.textContent = track.artist || 'Play music in YouTube Music';
      
      // Dynamic Album / Track Title on left sidebar
      let displayAlbum = '';
      if (track.album && track.album.toLowerCase() !== 'youtube music') {
        displayAlbum = track.album;
      } else if (track.artist && track.title) {
        displayAlbum = `${track.artist} — ${track.title}`;
      } else if (track.title) {
        displayAlbum = track.title;
      } else {
        displayAlbum = 'YOUTUBE MUSIC';
      }
      albumTitleText.textContent = displayAlbum.toUpperCase();

      if (track.art_url) {
        trackArtImg.src = track.art_url;
        trackArtImg.classList.remove('hidden');
        trackArtPlaceholder.classList.add('hidden');
        updateBackdrop(track.art_url);
      } else {
        trackArtImg.src = '';
        trackArtImg.classList.add('hidden');
        trackArtPlaceholder.classList.remove('hidden');
      }

      // Reset constellation line
      manager.setLine(null, renderer.width, renderer.height);
    }

    if (track.art_url && !currentBackdropUrl) {
      updateBackdrop(track.art_url);
    }
    if (lyrics && lyrics.has_synced) {
      statusBadge.classList.add('hidden');
    } else if (track.status === 'Playing') {
      statusBadge.classList.remove('hidden');
      statusText.textContent = lyrics && lyrics.plain ? 'No Synced Timestamps (Ambient Starfield)' : 'Ambient Starfield';
    } else {
      statusBadge.classList.add('hidden');
    }
  }

  // Connect to Server-Sent Events (SSE) Stream
  function initSSE() {
    const sse = new EventSource('/api/stream');

    sse.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        handleStateUpdate(data);
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    sse.onerror = function () {
      console.warn('SSE connection interrupted, polling fallback...');
      sse.close();
      setTimeout(pollFallback, 1500);
    };
  }

  function pollFallback() {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        handleStateUpdate(data);
        initSSE();
      })
      .catch(() => {
        setTimeout(pollFallback, 2000);
      });
  }

  initSSE();

  // Interactive Player Controls (POST requests)
  function postAction(endpoint, body = null) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null
    }).catch(err => console.error(`Error posting to ${endpoint}:`, err));
  }

  btnPlay.addEventListener('click', () => postAction('/api/play-pause'));
  btnPrev.addEventListener('click', () => postAction('/api/previous'));
  btnNext.addEventListener('click', () => postAction('/api/next'));

  progressBarContainer.addEventListener('click', (e) => {
    if (trackDuration <= 0) return;
    const rect = progressBarContainer.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSeconds = clickRatio * trackDuration;
    postAction('/api/seek', { position: targetSeconds });
  });

  // Fullscreen Toggle
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  btnFullscreen.addEventListener('click', toggleFullscreen);

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      postAction('/api/play-pause');
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      postAction('/api/next');
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      postAction('/api/previous');
    } else if (e.code === 'KeyF' || e.code === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  // Auto-hiding Controls on Mouse Idle
  let idleTimer = null;
  function showPlayerBar() {
    playerBar.classList.remove('faded');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      playerBar.classList.add('faded');
    }, 2500);
  }

  window.addEventListener('mousemove', showPlayerBar);
  window.addEventListener('mousedown', showPlayerBar);
  showPlayerBar();

  // Main Animation & Audio Interpolation Loop (60-120 FPS)
  let lastFrameTime = performance.now();

  function animate() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameTime) * 0.001);
    lastFrameTime = now;

    // Smooth sub-second audio clock interpolation
    if (playbackStatus === 'Playing') {
      const elapsedSinceSync = (now - lastServerTimestamp) * 0.001;
      localPosition = lastServerPosition + elapsedSinceSync;
    } else {
      localPosition = lastServerPosition;
    }

    // Apply user manual sync offset
    const adjustedPosition = localPosition + syncOffset;

    // Update progress bar
    if (trackDuration > 0) {
      const pct = Math.min(100, Math.max(0, (localPosition / trackDuration) * 100));
      progressFill.style.width = `${pct}%`;
      timeCurrent.textContent = formatTime(localPosition);
      timeTotal.textContent = formatTime(trackDuration);
    }

    // Check lyrics line advancement
    if (currentLyrics && currentLyrics.has_synced && currentLyrics.lines.length > 0) {
      const lines = currentLyrics.lines;
      let targetLine = null;

      // Active line switches INSTANTLY the moment the next line begins
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const nextStart = (i + 1 < lines.length) ? lines[i + 1].start_time : (l.end_time || l.start_time + 4.5);
        if (adjustedPosition >= l.start_time && adjustedPosition < nextStart) {
          targetLine = l;
          break;
        }
      }

      // If active line changed, switch constellation immediately (zero delay)
      if (targetLine && targetLine.line_index !== manager.currentLineIndex) {
        manager.setLine(targetLine, renderer.width, renderer.height);
      } else if (!targetLine && manager.currentLineIndex !== -1) {
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];
        if (adjustedPosition < firstLine.start_time || adjustedPosition > (lastLine.end_time || lastLine.start_time + 4.5) + 1.0) {
          manager.setLine(null, renderer.width, renderer.height);
        }
      }
    }

    // Update constellation manager physics and render frame
    manager.update(adjustedPosition, dt);
    renderer.render(dt);

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
})();
