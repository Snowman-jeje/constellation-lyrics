# Constellation Lyrics Visualizer (for Linux / GNOME)

A music-reactive celestial constellation synced lyrics visualizer for Linux/GNOME, inspired by aesthetic macOS visualizers. Fully compatible with **YouTube Music**, **Spotify**, and any MPRIS media player.

![Constellation Visualizer](https://raw.githubusercontent.com/Snowman-jeje/constellation-lyrics/main/preview.png)

## Features
- **Live MPRIS Synchronization**: Automatically detects and synchronizes with whatever song is playing in **YouTube Music**, **Spotify**, or local media players without manual setup.
- **Word-by-Word Studio Sync**: Words emerge sequentially one by one as they are sung with growing constellation connection lines, utilizing LRCLIB's millisecond-accurate `lyricsfile` word timestamps.
- **High-Agility Rap Flow Engine**:
  - Automatically measures vocal cadence (Words Per Second).
  - High-agility reticle spring physics locks onto rapid syllables in $\le 25\text{ms}$ with zero lag.
  - Generates an *Undulating Cosmic Stream* topology for dense/fast lyric lines so words flow seamlessly across the display.
  - Natural syllable-weighted cadence delivery for standard LRC lines.
- **Cinematic Album Backdrop**: Fullscreen blurred artwork background from the currently playing track with smooth 1.2s cross-fading.
- **Dynamic Ambient Glow**: Soft, breathing ambient glow in the center radiating colors extracted in real-time from the album cover palette.
- **4-Point Star Reticle**: A luminous 78px 4-point crosshair star with double diamond flares and radiant central core glides across the stars.
- **Zero-Delay Line Switching**: Seamless instantaneous transitions between stanzas with stardust dissolution cross-fade.
- **Desktop Shortcut**: Toggle anytime with **`Super` + `M`**.

---

## Installation & Setup

### Prerequisites
Make sure you have Python 3, PyGObject, and WebKit2 installed (standard on Debian/Ubuntu GNOME):
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-gi gir1.2-webkit2-4.1 playerctl
pip install requests pyyaml Pillow --break-system-packages
```

### Setup Desktop Shortcut (`Super + M`)
Run the setup script once:
```bash
bash setup_shortcut.sh
```

---

## How to Run

1. **Press Shortcut**:
   Play any track in YouTube Music / Spotify, then press:
   ```
   Super + M
   ```

2. **Or Run via Terminal**:
   ```bash
   ./launcher/constellation
   ```

3. **Or Open in Any Browser**:
   ```bash
   xdg-open http://127.0.0.1:9876
   ```

---

## Keyboard & Mouse Controls
- **Space**: Play / Pause
- **Right Arrow**: Next track
- **Left Arrow**: Previous track
- **-0.2s / +0.2s Buttons**: Adjust lyric sync offset
- **F11**: Toggle Fullscreen
- **Esc** or **Q**: Exit visualizer
- **Mouse Movement**: Displays the glassmorphism media control bar and scrubber track

---

## Architecture
- **Backend (`backend/app.py`, `mpris.py`, `lyrics.py`)**:
  - Threaded Python HTTP + Server-Sent Events (SSE) server on port `9876`.
  - MPRIS monitor prioritizing rich metadata.
  - LRCLIB client with studio `lyricsfile` YAML word-sync parsing and syllable-weighted rap flow pacing.
  - Server-side color extraction using Pillow.
  - Artwork caching and proxying via `/api/art`.
- **Frontend (`frontend/index.html`, `js/`, `css/`)**:
  - Hardware-accelerated HTML5 dual-canvas engine (ambient backdrop + interactive constellation).
  - Responsive celestial layout generator with anti-crowding relaxation physics.
  - Pure WebKit / browser compatible without heavy frameworks.
- **Native Wrapper (`launcher/window.py`)**:
  - Lightweight borderless fullscreen GTK3 + WebKit2 window with cache busting.

---

## License
MIT License. Created with love for music lovers and stargazers.
