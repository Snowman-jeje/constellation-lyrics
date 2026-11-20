export type LyricsStyle = 'stars' | 'lines' | 'bigWords' | 'lens' | 'terminal';
export type LyricsBackdrop = 'black' | 'white' | 'cover' | 'aura' | 'live';
export type LyricsMotion = 'words' | 'backdrop' | 'standing';

export type LiveSceneKind =
  | 'aurora'
  | 'orb'
  | 'sea'
  | 'dream'
  | 'fall'
  | 'silk'
  | 'shoal'
  | 'veil'
  | 'lane'
  | 'tide'
  | 'city'
  | 'wall';

export type GlowStyle = 'rim' | 'edges' | 'corners' | 'sides';
export type GlowMotion = 'music' | 'steady';

export type IslandMode =
  | 'closed'
  | 'peek'
  | 'player'
  | 'big'
  | 'hud'
  | 'weather'
  | 'timer'
  | 'notes'
  | 'tasks'
  | 'hardware';

export type IslandGlassLook = 'bottomFloor' | 'lensBuild' | 'rimFrost';
export type ClockFaceKind = 'atelier' | 'roman' | 'minimal' | 'mono';
export type WallpaperWeatherKind = 'none' | 'rain' | 'snow' | 'mist' | 'stars';
export type LockModeKind = 'normal' | 'enlarged' | 'lyrics';
export type LockBackdropKind = 'cover' | 'picture' | 'live';
export type KeyProfileKind = 'tactile' | 'office' | 'thocky' | 'typewriter';
export type TaskbarModeKind = 'normal' | 'opaque' | 'clear' | 'blur' | 'acrylic' | 'album' | 'beat';
export type PerformanceModeKind = 'high' | 'balanced' | 'eco';
export type WindowRouteKind = 'main' | 'island' | 'clock' | 'turntable' | 'glow' | 'lock';

export interface LyricsSettings {
  style: LyricsStyle;
  backdrop: LyricsBackdrop;
  motion: LyricsMotion;
  scatter: boolean;
  tilt: boolean;
  bulge: boolean;
  coverInWords: boolean;
  keepScreenOn: boolean;
  openOnLock: boolean;
  fontScale: number;
}

export interface LiveSettings {
  scene: LiveSceneKind;
  reaction: number;
  speed: number;
}

export interface GlowSettings {
  enabled: boolean;
  style: GlowStyle;
  motion: GlowMotion;
  thickness: number;
  brightness: number;
  ownColors: boolean;
  colorFirst: string;
  colorSecond: string;
  onLock: boolean;
  overlayWindow: boolean;
}

export interface IslandSettings {
  enabled: boolean;
  mode: IslandMode;
  bigVinyl: boolean;
  look: IslandGlassLook;
  scale: number;
  hideInFullscreen: boolean;
  weatherCity: string;
  showLevels: boolean;
  showCharging: boolean;
  showHeadphones: boolean;
  focusMode: boolean;
  timerMinutes: number;
  timerDuckAudio: boolean;
}

export interface DesktopSettings {
  clockEnabled: boolean;
  clockShowDate: boolean;
  clockFace: ClockFaceKind;
  clockSize: number;
  clockGlow: boolean;
  clockTransparent: boolean;
  clockColor: string;
  clockX: number;
  clockY: number;
  turntableEnabled: boolean;
  turntableSize: number;
  turntableOpacity: number;
  wallpaperParallax: boolean;
  wallpaperParallaxAmount: number;
  wallpaperWeather: WallpaperWeatherKind;
}

export interface LockSettings {
  mode: LockModeKind;
  backdrop: LockBackdropKind;
  clockGlass: boolean;
  clockSize: number;
  blur: number;
  showRecord: boolean;
  idleMinutes: number;
}

