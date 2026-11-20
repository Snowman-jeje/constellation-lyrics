#[cfg(target_os = "linux")]
use std::sync::Mutex;

#[cfg(target_os = "linux")]
use tauri::AppHandle;
#[cfg(target_os = "linux")]
use zbus::blocking::Connection;

#[cfg(target_os = "linux")]
use crate::models::{ColorPalette, PlatformCapabilities};

#[cfg(target_os = "linux")]
pub struct PlatformController {
    inhibit_cookie: Mutex<Option<u32>>,
}

#[cfg(target_os = "linux")]
impl PlatformController {
    pub fn new(_app: AppHandle) -> Self {
        Self {
            inhibit_cookie: Mutex::new(None),
        }
    }

    pub fn capabilities(&self) -> PlatformCapabilities {
        let has_mixer = command_exists("pactl") || command_exists("wpctl");
        PlatformCapabilities {
            os: "linux".to_string(),
            supports_taskbar_styling: false,
            supports_volume_osd_hide: false,
            supports_per_app_mixer: has_mixer,
            supports_global_key_hook: false,
        }
    }

    pub fn set_keep_screen_on(&self, enabled: bool) {
        let Ok(mut guard) = self.inhibit_cookie.lock() else {
            return;
        };
        if enabled && guard.is_none() {
            let cookie_slot = &self.inhibit_cookie;
            // Perform D-Bus blocking call off any async worker if invoked on a Tokio runtime
            let res = std::thread::spawn(move || -> Option<u32> {
                let conn = Connection::session().ok()?;
                let reply = conn
                    .call_method(
                        Some("org.freedesktop.ScreenSaver"),
                        "/org/freedesktop/ScreenSaver",
                        Some("org.freedesktop.ScreenSaver"),
                        "Inhibit",
                        &("Constellation Suite", "Lyrics display active"),
                    )
                    .ok()?;
                reply.body().deserialize::<u32>().ok()
            })
            .join()
            .ok()
            .flatten();
            if let Some(cookie) = res {
                *guard = Some(cookie);
            }
            let _ = cookie_slot;
        } else if !enabled {
            if let Some(cookie) = guard.take() {
                std::thread::spawn(move || {
                    if let Ok(conn) = Connection::session() {
                        let _ = conn.call_method(
                            Some("org.freedesktop.ScreenSaver"),
                            "/org/freedesktop/ScreenSaver",
                            Some("org.freedesktop.ScreenSaver"),
                            "UnInhibit",
                            &(cookie,),
                        );
                    }
                });
            }
        }
    }

    pub fn set_taskbar_mode(&self, _mode: &str, _palette: ColorPalette, _beat: f32) {}

    pub fn update_taskbar_reactive(&self, _palette: ColorPalette, _beat: f32) {}

    pub fn restore_taskbar(&self) {}

    pub fn set_hide_system_volume(&self, _hide: bool) {}

    pub fn set_key_hook_enabled(&self, _enabled: bool) {}

    pub fn cleanup(&self) {
        self.set_keep_screen_on(false);
    }
}

#[cfg(target_os = "linux")]
impl Drop for PlatformController {
    fn drop(&mut self) {
        self.cleanup();
    }
}

#[cfg(target_os = "linux")]
fn command_exists(bin: &str) -> bool {
    std::process::Command::new("which")
        .arg(bin)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
pub fn is_fullscreen_app() -> bool {
    false
}

#[cfg(target_os = "linux")]
pub fn trim_working_set() {}
