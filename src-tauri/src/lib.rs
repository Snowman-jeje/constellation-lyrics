mod audio_beat;
mod audio_mixer;
mod cover;
mod hardware;
mod lyrics;
mod media;
mod models;
#[cfg(target_os = "linux")]
mod platform_linux;
#[cfg(target_os = "windows")]
mod platform_win;
mod settings;
mod updater;
mod windows_mgr;

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent};
use tokio::sync::Mutex;

use audio_beat::AudioBeatEngine;
use audio_mixer::AudioMixerManager;
use cover::CoverResolver;
use hardware::HardwareMonitor;
use lyrics::LyricsFetcher;
use media::{MediaMonitor, MediaSnapshot};
use models::{
    AppSettings, AudioSessionItem, BeatFrame, ColorPalette, HardwareSnapshot, IslandNotesTasks,
    LyricsData, PlatformCapabilities, StreamPayload, SystemHudEvent, SystemHudState, TrackInfo,
    UpdateCheckResult,
};
#[cfg(target_os = "linux")]
use platform_linux as platform;
#[cfg(target_os = "windows")]
use platform_win as platform;
use settings::SettingsStore;

struct MediaRuntimeCache {
    current_track_key: String,
    cached_lyrics: Option<LyricsData>,
    lyrics_loading: bool,
    current_art_sig: String,
    current_art_key: String,
    cached_art_data_url: Option<String>,
    cached_palette: ColorPalette,
    last_snapshot: Option<MediaSnapshot>,
    monotonic_origin: Instant,
}

impl MediaRuntimeCache {
    fn new() -> Self {
        Self {
            current_track_key: String::new(),
            cached_lyrics: None,
            lyrics_loading: false,
            current_art_sig: String::new(),
            current_art_key: String::new(),
            cached_art_data_url: None,
            cached_palette: ColorPalette::default(),
            last_snapshot: None,
            monotonic_origin: Instant::now(),
        }
    }
}

pub struct SuiteState {
    media: Arc<MediaMonitor>,
    cover: Arc<CoverResolver>,
    lyrics: Arc<LyricsFetcher>,
    beat: Arc<AudioBeatEngine>,
    mixer: Arc<AudioMixerManager>,
    hardware: Arc<HardwareMonitor>,
    platform: Arc<platform::PlatformController>,
    runtime: Arc<Mutex<MediaRuntimeCache>>,
}

impl SuiteState {
    async fn build_stream_payload(&self, settings_store: &SettingsStore) -> StreamPayload {
        let guard = self.runtime.lock().await;
        let mono = guard.monotonic_origin.elapsed().as_secs_f64();

        let track = if let Some(ref snap) = guard.last_snapshot {
            TrackInfo {
                player: snap.player.clone(),
                title: snap.title.clone(),
                artist: snap.artist.clone(),
                album: snap.album.clone(),
                art_url: if guard.cached_art_data_url.is_some() {
                    String::new()
                } else if snap.art_url.starts_with("https://") {
                    snap.art_url.clone()
                } else {
                    String::new()
                },
                art_data_url: guard.cached_art_data_url.clone(),
                has_art: guard.cached_art_data_url.is_some(),
                art_key: guard.current_art_key.clone(),
                length: snap.length,
                status: snap.status.clone(),
                position: snap.position,
                timestamp: snap.timestamp,
                server_mono: mono,
            }
        } else {
            TrackInfo {
                server_mono: mono,
                ..TrackInfo::default()
            }
        };

        let offset = if guard.current_track_key.is_empty() {
            0.0
        } else {
            settings_store.get_offset(&guard.current_track_key)
        };

        StreamPayload {
            track,
            lyrics: guard.cached_lyrics.clone(),
            lyrics_loading: guard.lyrics_loading,
            palette: guard.cached_palette,
            track_offset: offset,
            server_mono: mono,
        }
    }
}

pub fn perform_shutdown_cleanup(app: &AppHandle) {
    if let Some(state) = app.try_state::<SuiteState>() {
        state.beat.stop();
        state.mixer.restore_all();
        state.platform.cleanup();
    }
}