export interface UtilitySettings {
  keySounds: boolean;
  keyProfile: KeyProfileKind;
  keyVolume: number;
  keyRelease: boolean;
  buddyEnabled: boolean;
  mirrorEnabled: boolean;
  taskbarMode: TaskbarModeKind;
  hideSystemVolume: boolean;
  performanceMode: PerformanceModeKind;
  autoUpdate: boolean;
}

export interface AppSettings {
  lyrics: LyricsSettings;
  live: LiveSettings;
  glow: GlowSettings;
  island: IslandSettings;
  desktop: DesktopSettings;
  lock: LockSettings;
  utilities: UtilitySettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  lyrics: {
    style: 'stars',
    backdrop: 'aura',
    motion: 'words',
    scatter: true,
    tilt: true,
    bulge: true,
    coverInWords: false,
    keepScreenOn: false,
    openOnLock: false,
    fontScale: 1.0,
  },
  live: {
    scene: 'aurora',
    reaction: 0.75,
    speed: 1.0,
  },
  glow: {
    enabled: true,
    style: 'rim',
    motion: 'music',
    thickness: 0.55,
    brightness: 0.75,
    ownColors: false,
    colorFirst: '#D6B98C',
    colorSecond: '#5C7B8E',
    onLock: true,
    overlayWindow: false,
  },
  island: {
    enabled: true,
    mode: 'peek',
    bigVinyl: true,
    look: 'lensBuild',
    scale: 1.0,
    hideInFullscreen: true,
    weatherCity: 'Denpasar',
    showLevels: true,
    showCharging: true,
    showHeadphones: true,
    focusMode: false,
    timerMinutes: 25,
    timerDuckAudio: true,
  },
  desktop: {
    clockEnabled: false,
    clockShowDate: true,
    clockFace: 'atelier',
    clockSize: 1.0,
    clockGlow: true,
    clockTransparent: false,
    clockColor: '#F4F2ED',
    clockX: 80,
    clockY: 80,
    turntableEnabled: false,
    turntableSize: 1.0,
    turntableOpacity: 0.94,
    wallpaperParallax: true,
    wallpaperParallaxAmount: 0.5,
    wallpaperWeather: 'none',
  },
  lock: {
    mode: 'lyrics',
    backdrop: 'live',
    clockGlass: true,
    clockSize: 1.0,
    blur: 0.5,
    showRecord: true,
    idleMinutes: 5,
  },
  utilities: {
    keySounds: false,
    keyProfile: 'tactile',
    keyVolume: 0.55,
    keyRelease: true,
    buddyEnabled: false,
    mirrorEnabled: false,
    taskbarMode: 'normal',
    hideSystemVolume: false,
    performanceMode: 'balanced',
    autoUpdate: true,
  },
};

export interface BeatFrame {
  beat: number;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
}

export interface HardwareSnapshot {
  cpu_pct: number;
  ram_used_gb: number;
  ram_total_gb: number;
  net_rx_kbps: number;
  net_tx_kbps: number;
  battery_pct: number | null;
  charging: boolean;
}

export interface AudioSessionItem {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  peak: number;
}

export interface PlatformCapabilities {
  os: 'windows' | 'linux' | 'macos' | string;
  supports_taskbar_styling: boolean;
  supports_volume_osd_hide: boolean;
  supports_per_app_mixer: boolean;
  supports_global_key_hook: boolean;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
}

export interface IslandNotesTasks {
  notes: string;
  tasks: TaskItem[];
}

export interface KeyPulseEvent {
  kind: 'letter' | 'space' | 'wide';
  down: boolean;
  wpm: number;
}

export interface SystemHudEvent {
  kind: 'volume' | 'brightness' | 'charging' | 'headphones';
  value: number;
  label: string;
}

export type BuddyMood = 'resting' | 'typing' | 'fast' | 'record' | 'celebrating';

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_notes: string;
  asset_name: string | null;
  asset_size: number;
  download_url: string | null;
  html_url: string;
}

export interface UpdateProgressEvent {
  stage: 'checking' | 'downloading' | 'verifying' | 'installing' | 'error' | string;
  progress: number;
  message: string;
}
