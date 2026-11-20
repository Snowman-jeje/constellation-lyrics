use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{AppSettings, IslandNotesTasks};

#[derive(Debug)]
pub struct SettingsStore {
    config_dir: PathBuf,
    cache_dir: PathBuf,
    settings: RwLock<AppSettings>,
    offsets: RwLock<HashMap<String, f64>>,
    notes_tasks: RwLock<IslandNotesTasks>,
}

impl SettingsStore {
    pub fn init(app: &AppHandle) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| fallback_dir("constellation-suite", false));
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| fallback_dir("constellation-suite", true));

        let _ = fs::create_dir_all(&config_dir);
        let _ = fs::create_dir_all(&cache_dir);

        let settings =
            read_json_or_default::<AppSettings>(&config_dir.join("settings.json")).sanitized();
        let offsets: HashMap<String, f64> =
            read_json_or_default(&config_dir.join("offsets.json"));
        let notes_tasks = read_json_or_default::<IslandNotesTasks>(
            &config_dir.join("island_notes_tasks.json"),
        )
        .sanitized();

        Self {
            config_dir,
            cache_dir,
            settings: RwLock::new(settings),
            offsets: RwLock::new(offsets),
            notes_tasks: RwLock::new(notes_tasks),
        }
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn get_settings(&self) -> AppSettings {
        self.settings
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, app: &AppHandle, incoming: AppSettings) -> Result<AppSettings, String> {
        let clean = incoming.sanitized();
        {
            let mut guard = self
                .settings
                .write()
                .map_err(|_| "Settings lock poisoned".to_string())?;
            *guard = clean.clone();
        }
        write_json_atomic(&self.config_dir.join("settings.json"), &clean)?;
        let _ = app.emit("settings-synced", &clean);
        Ok(clean)
    }

    pub fn get_offset(&self, track_key: &str) -> f64 {
        if track_key.trim().is_empty() {
            return 0.0;
        }
        self.offsets
            .read()
            .ok()
            .and_then(|g| g.get(track_key).copied())
            .unwrap_or(0.0)
    }

    pub fn set_offset(&self, track_key: &str, offset: f64) -> Result<f64, String> {
        let clean_key = track_key.trim();
        if clean_key.is_empty() || clean_key.len() > 512 {
            return Err("Invalid track key".to_string());
        }
        if !offset.is_finite() {
            return Err("Offset must be a finite number".to_string());
        }
        let rounded = ((offset.clamp(-60.0, 60.0)) * 100.0).round() / 100.0;
        let snapshot = {
            let mut guard = self
                .offsets
                .write()
                .map_err(|_| "Offsets lock poisoned".to_string())?;
            guard.insert(clean_key.to_string(), rounded);
            if guard.len() > 2000 {
                if let Some(first_key) = guard.keys().next().cloned() {
                    guard.remove(&first_key);
                }
            }
            guard.clone()
        };
        write_json_atomic(&self.config_dir.join("offsets.json"), &snapshot)?;
        Ok(rounded)
    }

    pub fn get_notes_tasks(&self) -> IslandNotesTasks {
        self.notes_tasks
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn save_notes_tasks(
        &self,
        app: &AppHandle,
        incoming: IslandNotesTasks,
    ) -> Result<IslandNotesTasks, String> {
        let clean = incoming.sanitized();
        {
            let mut guard = self
                .notes_tasks
                .write()
                .map_err(|_| "Notes lock poisoned".to_string())?;
            *guard = clean.clone();
        }
        write_json_atomic(&self.config_dir.join("island_notes_tasks.json"), &clean)?;
        let _ = app.emit("notes-tasks-synced", &clean);
        Ok(clean)
    }
}

fn fallback_dir(app_name: &str, cache: bool) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = if cache {
            std::env::var_os("LOCALAPPDATA")
        } else {
            std::env::var_os("APPDATA")
        };
        if let Some(root) = base {
            return PathBuf::from(root).join(app_name);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let var = if cache { "XDG_CACHE_HOME" } else { "XDG_CONFIG_HOME" };
        if let Some(root) = std::env::var_os(var) {
            return PathBuf::from(root).join(app_name);
        }
        if let Some(home) = std::env::var_os("HOME") {
            let sub = if cache { ".cache" } else { ".config" };
            return PathBuf::from(home).join(sub).join(app_name);
        }
    }
    std::env::temp_dir().join(app_name)
}

fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<T>(&raw).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating dir: {e}"))?;
    }
    let body = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed serializing JSON: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("Failed writing temp file: {e}"))?;
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(path);
        fs::rename(&tmp, path).map_err(|e| format!("Failed replacing file ({err}): {e}"))?;
    }
    Ok(())
}