#[tauri::command]
async fn get_media_status(
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
) -> Result<StreamPayload, String> {
    Ok(state.build_stream_payload(&settings_store).await)
}

#[tauri::command]
async fn media_play_pause(state: State<'_, SuiteState>) -> Result<bool, String> {
    Ok(state.media.play_pause().await)
}

#[tauri::command]
async fn media_next(state: State<'_, SuiteState>) -> Result<bool, String> {
    Ok(state.media.next_track().await)
}

#[tauri::command]
async fn media_previous(state: State<'_, SuiteState>) -> Result<bool, String> {
    Ok(state.media.previous_track().await)
}

#[tauri::command]
async fn media_seek(state: State<'_, SuiteState>, position: f64) -> Result<bool, String> {
    if !position.is_finite() || position < 0.0 {
        return Err("Seek position must be a non-negative finite number".to_string());
    }
    Ok(state.media.seek(position).await)
}

#[tauri::command]
async fn set_track_offset(
    app: AppHandle,
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
    track_key: Option<String>,
    offset: f64,
) -> Result<f64, String> {
    let active_key = {
        let guard = state.runtime.lock().await;
        guard.current_track_key.clone()
    };
    let resolved_key = track_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .unwrap_or(active_key);
    let saved = settings_store.set_offset(&resolved_key, offset)?;
    let payload = state.build_stream_payload(&settings_store).await;
    let _ = app.emit("music-stream", &payload);
    Ok(saved)
}

#[tauri::command]
async fn refresh_lyrics(
    app: AppHandle,
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
) -> Result<(), String> {
    let (track_key, snap_opt) = {
        let mut guard = state.runtime.lock().await;
        if guard.current_track_key.is_empty() {
            return Ok(());
        }
        guard.lyrics_loading = true;
        (guard.current_track_key.clone(), guard.last_snapshot.clone())
    };

    if let Some(snap) = snap_opt {
        state
            .lyrics
            .invalidate_cache(&snap.title, &snap.artist, snap.length);
        let fetched = state
            .lyrics
            .fetch(&snap.title, &snap.artist, &snap.album, snap.length)
            .await;
        {
            let mut guard = state.runtime.lock().await;
            if guard.current_track_key == track_key {
                guard.cached_lyrics = Some(fetched);
                guard.lyrics_loading = false;
            }
        }
        let payload = state.build_stream_payload(&settings_store).await;
        let _ = app.emit("music-stream", &payload);
    }
    Ok(())
}

#[tauri::command]
fn get_settings(settings_store: State<'_, SettingsStore>) -> AppSettings {
    settings_store.get_settings()
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let saved = settings_store.save_settings(&app, settings)?;
    apply_settings_side_effects(&app, &state, &saved).await;
    Ok(saved)
}

async fn apply_settings_side_effects(
    app: &AppHandle,
    state: &SuiteState,
    settings: &AppSettings,
) {
    state
        .platform
        .set_keep_screen_on(settings.lyrics.keep_screen_on);
    state
        .platform
        .set_hide_system_volume(settings.utilities.hide_system_volume);
    state
        .platform
        .set_key_hook_enabled(settings.utilities.key_sounds || settings.utilities.buddy_enabled);

    let palette = state.runtime.lock().await.cached_palette;
    let beat = state.beat.current_frame().beat;
    state
        .platform
        .set_taskbar_mode(&settings.utilities.taskbar_mode, palette, beat);

    windows_mgr::sync_overlays_with_settings(app, settings);
}

#[tauri::command]
fn get_island_notes_tasks(settings_store: State<'_, SettingsStore>) -> IslandNotesTasks {
    settings_store.get_notes_tasks()
}

#[tauri::command]
fn save_island_notes_tasks(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    data: IslandNotesTasks,
) -> Result<IslandNotesTasks, String> {
    settings_store.save_notes_tasks(&app, data)
}

#[tauri::command]
async fn toggle_overlay_window(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    label: String,
    visible: Option<bool>,
) -> Result<bool, String> {
    let settings = settings_store.get_settings();
    windows_mgr::toggle_overlay_window(&app, label.trim(), visible, &settings)
}

