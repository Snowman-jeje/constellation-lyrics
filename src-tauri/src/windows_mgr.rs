use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::models::AppSettings;
use crate::settings::SettingsStore;

pub const VALID_WINDOWS: [&str; 6] = ["main", "island", "clock", "turntable", "glow", "lock"];

pub fn is_valid_window_label(label: &str) -> bool {
    VALID_WINDOWS.contains(&label)
}

pub fn any_window_visible(app: &AppHandle) -> bool {
    for label in VALID_WINDOWS {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_visible().unwrap_or(false) {
                return true;
            }
        }
    }
    false
}

pub fn is_hardware_consumer_visible(app: &AppHandle, settings: &AppSettings) -> bool {
    if !settings.island.enabled || settings.island.mode != "hardware" {
        return false;
    }
    if let Some(win) = app.get_webview_window("island") {
        return win.is_visible().unwrap_or(false);
    }
    false
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn toggle_overlay_window(
    app: &AppHandle,
    label: &str,
    force_visible: Option<bool>,
    settings: &AppSettings,
) -> Result<bool, String> {
    if !is_valid_window_label(label) {
        return Err(format!("Invalid window label: {label}"));
    }

    if label == "main" {
        let Some(win) = app.get_webview_window("main") else {
            return Err("Main window missing".to_string());
        };
        let currently_vis = win.is_visible().unwrap_or(false);
        let next = force_visible.unwrap_or(!currently_vis);
        if next {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let _ = win.hide();
        }
        return Ok(next);
    }

    if let Some(win) = app.get_webview_window(label) {
        let currently_vis = win.is_visible().unwrap_or(false);
        let next = force_visible.unwrap_or(!currently_vis);
        if next {
            position_overlay_window(&win, label, settings)?;
            let _ = win.show();
            let _ = win.set_always_on_top(true);
            if label == "glow" {
                let _ = win.set_ignore_cursor_events(true);
            }
        } else {
            let _ = win.hide();
        }
        return Ok(next);
    }

    if force_visible == Some(false) {
        return Ok(false);
    }

    let win = create_overlay_window(app, label, settings)?;
    let _ = win.show();
    if label == "glow" {
        let _ = win.set_ignore_cursor_events(true);
    }
    Ok(true)
}

pub fn sync_overlays_with_settings(app: &AppHandle, settings: &AppSettings) {
    let _ = toggle_overlay_window(app, "island", Some(settings.island.enabled), settings);
    let _ = toggle_overlay_window(app, "clock", Some(settings.desktop.clock_enabled), settings);
    let _ = toggle_overlay_window(
        app,
        "turntable",
        Some(settings.desktop.turntable_enabled),
        settings,
    );
    let _ = toggle_overlay_window(app, "glow", Some(settings.glow.overlay_window), settings);
}

fn create_overlay_window(
    app: &AppHandle,
    label: &str,
    settings: &AppSettings,
) -> Result<WebviewWindow, String> {
    let url = format!("index.html?window={label}");
    let title = format!("Constellation - {label}");

    let (w, h, x, y) = compute_overlay_geometry(app, label, settings);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(w, h)
        .position(x, y)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(label == "lock");

    let win = builder.build().map_err(|e| format!("Failed creating window {label}: {e}"))?;
    let _ = position_overlay_window(&win, label, settings);
    Ok(win)
}

pub fn position_overlay_window(
    win: &WebviewWindow,
    label: &str,
    settings: &AppSettings,
) -> Result<(), String> {
    let mon = match win.current_monitor().map_err(|e| e.to_string())? {
        Some(m) => m,
        None => win
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Monitor unavailable".to_string())?,
    };
    let scale_factor = mon.scale_factor();
    let mon_x = mon.position().x;
    let mon_y = mon.position().y;
    let mon_w = mon.size().width as f64;
    let mon_h = mon.size().height as f64;

    let (pw, ph, px, py) = match label {
        "island" => {
            let (lw, lh) = island_logical_size(&settings.island.mode, settings.island.scale);
            let pw = (lw * scale_factor).round() as i32;
            let ph = (lh * scale_factor).round() as i32;
            let px = mon_x + ((mon_w - pw as f64) / 2.0).round() as i32;
            let py = mon_y;
            (pw, ph, px, py)
        }
        "clock" => {
            let s = settings.desktop.clock_size.clamp(0.5, 2.2);
            let pw = (360.0 * s * scale_factor).round() as i32;
            let ph = (180.0 * s * scale_factor).round() as i32;
            let px = mon_x + (settings.desktop.clock_x * scale_factor).round() as i32;
            let py = mon_y + (settings.desktop.clock_y * scale_factor).round() as i32;
            (pw, ph, px, py)
        }
        "turntable" => {
            let s = settings.desktop.turntable_size.clamp(0.5, 2.0);
            let pw = (340.0 * s * scale_factor).round() as i32;
            let ph = (340.0 * s * scale_factor).round() as i32;
            let margin = (36.0 * scale_factor).round() as i32;
            let px = mon_x + (mon_w as i32 - pw - margin).max(0);
            let py = mon_y + (mon_h as i32 - ph - margin - 48).max(0);
            (pw, ph, px, py)
        }
        "glow" | "lock" => (mon_w as i32, mon_h as i32, mon_x, mon_y),
        _ => return Ok(()),
    };

    #[cfg(target_os = "windows")]
    if label == "island" {
        if let Ok(hwnd) = win.hwnd() {
            crate::platform_win::apply_dwm_borderless(hwnd.0 as isize);
        }
    }

    win.set_size(PhysicalSize::new(pw.max(1) as u32, ph.max(1) as u32))
        .map_err(|e| e.to_string())?;
    win.set_position(PhysicalPosition::new(px, py))
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_island_bounds(app: &AppHandle, mode: &str, scale: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window("island") else {
        return Ok(());
    };
    let mut settings = app.state::<SettingsStore>().get_settings();
    settings.island.mode = mode.to_string();
    settings.island.scale = scale.clamp(0.6, 1.8);
    position_overlay_window(&win, "island", &settings)
}

fn island_logical_size(mode: &str, scale: f64) -> (f64, f64) {
    let s = scale.clamp(0.6, 1.8);
    let (w, h) = match mode {
        "closed" => (184.0, 34.0),
        "peek" => (320.0, 56.0),
        "player" => (440.0, 74.0),
        "hud" => (330.0, 64.0),
        "big" | "weather" | "timer" | "notes" | "tasks" | "hardware" => (490.0, 320.0),
        _ => (320.0, 56.0),
    };
    (w * s, h * s)
}

fn compute_overlay_geometry(
    app: &AppHandle,
    label: &str,
    settings: &AppSettings,
) -> (f64, f64, f64, f64) {
    let (mon_w, mon_h) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let sf = m.scale_factor().max(1.0);
            (m.size().width as f64 / sf, m.size().height as f64 / sf)
        })
        .unwrap_or((1280.0, 800.0));

    match label {
        "island" => {
            let (w, h) = island_logical_size(&settings.island.mode, settings.island.scale);
            (w, h, ((mon_w - w) / 2.0).max(0.0), 0.0)
        }
        "clock" => {
            let s = settings.desktop.clock_size.clamp(0.5, 2.2);
            (360.0 * s, 180.0 * s, settings.desktop.clock_x, settings.desktop.clock_y)
        }
        "turntable" => {
            let s = settings.desktop.turntable_size.clamp(0.5, 2.0);
            let size = 340.0 * s;
            (size, size, (mon_w - size - 36.0).max(0.0), (mon_h - size - 84.0).max(0.0))
        }
        "glow" | "lock" => (mon_w, mon_h, 0.0, 0.0),
        _ => (400.0, 300.0, 80.0, 80.0),
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_vis = MenuItem::with_id(app, "show_visualizer", "Show Visualizer", true, None::<&str>)?;
    let dyn_island = MenuItem::with_id(app, "toggle_island", "Dynamic Island", true, None::<&str>)?;
    let lock_amb = MenuItem::with_id(app, "toggle_lock", "Lock Ambient", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_vis, &dyn_island, &lock_amb, &quit_i])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Constellation Suite");

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_visualizer" => {
                show_main_window(app);
            }
            "toggle_island" => {
                let app_h = app.clone();
                tauri::async_runtime::spawn(async move {
                    let store = app_h.state::<SettingsStore>();
                    let mut current = store.get_settings();
                    let next_state = !current.island.enabled;
                    current.island.enabled = next_state;
                    if let Ok(saved) = store.save_settings(&app_h, current.clone()) {
                        let _ = toggle_overlay_window(&app_h, "island", Some(next_state), &saved);
                        let _ = app_h.emit("settings-synced", &saved);
                    }
                });
            }
            "toggle_lock" => {
                let app_h = app.clone();
                tauri::async_runtime::spawn(async move {
                    let settings = app_h.state::<SettingsStore>().get_settings();
                    let _ = toggle_overlay_window(&app_h, "lock", None, &settings);
                });
            }
            "quit" => {
                crate::perform_shutdown_cleanup(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
