use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::{AudioSessionItem, SystemHudState};

#[derive(Default)]
pub struct AudioMixerManager {
    ducked_originals: Mutex<HashMap<String, f32>>,
}

impl AudioMixerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn list_sessions(&self) -> Vec<AudioSessionItem> {
        #[cfg(target_os = "windows")]
        {
            win_mixer::list_sessions()
        }
        #[cfg(target_os = "linux")]
        {
            linux_mixer::list_sessions()
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Vec::new()
        }
    }

    pub fn set_app_volume(&self, session_id: &str, volume: f32) -> Result<bool, String> {
        if session_id.trim().is_empty() {
            return Err("Session ID cannot be empty".to_string());
        }
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err("Volume must be within 0.0..=1.0".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            Ok(win_mixer::set_app_volume(session_id.trim(), volume))
        }
        #[cfg(target_os = "linux")]
        {
            linux_mixer::set_app_volume(session_id.trim(), volume)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Ok(false)
        }
    }

    pub fn set_app_mute(&self, session_id: &str, muted: bool) -> Result<bool, String> {
        if session_id.trim().is_empty() {
            return Err("Session ID cannot be empty".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            Ok(win_mixer::set_app_mute(session_id.trim(), muted))
        }
        #[cfg(target_os = "linux")]
        {
            linux_mixer::set_app_mute(session_id.trim(), muted)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = muted;
            Ok(false)
        }
    }

    pub fn set_timer_ducking(&self, active: bool) -> Result<(), String> {
        let mut guard = self
            .ducked_originals
            .lock()
            .map_err(|_| "Audio mixer lock poisoned".to_string())?;

        if active {
            if !guard.is_empty() {
                return Ok(());
            }
            let own_pid_id = format!("pid:{}", std::process::id());
            let sessions = self.list_sessions();
            for item in sessions {
                if item.id == own_pid_id || item.id == "system" {
                    continue;
                }
                let target_vol = (item.volume * 0.25).clamp(0.05, 0.30);
                if item.volume > target_vol && self.set_app_volume(&item.id, target_vol).unwrap_or(false) {
                    guard.insert(item.id, item.volume);
                }
            }
        } else {
            let to_restore: Vec<(String, f32)> = guard.drain().collect();
            drop(guard);
            for (id, orig) in to_restore {
                let _ = self.set_app_volume(&id, orig.clamp(0.0, 1.0));
            }
        }
        Ok(())
    }

    pub fn restore_all(&self) {
        let _ = self.set_timer_ducking(false);
    }

    pub fn get_system_hud_state(&self) -> SystemHudState {
        #[cfg(target_os = "windows")]
        {
            win_mixer::get_system_hud_state()
        }
        #[cfg(target_os = "linux")]
        {
            linux_mixer::get_system_hud_state()
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            SystemHudState::default()
        }
    }

    pub fn set_system_volume(&self, level: u32) -> Result<bool, String> {
        if level > 100 {
            return Err("Volume percentage must be in 0..=100".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            Ok(win_mixer::set_system_volume(level))
        }
        #[cfg(target_os = "linux")]
        {
            Ok(linux_mixer::set_system_volume(level))
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Ok(false)
        }
    }

    pub fn toggle_system_mute(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            win_mixer::toggle_system_mute()
        }
        #[cfg(target_os = "linux")]
        {
            linux_mixer::toggle_system_mute()
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }
}

impl Drop for AudioMixerManager {
    fn drop(&mut self) {
        self.restore_all();
    }
}

#[cfg(target_os = "windows")]
mod win_mixer {
    use std::collections::HashMap;
    use std::path::Path;

    use windows::core::{Interface, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, AudioSessionStateExpired, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    use crate::models::{AudioSessionItem, SystemHudState};

    struct ComGuard(bool);

    impl ComGuard {
        fn new() -> Self {
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            Self(hr.is_ok())
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    unsafe fn pwstr_to_string_and_free(ptr: PWSTR) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let s = ptr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(ptr.0 as *const core::ffi::c_void));
        s
    }

    unsafe fn get_process_name(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        if !ok || len == 0 {
            return None;
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        let stem = Path::new(&full)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&full);
        Some(stem.to_string())
    }

    unsafe fn session_id_for(ctrl2: &IAudioSessionControl2) -> (String, String) {
        if ctrl2.IsSystemSoundsSession().0 == 0 {
            return ("system".to_string(), "System Sounds".to_string());
        }
        let pid = ctrl2.GetProcessId().unwrap_or(0);
        if pid > 0 {
            let name = get_process_name(pid).unwrap_or_else(|| {
                let disp = ctrl2
                    .GetDisplayName()
                    .map(|p| pwstr_to_string_and_free(p))
                    .unwrap_or_default();
                if disp.is_empty() {
                    format!("App {pid}")
                } else {
                    disp
                }
            });
            return (format!("pid:{pid}"), name);
        }
        let disp = ctrl2
            .GetDisplayName()
            .map(|p| pwstr_to_string_and_free(p))
            .unwrap_or_default();
        let label = if disp.is_empty() {
            "Audio Stream".to_string()
        } else {
            disp
        };
        ("system".to_string(), label)
    }

    unsafe fn get_session_manager() -> Option<IAudioSessionManager2> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None).ok()
    }

    pub fn list_sessions() -> Vec<AudioSessionItem> {
        let _guard = ComGuard::new();
        let mut by_id: HashMap<String, AudioSessionItem> = HashMap::new();

        unsafe {
            let Some(mgr) = get_session_manager() else {
                return Vec::new();
            };
            let Ok(enumerator) = mgr.GetSessionEnumerator() else {
                return Vec::new();
            };
            let count = enumerator.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(ctrl) = enumerator.GetSession(i) else {
                    continue;
                };
                if let Ok(state) = ctrl.GetState() {
                    if state == AudioSessionStateExpired {
                        continue;
                    }
                }
                let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(vol_iface) = ctrl.cast::<ISimpleAudioVolume>() else {
                    continue;
                };

                let (id, name) = session_id_for(&ctrl2);
                let volume = vol_iface.GetMasterVolume().unwrap_or(1.0).clamp(0.0, 1.0);
                let muted = vol_iface.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                let peak = ctrl
                    .cast::<IAudioMeterInformation>()
                    .ok()
                    .and_then(|m| m.GetPeakValue().ok())
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0);

                by_id
                    .entry(id.clone())
                    .and_modify(|existing| {
                        existing.peak = existing.peak.max(peak);
                    })
                    .or_insert(AudioSessionItem {
                        id,
                        name,
                        volume,
                        muted,
                        peak,
                    });
            }
        }

        let mut items: Vec<AudioSessionItem> = by_id.into_values().collect();
        items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        items
    }

    pub fn set_app_volume(target_id: &str, volume: f32) -> bool {
        let _guard = ComGuard::new();
        let mut updated = false;

        unsafe {
            let Some(mgr) = get_session_manager() else {
                return false;
            };
            let Ok(enumerator) = mgr.GetSessionEnumerator() else {
                return false;
            };
            let count = enumerator.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(ctrl) = enumerator.GetSession(i) else {
                    continue;
                };
                let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let (id, _) = session_id_for(&ctrl2);
                if id == target_id {
                    if let Ok(vol_iface) = ctrl.cast::<ISimpleAudioVolume>() {
                        if vol_iface.SetMasterVolume(volume, std::ptr::null()).is_ok() {
                            updated = true;
                        }
                    }
                }
            }
        }
        updated
    }

    pub fn set_app_mute(target_id: &str, muted: bool) -> bool {
        let _guard = ComGuard::new();
        let mut updated = false;

        unsafe {
            let Some(mgr) = get_session_manager() else {
                return false;
            };
            let Ok(enumerator) = mgr.GetSessionEnumerator() else {
                return false;
            };
            let count = enumerator.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(ctrl) = enumerator.GetSession(i) else {
                    continue;
                };
                let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let (id, _) = session_id_for(&ctrl2);
                if id == target_id {
                    if let Ok(vol_iface) = ctrl.cast::<ISimpleAudioVolume>() {
                        if vol_iface.SetMute(muted, std::ptr::null()).is_ok() {
                            updated = true;
                        }
                    }
                }
            }
        }
        updated
    }

    unsafe fn get_endpoint_volume() -> Option<IAudioEndpointVolume> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok()
    }

    pub fn get_system_hud_state() -> SystemHudState {
        let _guard = ComGuard::new();
        let mut volume = 0u32;
        let mut muted = false;

        unsafe {
            if let Some(ep) = get_endpoint_volume() {
                if let Ok(scalar) = ep.GetMasterVolumeLevelScalar() {
                    volume = (scalar * 100.0).round().clamp(0.0, 100.0) as u32;
                }
                if let Ok(m) = ep.GetMute() {
                    muted = m.as_bool();
                }
            }
        }

        let mut power = SYSTEM_POWER_STATUS::default();
        let ok = unsafe { GetSystemPowerStatus(&mut power) }.is_ok();
        let has_battery =
            ok && (power.BatteryFlag & 128) == 0 && power.BatteryLifePercent <= 100;
        let battery_pct = if has_battery {
            power.BatteryLifePercent
        } else {
            100
        };
        let is_charging = ok && (power.ACLineStatus == 1 || (power.BatteryFlag & 8) != 0);

        SystemHudState {
            volume,
            muted,
            battery_pct,
            is_charging,
            has_battery,
        }
    }

    pub fn set_system_volume(level: u32) -> bool {
        let _guard = ComGuard::new();
        let scalar = (level.min(100) as f32) / 100.0;
        unsafe {
            if let Some(ep) = get_endpoint_volume() {
                return ep.SetMasterVolumeLevelScalar(scalar, std::ptr::null()).is_ok();
            }
        }
        false
    }

    pub fn toggle_system_mute() -> bool {
        let _guard = ComGuard::new();
        unsafe {
            if let Some(ep) = get_endpoint_volume() {
                if let Ok(curr) = ep.GetMute() {
                    let next = !curr.as_bool();
                    if ep.SetMute(next, std::ptr::null()).is_ok() {
                        return next;
                    }
                }
            }
        }
        false
    }
}