#[tauri::command]
async fn open_overlay_window(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    label: String,
) -> Result<(), String> {
    let settings = settings_store.get_settings();
    windows_mgr::toggle_overlay_window(&app, label.trim(), Some(true), &settings)?;
    Ok(())
}

#[tauri::command]
async fn close_overlay_window(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    label: String,
) -> Result<(), String> {
    let settings = settings_store.get_settings();
    windows_mgr::toggle_overlay_window(&app, label.trim(), Some(false), &settings)?;
    Ok(())
}

#[tauri::command]
fn set_window_ignore_cursor(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_ignore_cursor_by_label(
    app: AppHandle,
    label: String,
    ignore: bool,
) -> Result<(), String> {
    let clean = label.trim();
    if !windows_mgr::is_valid_window_label(clean) {
        return Err(format!("Invalid window label: {clean}"));
    }
    if let Some(win) = app.get_webview_window(clean) {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_island_bounds(app: AppHandle, mode: String, scale: f64) -> Result<(), String> {
    let clean_mode = mode.trim();
    let allowed_modes = [
        "closed", "peek", "player", "big", "hud", "weather", "timer", "notes", "tasks", "hardware",
    ];
    if !allowed_modes.contains(&clean_mode) {
        return Err(format!("Invalid island mode: {clean_mode}"));
    }
    if !scale.is_finite() {
        return Err("Invalid island scale".to_string());
    }
    windows_mgr::set_island_bounds(&app, clean_mode, scale)
}

#[tauri::command]
fn set_main_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_fullscreen_app() -> bool {
    platform::is_fullscreen_app()
}

#[tauri::command]
fn get_audio_sessions(state: State<'_, SuiteState>) -> Vec<AudioSessionItem> {
    state.mixer.list_sessions()
}

#[tauri::command]
fn set_app_volume(
    state: State<'_, SuiteState>,
    session_id: String,
    volume: f32,
) -> Result<bool, String> {
    state.mixer.set_app_volume(&session_id, volume)
}

#[tauri::command]
fn set_app_mute(
    state: State<'_, SuiteState>,
    session_id: String,
    muted: bool,
) -> Result<bool, String> {
    state.mixer.set_app_mute(&session_id, muted)
}

#[tauri::command]
fn set_timer_ducking(state: State<'_, SuiteState>, active: bool) -> Result<(), String> {
    state.mixer.set_timer_ducking(active)
}

#[tauri::command]
fn get_system_hud_state(state: State<'_, SuiteState>) -> SystemHudState {
    state.mixer.get_system_hud_state()
}

#[tauri::command]
fn set_system_volume(state: State<'_, SuiteState>, level: u32) -> Result<bool, String> {
    state.mixer.set_system_volume(level)
}

#[tauri::command]
fn toggle_system_mute(state: State<'_, SuiteState>) -> bool {
    state.mixer.toggle_system_mute()
}

#[tauri::command]
fn get_hardware_snapshot(state: State<'_, SuiteState>) -> HardwareSnapshot {
    state.hardware.snapshot()
}

#[tauri::command]
fn get_platform_capabilities(state: State<'_, SuiteState>) -> PlatformCapabilities {
    state.platform.capabilities()
}

#[tauri::command]
async fn set_taskbar_mode(
    app: AppHandle,
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
    mode: String,
) -> Result<AppSettings, String> {
    let clean = mode.trim();
    let allowed = ["normal", "opaque", "clear", "blur", "acrylic", "album", "beat"];
    if !allowed.contains(&clean) {
        return Err(format!("Invalid taskbar mode: {clean}"));
    }
    let mut current = settings_store.get_settings();
    current.utilities.taskbar_mode = clean.to_string();
    let saved = settings_store.save_settings(&app, current)?;
    let palette = state.runtime.lock().await.cached_palette;
    let beat = state.beat.current_frame().beat;
    state.platform.set_taskbar_mode(clean, palette, beat);
    Ok(saved)
}

#[tauri::command]
async fn set_keep_screen_on(
    app: AppHandle,
    state: State<'_, SuiteState>,
    settings_store: State<'_, SettingsStore>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut current = settings_store.get_settings();
    current.lyrics.keep_screen_on = enabled;
    let saved = settings_store.save_settings(&app, current)?;
    state.platform.set_keep_screen_on(enabled);
    Ok(saved)
}

#[tauri::command]
fn get_beat_frame(state: State<'_, SuiteState>) -> BeatFrame {
    state.beat.current_frame()
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    updater::check_for_updates().await
}

#[tauri::command]
async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    updater::download_and_install_update(&app).await?;
    perform_shutdown_cleanup(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    perform_shutdown_cleanup(&app);
    app.exit(0);
}

fn spawn_background_loops(app: AppHandle) {
    let app_media = app.clone();
    tauri::async_runtime::spawn(async move {
        media_poller_loop(app_media).await;
    });

    let app_hw = app.clone();
    tauri::async_runtime::spawn(async move {
        hardware_and_hud_loop(app_hw).await;
    });

    let app_mem = app.clone();
    tauri::async_runtime::spawn(async move {
        memory_trim_loop(app_mem).await;
    });
}

async fn media_poller_loop(app: AppHandle) {
    let mut last_emitted_idle_key = String::new();

    loop {
        let state = app.state::<SuiteState>();
        let settings_store = app.state::<SettingsStore>();
        let settings = settings_store.get_settings();

        let snap_opt = state.media.get_snapshot().await;
        let is_playing = snap_opt
            .as_ref()
            .map(|s| s.status == "Playing")
            .unwrap_or(false);

        let visible_any = windows_mgr::any_window_visible(&app);
        let beat_allowed = settings.utilities.performance_mode != "eco"
            || settings.utilities.taskbar_mode == "beat";
        state.beat.set_active(is_playing && visible_any && beat_allowed);

        if let Some(snap) = snap_opt {
            let track_key = format!("{} - {}", snap.artist, snap.title);
            let art_sig = if !snap.art_url.is_empty() {
                snap.art_url.clone()
            } else if !snap.raw_art_bytes.is_empty() {
                let sample = &snap.raw_art_bytes[..snap.raw_art_bytes.len().min(256)];
                format!("{:x}_{}", md5::compute(sample), snap.raw_art_bytes.len())
            } else {
                format!("fallback::{track_key}")
            };

            let (track_changed, art_changed) = {
                let mut rt = state.runtime.lock().await;
                let tc = track_key != rt.current_track_key;
                let ac = art_sig != rt.current_art_sig;
                if tc {
                    rt.current_track_key = track_key.clone();
                    rt.cached_lyrics = None;
                    rt.lyrics_loading = true;
                }
                if ac {
                    rt.current_art_sig = art_sig.clone();
                }
                rt.last_snapshot = Some(snap.clone());
                (tc, ac)
            };

            if track_changed {
                let app_l = app.clone();
                let tk = track_key.clone();
                let snap_l = snap.clone();
                tauri::async_runtime::spawn(async move {
                    let st = app_l.state::<SuiteState>();
                    let ss = app_l.state::<SettingsStore>();
                    let fetched = st
                        .lyrics
                        .fetch(&snap_l.title, &snap_l.artist, &snap_l.album, snap_l.length)
                        .await;
                    {
                        let mut rt = st.runtime.lock().await;
                        if rt.current_track_key == tk {
                            rt.cached_lyrics = Some(fetched);
                            rt.lyrics_loading = false;
                        }
                    }
                    let payload = st.build_stream_payload(&ss).await;
                    let _ = app_l.emit("music-stream", &payload);
                });
            }

            if art_changed || track_changed {
                let app_c = app.clone();
                let tk = track_key.clone();
                let asig = art_sig.clone();
                let snap_c = snap.clone();
                tauri::async_runtime::spawn(async move {
                    let st = app_c.state::<SuiteState>();
                    let ss = app_c.state::<SettingsStore>();
                    let resolved = st
                        .cover
                        .resolve(
                            &snap_c.title,
                            &snap_c.artist,
                            &snap_c.album,
                            &snap_c.art_url,
                            &snap_c.raw_art_bytes,
                        )
                        .await;
                    {
                        let mut rt = st.runtime.lock().await;
                        if rt.current_track_key == tk || rt.current_art_sig == asig {
                            rt.cached_art_data_url = resolved.art_data_url;
                            rt.cached_palette = resolved.palette;
                            rt.current_art_key = resolved.art_key;
                        }
                    }
                    let payload = st.build_stream_payload(&ss).await;
                    let _ = app_c.emit("music-stream", &payload);

                    let curr_settings = ss.get_settings();
                    if curr_settings.utilities.taskbar_mode == "album"
                        || curr_settings.utilities.taskbar_mode == "beat"
                    {
                        st.platform.set_taskbar_mode(
                            &curr_settings.utilities.taskbar_mode,
                            resolved.palette,
                            st.beat.current_frame().beat,
                        );
                    }
                });
            }

            let idle_sig = format!("{track_key}::{}", snap.status);
            let state_changed = track_changed || art_changed || idle_sig != last_emitted_idle_key;
            if state_changed {
                last_emitted_idle_key = idle_sig;
                let payload = state.build_stream_payload(&settings_store).await;
                let _ = app.emit("music-stream", &payload);
            } else if is_playing {
                let mono = state.runtime.lock().await.monotonic_origin.elapsed().as_secs_f64();
                let _ = app.emit(
                    "position-sync",
                    serde_json::json!({
                        "position": snap.position,
                        "status": snap.status,
                        "timestamp": snap.timestamp,
                        "server_mono": mono,
                    }),
                );
            }

            if settings.utilities.taskbar_mode == "beat" && is_playing {
                let palette = state.runtime.lock().await.cached_palette;
                let beat = state.beat.current_frame().beat;
                state.platform.update_taskbar_reactive(palette, beat);
            }
        } else {
            let had_track = {
                let mut rt = state.runtime.lock().await;
                let prev = !rt.current_track_key.is_empty();
                if prev {
                    rt.current_track_key.clear();
                    rt.cached_lyrics = None;
                    rt.lyrics_loading = false;
                    rt.current_art_sig.clear();
                    rt.current_art_key.clear();
                    rt.cached_art_data_url = None;
                    rt.cached_palette = ColorPalette::default();
                    rt.last_snapshot = None;
                }
                prev
            };
            if had_track {
                last_emitted_idle_key.clear();
                let payload = state.build_stream_payload(&settings_store).await;
                let _ = app.emit("music-stream", &payload);
            }
        }

        let sleep_ms = match (settings.utilities.performance_mode.as_str(), is_playing) {
            ("high", true) => 80,
            ("balanced", true) => 100,
            ("eco", true) => 180,
            ("eco", false) => 750,
            (_, true) => 100,
            (_, false) => 400,
        };
        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
    }
}

async fn hardware_and_hud_loop(app: AppHandle) {
    let mut prev_hud: Option<SystemHudState> = None;

    loop {
        let state = app.state::<SuiteState>();
        let settings = app.state::<SettingsStore>().get_settings();
        let hw_visible = windows_mgr::is_hardware_consumer_visible(&app, &settings);

        if hw_visible {
            let hw = state.hardware.snapshot();
            let _ = app.emit("hardware-snapshot", &hw);
        }

        let hud_needed = settings.island.enabled
            && (settings.island.show_levels || settings.island.show_charging);
        if hud_needed {
            let mixer = Arc::clone(&state.mixer);
            if let Ok(hud) = tokio::task::spawn_blocking(move || mixer.get_system_hud_state()).await
            {
                if let Some(ref prev) = prev_hud {
                    if settings.island.show_levels
                        && (hud.volume != prev.volume || hud.muted != prev.muted)
                    {
                        let label = if hud.muted {
                            "Muted".to_string()
                        } else {
                            format!("{}%", hud.volume)
                        };
                        let _ = app.emit(
                            "system-hud-event",
                            SystemHudEvent {
                                kind: "volume".to_string(),
                                value: if hud.muted {
                                    0.0
                                } else {
                                    hud.volume as f32 / 100.0
                                },
                                label,
                            },
                        );
                    }
                    if settings.island.show_charging
                        && hud.has_battery
                        && hud.is_charging != prev.is_charging
                    {
                        let _ = app.emit(
                            "system-hud-event",
                            SystemHudEvent {
                                kind: "charging".to_string(),
                                value: hud.battery_pct as f32 / 100.0,
                                label: if hud.is_charging {
                                    format!("Charging {}%", hud.battery_pct)
                                } else {
                                    format!("Battery {}%", hud.battery_pct)
                                },
                            },
                        );
                    }
                }
                prev_hud = Some(hud);
            }
        } else {
            prev_hud = None;
        }

        let interval_ms = match (settings.utilities.performance_mode.as_str(), hw_visible) {
            ("high", true) => 1200,
            ("balanced", true) => 2000,
            ("eco", true) => 4000,
            (_, true) => 2000,
            (_, false) => 4000,
        };
        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }
}

async fn memory_trim_loop(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(90)).await;
        let state = app.state::<SuiteState>();
        let is_playing = state
            .runtime
            .lock()
            .await
            .last_snapshot
            .as_ref()
            .map(|s| s.status == "Playing")
            .unwrap_or(false);
        if !is_playing {
            platform::trim_working_set();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let settings_store = SettingsStore::init(&handle);
            let initial_settings = settings_store.get_settings();
            let cache_dir = settings_store.cache_dir().to_path_buf();

            let state = SuiteState {
                media: Arc::new(MediaMonitor::new()),
                cover: Arc::new(CoverResolver::new(&cache_dir)),
                lyrics: Arc::new(LyricsFetcher::new(&cache_dir)),
                beat: Arc::new(AudioBeatEngine::start(handle.clone())),
                mixer: Arc::new(AudioMixerManager::new()),
                hardware: Arc::new(HardwareMonitor::new()),
                platform: Arc::new(platform::PlatformController::new(handle.clone())),
                runtime: Arc::new(Mutex::new(MediaRuntimeCache::new())),
            };

            if initial_settings.lyrics.keep_screen_on {
                state.platform.set_keep_screen_on(true);
            }
            if initial_settings.utilities.hide_system_volume {
                state.platform.set_hide_system_volume(true);
            }
            if initial_settings.utilities.key_sounds || initial_settings.utilities.buddy_enabled {
                state.platform.set_key_hook_enabled(true);
            }
            if initial_settings.utilities.taskbar_mode != "normal" {
                state.platform.set_taskbar_mode(
                    &initial_settings.utilities.taskbar_mode,
                    ColorPalette::default(),
                    0.0,
                );
            }

            app.manage(settings_store);
            app.manage(state);

            windows_mgr::setup_tray(&handle)?;

            let app_for_overlays = handle.clone();
            tauri::async_runtime::spawn(async move {
                let init_cfg = app_for_overlays.state::<SettingsStore>().get_settings();
                windows_mgr::sync_overlays_with_settings(&app_for_overlays, &init_cfg);
            });

            spawn_background_loops(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_media_status,
            media_play_pause,
            media_next,
            media_previous,
            media_seek,
            set_track_offset,
            refresh_lyrics,
            get_settings,
            save_settings,
            get_island_notes_tasks,
            save_island_notes_tasks,
            toggle_overlay_window,
            open_overlay_window,
            close_overlay_window,
            set_window_ignore_cursor,
            set_window_ignore_cursor_by_label,
            set_island_bounds,
            set_main_fullscreen,
            is_fullscreen_app,
            get_audio_sessions,
            set_app_volume,
            set_app_mute,
            set_timer_ducking,
            get_system_hud_state,
            set_system_volume,
            toggle_system_mute,
            get_hardware_snapshot,
            get_platform_capabilities,
            set_taskbar_mode,
            set_keep_screen_on,
            get_beat_frame,
            check_for_updates,
            download_and_install_update,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Constellation Suite");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            perform_shutdown_cleanup(app_handle);
        }
    });
}
