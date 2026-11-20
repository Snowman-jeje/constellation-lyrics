use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct WordTimestamp {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

impl Default for WordTimestamp {
    fn default() -> Self {
        Self {
            word: String::new(),
            start: 0.0,
            end: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LyricLine {
    pub line_index: usize,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub words: Vec<WordTimestamp>,
}

impl Default for LyricLine {
    fn default() -> Self {
        Self {
            line_index: 0,
            text: String::new(),
            start_time: 0.0,
            end_time: 0.0,
            words: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LyricsData {
    pub title: String,
    pub artist: String,
    pub has_synced: bool,
    pub has_word_sync: bool,
    pub source: String,
    pub plain: Option<String>,
    pub lines: Vec<LyricLine>,
}

impl Default for LyricsData {
    fn default() -> Self {
        Self {
            title: String::new(),
            artist: String::new(),
            has_synced: false,
            has_word_sync: false,
            source: "none".to_string(),
            plain: None,
            lines: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ColorPalette {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Default for ColorPalette {
    fn default() -> Self {
        Self {
            r: 214,
            g: 185,
            b: 140,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct TrackInfo {
    pub player: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art_url: String,
    pub art_data_url: Option<String>,
    pub has_art: bool,
    pub art_key: String,
    pub length: f64,
    pub status: String,
    pub position: f64,
    pub timestamp: f64,
    pub server_mono: f64,
}

impl Default for TrackInfo {
    fn default() -> Self {
        Self {
            player: "none".to_string(),
            title: "No Track Playing".to_string(),
            artist: "Play music in YouTube Music or Spotify".to_string(),
            album: String::new(),
            art_url: String::new(),
            art_data_url: None,
            has_art: false,
            art_key: String::new(),
            length: 0.0,
            status: "Stopped".to_string(),
            position: 0.0,
            timestamp: 0.0,
            server_mono: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct StreamPayload {
    pub track: TrackInfo,
    pub lyrics: Option<LyricsData>,
    pub lyrics_loading: bool,
    pub palette: ColorPalette,
    pub track_offset: f64,
    pub server_mono: f64,
}

impl Default for StreamPayload {
    fn default() -> Self {
        Self {
            track: TrackInfo::default(),
            lyrics: None,
            lyrics_loading: false,
            palette: ColorPalette::default(),
            track_offset: 0.0,
            server_mono: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LyricsSettings {
    pub style: String,
    pub backdrop: String,
    pub motion: String,
    pub scatter: bool,
    pub tilt: bool,
    pub bulge: bool,
    pub cover_in_words: bool,
    pub keep_screen_on: bool,
    pub open_on_lock: bool,
    pub font_scale: f64,
}

impl Default for LyricsSettings {
    fn default() -> Self {
        Self {
            style: "stars".to_string(),
            backdrop: "aura".to_string(),
            motion: "words".to_string(),
            scatter: true,
            tilt: true,
            bulge: true,
            cover_in_words: false,
            keep_screen_on: false,
            open_on_lock: false,
            font_scale: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveSettings {
    pub scene: String,
    pub reaction: f64,
    pub speed: f64,
}

impl Default for LiveSettings {
    fn default() -> Self {
        Self {
            scene: "aurora".to_string(),
            reaction: 0.75,
            speed: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GlowSettings {
    pub enabled: bool,
    pub style: String,
    pub motion: String,
    pub thickness: f64,
    pub brightness: f64,
    pub own_colors: bool,
    pub color_first: String,
    pub color_second: String,
    pub on_lock: bool,
    pub overlay_window: bool,
}

impl Default for GlowSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            style: "rim".to_string(),
            motion: "music".to_string(),
            thickness: 0.55,
            brightness: 0.75,
            own_colors: false,
            color_first: "#D6B98C".to_string(),
            color_second: "#5C7B8E".to_string(),
            on_lock: true,
            overlay_window: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {
    pub enabled: bool,
    pub mode: String,
    pub big_vinyl: bool,
    pub look: String,
    pub scale: f64,
    pub hide_in_fullscreen: bool,
    pub weather_city: String,
    pub show_levels: bool,
    pub show_charging: bool,
    pub show_headphones: bool,
    pub focus_mode: bool,
    pub timer_minutes: u32,
    pub timer_duck_audio: bool,
}

impl Default for IslandSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: "peek".to_string(),
            big_vinyl: true,
            look: "lensBuild".to_string(),
            scale: 1.0,
            hide_in_fullscreen: true,
            weather_city: "Denpasar".to_string(),
            show_levels: true,
            show_charging: true,
            show_headphones: true,
            focus_mode: false,
            timer_minutes: 25,
            timer_duck_audio: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub clock_enabled: bool,
    pub clock_show_date: bool,
    pub clock_face: String,
    pub clock_size: f64,
    pub clock_glow: bool,
    pub clock_transparent: bool,
    pub clock_color: String,
    pub clock_x: f64,
    pub clock_y: f64,
    pub turntable_enabled: bool,
    pub turntable_size: f64,
    pub turntable_opacity: f64,
    pub wallpaper_parallax: bool,
    pub wallpaper_parallax_amount: f64,
    pub wallpaper_weather: String,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            clock_enabled: false,
            clock_show_date: true,
            clock_face: "atelier".to_string(),
            clock_size: 1.0,
            clock_glow: true,
            clock_transparent: false,
            clock_color: "#F4F2ED".to_string(),
            clock_x: 80.0,
            clock_y: 80.0,
            turntable_enabled: false,
            turntable_size: 1.0,
            turntable_opacity: 0.94,
            wallpaper_parallax: true,
            wallpaper_parallax_amount: 0.5,
            wallpaper_weather: "none".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LockSettings {
    pub mode: String,
    pub backdrop: String,
    pub clock_glass: bool,
    pub clock_size: f64,
    pub blur: f64,
    pub show_record: bool,
    pub idle_minutes: u32,
}

impl Default for LockSettings {
    fn default() -> Self {
        Self {
            mode: "lyrics".to_string(),
            backdrop: "live".to_string(),
            clock_glass: true,
            clock_size: 1.0,
            blur: 0.5,
            show_record: true,
            idle_minutes: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UtilitySettings {
    pub key_sounds: bool,
    pub key_profile: String,
    pub key_volume: f64,
    pub key_release: bool,
    pub buddy_enabled: bool,
    pub mirror_enabled: bool,
    pub taskbar_mode: String,
    pub hide_system_volume: bool,
    pub performance_mode: String,
    pub auto_update: bool,
}

impl Default for UtilitySettings {
    fn default() -> Self {
        Self {
            key_sounds: false,
            key_profile: "tactile".to_string(),
            key_volume: 0.55,
            key_release: true,
            buddy_enabled: false,
            mirror_enabled: false,
            taskbar_mode: "normal".to_string(),
            hide_system_volume: false,
            performance_mode: "balanced".to_string(),
            auto_update: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub lyrics: LyricsSettings,
    pub live: LiveSettings,
    pub glow: GlowSettings,
    pub island: IslandSettings,
    pub desktop: DesktopSettings,
    pub lock: LockSettings,
    pub utilities: UtilitySettings,
}

fn clamp_finite(val: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if val.is_finite() {
        val.clamp(min, max)
    } else {
        fallback
    }
}

fn allow_or_default(val: &str, allowed: &[&str], fallback: &str) -> String {
    if allowed.contains(&val) {
        val.to_string()
    } else {
        fallback.to_string()
    }
}

fn sanitize_hex(val: &str, fallback: &str) -> String {
    let trimmed = val.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        trimmed.to_uppercase()
    } else {
        fallback.to_string()
    }
}

impl AppSettings {
    pub fn sanitized(mut self) -> Self {
        let migrated_style = if self.lyrics.style == "terminal" {
            "depth3d"
        } else {
            &self.lyrics.style
        };
        self.lyrics.style = allow_or_default(
            migrated_style,
            &["stars", "lines", "bigWords", "lens", "depth3d"],
            "stars",
        );
        self.lyrics.backdrop = allow_or_default(
            &self.lyrics.backdrop,
            &["black", "white", "cover", "aura", "live"],
            "aura",
        );
        self.lyrics.motion = allow_or_default(
            &self.lyrics.motion,
            &["words", "backdrop", "standing"],
            "words",
        );
        self.lyrics.font_scale = clamp_finite(self.lyrics.font_scale, 0.6, 2.0, 1.0);

        self.live.scene = allow_or_default(
            &self.live.scene,
            &[
                "aurora", "orb", "sea", "dream", "fall", "silk", "shoal", "veil", "lane", "tide",
                "city", "wall",
            ],
            "aurora",
        );
        self.live.reaction = clamp_finite(self.live.reaction, 0.0, 1.5, 0.75);
        self.live.speed = clamp_finite(self.live.speed, 0.2, 3.0, 1.0);

        self.glow.style = allow_or_default(
            &self.glow.style,
            &["rim", "edges", "corners", "sides"],
            "rim",
        );
        self.glow.motion = allow_or_default(&self.glow.motion, &["music", "steady"], "music");
        self.glow.thickness = clamp_finite(self.glow.thickness, 0.1, 1.0, 0.55);
        self.glow.brightness = clamp_finite(self.glow.brightness, 0.0, 1.5, 0.75);
        self.glow.color_first = sanitize_hex(&self.glow.color_first, "#D6B98C");
        self.glow.color_second = sanitize_hex(&self.glow.color_second, "#5C7B8E");

        self.island.mode = allow_or_default(
            &self.island.mode,
            &[
                "closed", "peek", "player", "big", "hud", "weather", "timer", "notes", "tasks",
                "hardware",
            ],
            "peek",
        );
        self.island.look = allow_or_default(
            &self.island.look,
            &["bottomFloor", "lensBuild", "rimFrost"],
            "lensBuild",
        );
        self.island.scale = clamp_finite(self.island.scale, 0.6, 1.8, 1.0);
        self.island.weather_city = self
            .island
            .weather_city
            .chars()
            .filter(|c| !c.is_control())
            .take(80)
            .collect::<String>()
            .trim()
            .to_string();
        if self.island.weather_city.is_empty() {
            self.island.weather_city = "Denpasar".to_string();
        }
        self.island.timer_minutes = self.island.timer_minutes.clamp(1, 180);

        self.desktop.clock_face = allow_or_default(
            &self.desktop.clock_face,
            &["atelier", "roman", "minimal", "mono"],
            "atelier",
        );
        self.desktop.clock_size = clamp_finite(self.desktop.clock_size, 0.5, 2.2, 1.0);
        self.desktop.clock_color = sanitize_hex(&self.desktop.clock_color, "#F4F2ED");
        self.desktop.clock_x = clamp_finite(self.desktop.clock_x, -2000.0, 8000.0, 80.0);
        self.desktop.clock_y = clamp_finite(self.desktop.clock_y, -2000.0, 8000.0, 80.0);
        self.desktop.turntable_size = clamp_finite(self.desktop.turntable_size, 0.5, 2.0, 1.0);
        self.desktop.turntable_opacity =
            clamp_finite(self.desktop.turntable_opacity, 0.1, 1.0, 0.94);
        self.desktop.wallpaper_parallax_amount =
            clamp_finite(self.desktop.wallpaper_parallax_amount, 0.0, 1.0, 0.5);
        self.desktop.wallpaper_weather = allow_or_default(
            &self.desktop.wallpaper_weather,
            &["none", "rain", "snow", "mist", "stars"],
            "none",
        );

        self.lock.mode =
            allow_or_default(&self.lock.mode, &["normal", "enlarged", "lyrics"], "lyrics");
        self.lock.backdrop =
            allow_or_default(&self.lock.backdrop, &["cover", "picture", "live"], "live");
        self.lock.clock_size = clamp_finite(self.lock.clock_size, 0.5, 2.2, 1.0);
        self.lock.blur = clamp_finite(self.lock.blur, 0.0, 1.0, 0.5);
        self.lock.idle_minutes = self.lock.idle_minutes.clamp(0, 120);

        self.utilities.key_profile = allow_or_default(
            &self.utilities.key_profile,
            &["tactile", "office", "thocky", "typewriter"],
            "tactile",
        );
        self.utilities.key_volume = clamp_finite(self.utilities.key_volume, 0.0, 1.0, 0.55);
        self.utilities.taskbar_mode = allow_or_default(
            &self.utilities.taskbar_mode,
            &["normal", "opaque", "clear", "blur", "acrylic", "album", "beat"],
            "normal",
        );
        self.utilities.performance_mode = allow_or_default(
            &self.utilities.performance_mode,
            &["high", "balanced", "eco"],
            "balanced",
        );

        self
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct BeatFrame {
    pub beat: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub energy: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct HardwareSnapshot {
    pub cpu_pct: f32,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub net_rx_kbps: f64,
    pub net_tx_kbps: f64,
    pub battery_pct: Option<u8>,
    pub charging: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AudioSessionItem {
    pub id: String,
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub peak: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PlatformCapabilities {
    pub os: String,
    pub supports_taskbar_styling: bool,
    pub supports_volume_osd_hide: bool,
    pub supports_per_app_mixer: bool,
    pub supports_global_key_hook: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct TaskItem {
    pub id: String,
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct IslandNotesTasks {
    pub notes: String,
    pub tasks: Vec<TaskItem>,
}

impl IslandNotesTasks {
    pub fn sanitized(mut self) -> Self {
        self.notes = self
            .notes
            .replace('\0', "")
            .chars()
            .take(32_768)
            .collect();
        self.tasks.truncate(200);
        for (idx, item) in self.tasks.iter_mut().enumerate() {
            let clean_id: String = item
                .id
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .take(64)
                .collect();
            item.id = if clean_id.is_empty() {
                format!("task-{idx}")
            } else {
                clean_id
            };
            item.text = item
                .text
                .replace('\0', "")
                .chars()
                .take(500)
                .collect::<String>()
                .trim()
                .to_string();
        }
        self.tasks.retain(|t| !t.text.is_empty());
        self
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct KeyPulseEvent {
    pub kind: String,
    pub down: bool,
    pub wpm: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct SystemHudEvent {
    pub kind: String,
    pub value: f32,
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct SystemHudState {
    pub volume: u32,
    pub muted: bool,
    pub battery_pct: u8,
    pub is_charging: bool,
    pub has_battery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: String,
    pub asset_name: Option<String>,
    pub asset_size: u64,
    pub download_url: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub progress: u8,
    pub message: String,
}