#[cfg(target_os = "linux")]
mod linux_mixer {
    use std::process::{Command, Stdio};

    use crate::models::{AudioSessionItem, SystemHudState};

    pub fn list_sessions() -> Vec<AudioSessionItem> {
        let Ok(out) = Command::new("pactl")
            .args(["list", "sink-inputs"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        let text = String::from_utf8_lossy(&out.stdout);
        parse_pactl_sink_inputs(&text)
    }

    fn parse_pactl_sink_inputs(text: &str) -> Vec<AudioSessionItem> {
        let mut items = Vec::new();
        let mut curr_id: Option<String> = None;
        let mut curr_name = String::new();
        let mut curr_vol = 1.0_f32;
        let mut curr_muted = false;

        let flush = |items: &mut Vec<AudioSessionItem>,
                     id: &mut Option<String>,
                     name: &mut String,
                     vol: &mut f32,
                     muted: &mut bool| {
            if let Some(sid) = id.take() {
                let label = if name.is_empty() {
                    format!("Stream #{sid}")
                } else {
                    name.clone()
                };
                items.push(AudioSessionItem {
                    id: sid,
                    name: label,
                    volume: (*vol).clamp(0.0, 1.0),
                    muted: *muted,
                    peak: 0.0,
                });
            }
            name.clear();
            *vol = 1.0;
            *muted = false;
        };

        for raw in text.lines() {
            let line = raw.trim();
            if let Some(rest) = line.strip_prefix("Sink Input #") {
                flush(
                    &mut items,
                    &mut curr_id,
                    &mut curr_name,
                    &mut curr_vol,
                    &mut curr_muted,
                );
                let id_clean = rest.trim();
                if !id_clean.is_empty() && id_clean.chars().all(|c| c.is_ascii_digit()) {
                    curr_id = Some(id_clean.to_string());
                }
                continue;
            }
            if curr_id.is_none() {
                continue;
            }
            if let Some(rest) = line.strip_prefix("Mute:") {
                curr_muted = rest.trim().eq_ignore_ascii_case("yes");
            } else if line.starts_with("Volume:") {
                if let Some(pct_idx) = line.find('%') {
                    let prefix = &line[..pct_idx];
                    if let Some(num_str) = prefix.split_whitespace().last() {
                        if let Ok(pct) = num_str.parse::<f32>() {
                            curr_vol = (pct / 100.0).clamp(0.0, 1.0);
                        }
                    }
                }
            } else if let Some(val) = line.strip_prefix("application.name = ") {
                let unquoted = val.trim().trim_matches('"');
                if !unquoted.is_empty() {
                    curr_name = unquoted.to_string();
                }
            } else if curr_name.is_empty() {
                if let Some(val) = line.strip_prefix("application.process.binary = ") {
                    let unquoted = val.trim().trim_matches('"');
                    if !unquoted.is_empty() {
                        curr_name = unquoted.to_string();
                    }
                }
            }
        }

        flush(
            &mut items,
            &mut curr_id,
            &mut curr_name,
            &mut curr_vol,
            &mut curr_muted,
        );
        items
    }

    pub fn set_app_volume(id: &str, volume: f32) -> Result<bool, String> {
        if !id.chars().all(|c| c.is_ascii_digit()) {
            return Err("Invalid sink input ID".to_string());
        }
        let pct_arg = format!("{}%", (volume * 100.0).round() as u32);
        let ok = Command::new("pactl")
            .args(["set-sink-input-volume", id, &pct_arg])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        Ok(ok)
    }

    pub fn set_app_mute(id: &str, muted: bool) -> Result<bool, String> {
        if !id.chars().all(|c| c.is_ascii_digit()) {
            return Err("Invalid sink input ID".to_string());
        }
        let mute_arg = if muted { "1" } else { "0" };
        let ok = Command::new("pactl")
            .args(["set-sink-input-mute", id, mute_arg])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        Ok(ok)
    }

    pub fn get_system_hud_state() -> SystemHudState {
        let mut volume = 0u32;
        let mut muted = false;

        if let Ok(out) = Command::new("wpctl")
            .args(["get-volume", "@DEFAULT_AUDIO_SINK@"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                muted = s.contains("[MUTED]");
                if let Some(num) = s.split_whitespace().nth(1) {
                    if let Ok(val) = num.parse::<f32>() {
                        volume = (val * 100.0).round().clamp(0.0, 100.0) as u32;
                    }
                }
            }
        } else if let Ok(out) = Command::new("pactl")
            .args(["get-sink-volume", "@DEFAULT_SINK@"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(pct_idx) = s.find('%') {
                    if let Some(n) = s[..pct_idx].split_whitespace().last() {
                        if let Ok(v) = n.parse::<u32>() {
                            volume = v.min(100);
                        }
                    }
                }
            }
        }

        let (battery_pct, is_charging, has_battery) = read_linux_battery();
        SystemHudState {
            volume,
            muted,
            battery_pct: battery_pct.unwrap_or(100),
            is_charging,
            has_battery,
        }
    }

    pub fn set_system_volume(level: u32) -> bool {
        let wp_arg = format!("{:.2}", (level.min(100) as f32) / 100.0);
        if Command::new("wpctl")
            .args(["set-volume", "@DEFAULT_AUDIO_SINK@", &wp_arg])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
        let pct_arg = format!("{}%", level.min(100));
        Command::new("pactl")
            .args(["set-sink-volume", "@DEFAULT_SINK@", &pct_arg])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    pub fn toggle_system_mute() -> bool {
        let _ = Command::new("wpctl")
            .args(["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        get_system_hud_state().muted
    }

    fn read_linux_battery() -> (Option<u8>, bool, bool) {
        for bat in ["BAT0", "BAT1"] {
            let cap_path = format!("/sys/class/power_supply/{bat}/capacity");
            let status_path = format!("/sys/class/power_supply/{bat}/status");
            if let Ok(cap_raw) = std::fs::read_to_string(&cap_path) {
                if let Ok(pct) = cap_raw.trim().parse::<u8>() {
                    let status = std::fs::read_to_string(&status_path)
                        .unwrap_or_default()
                        .trim()
                        .to_ascii_lowercase();
                    let charging = status == "charging" || status == "full";
                    return (Some(pct.min(100)), charging, true);
                }
            }
        }
        (None, false, false)
    }
}
