#[cfg(target_os = "windows")]
use std::collections::VecDeque;
#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
#[cfg(target_os = "windows")]
use std::sync::{mpsc, Arc, Mutex, OnceLock};
#[cfg(target_os = "windows")]
use std::thread::JoinHandle;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]
use windows::core::{s, w, PCWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
#[cfg(target_os = "windows")]
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentThreadId, SetProcessWorkingSetSize,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, FindWindowExW, FindWindowW, GetMessageW, PeekMessageW,
    PostThreadMessageW, SetWindowsHookExW, ShowWindow, TranslateMessage, UnhookWindowsHookEx,
    HHOOK, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, SW_HIDE, SW_SHOWNA, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::models::{ColorPalette, KeyPulseEvent, PlatformCapabilities};

#[cfg(target_os = "windows")]
const WCA_ACCENT_POLICY: u32 = 19;
#[cfg(target_os = "windows")]
const ACCENT_DISABLED: u32 = 0;
#[cfg(target_os = "windows")]
const ACCENT_ENABLE_GRADIENT: u32 = 1;
#[cfg(target_os = "windows")]
const ACCENT_ENABLE_TRANSPARENTGRADIENT: u32 = 2;
#[cfg(target_os = "windows")]
const ACCENT_ENABLE_BLURBEHIND: u32 = 3;
#[cfg(target_os = "windows")]
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
#[cfg(target_os = "windows")]
const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;

#[cfg(target_os = "windows")]
#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct WindowCompositionAttribData {
    attrib: u32,
    pv_data: *mut c_void,
    cb_data: usize,
}

#[cfg(target_os = "windows")]
type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> BOOL;

#[cfg(target_os = "windows")]
static KEY_PULSE_TX: OnceLock<Mutex<Option<mpsc::SyncSender<KeyPulseEvent>>>> = OnceLock::new();
#[cfg(target_os = "windows")]
static KEY_TIMESTAMPS: OnceLock<Mutex<VecDeque<Instant>>> = OnceLock::new();

#[cfg(target_os = "windows")]
pub struct PlatformController {
    taskbar_mode: Mutex<String>,
    taskbar_styled: AtomicBool,
    volume_osd_hidden: AtomicBool,
    last_beat_apply: Mutex<Instant>,
    hook_running: Arc<AtomicBool>,
    hook_thread_id: Arc<AtomicU32>,
    hook_thread: Mutex<Option<JoinHandle<()>>>,
    hook_transition: Mutex<()>,
}

#[cfg(target_os = "windows")]
impl PlatformController {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::sync_channel::<KeyPulseEvent>(64);
        let cell = KEY_PULSE_TX.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = cell.lock() {
            *guard = Some(tx);
        }
        let _ = KEY_TIMESTAMPS.get_or_init(|| Mutex::new(VecDeque::with_capacity(256)));

        let app_for_emit = app.clone();
        let _ = std::thread::Builder::new()
            .name("constellation-key-emitter".to_string())
            .spawn(move || {
                while let Ok(ev) = rx.recv() {
                    let _ = app_for_emit.emit("key-pulse", ev);
                }
            });

        Self {
            taskbar_mode: Mutex::new("normal".to_string()),
            taskbar_styled: AtomicBool::new(false),
            volume_osd_hidden: AtomicBool::new(false),
            last_beat_apply: Mutex::new(Instant::now()),
            hook_running: Arc::new(AtomicBool::new(false)),
            hook_thread_id: Arc::new(AtomicU32::new(0)),
            hook_thread: Mutex::new(None),
            hook_transition: Mutex::new(()),
        }
    }

    pub fn capabilities(&self) -> PlatformCapabilities {
        let has_legacy_osd = unsafe {
            let hwnd = FindWindowW(w!("NativeHWNDHost"), PCWSTR::null());
            hwnd.0 != 0
        };
        PlatformCapabilities {
            os: "windows".to_string(),
            supports_taskbar_styling: true,
            supports_volume_osd_hide: has_legacy_osd,
            supports_per_app_mixer: true,
            supports_global_key_hook: true,
        }
    }

    pub fn set_keep_screen_on(&self, enabled: bool) {
        unsafe {
            if enabled {
                let _ = SetThreadExecutionState(
                    ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED,
                );
            } else {
                let _ = SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }

    pub fn set_taskbar_mode(&self, mode: &str, palette: ColorPalette, beat: f32) {
        if let Ok(mut guard) = self.taskbar_mode.lock() {
            *guard = mode.to_string();
        }
        if mode == "normal" {
            if self.taskbar_styled.swap(false, Ordering::SeqCst) {
                apply_taskbar_composition("normal", palette, 0.0);
            }
            return;
        }
        self.taskbar_styled.store(true, Ordering::SeqCst);
        apply_taskbar_composition(mode, palette, beat);
    }

    pub fn update_taskbar_reactive(&self, palette: ColorPalette, beat: f32) {
        let mode = self
            .taskbar_mode
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "normal".to_string());
        if mode != "album" && mode != "beat" {
            return;
        }
        if let Ok(mut last) = self.last_beat_apply.lock() {
            if last.elapsed() < Duration::from_millis(75) {
                return;
            }
            *last = Instant::now();
        }
        self.taskbar_styled.store(true, Ordering::SeqCst);
        apply_taskbar_composition(&mode, palette, beat);
    }

    pub fn restore_taskbar(&self) {
        if let Ok(mut guard) = self.taskbar_mode.lock() {
            *guard = "normal".to_string();
        }
        if self.taskbar_styled.swap(false, Ordering::SeqCst) {
            apply_taskbar_composition("normal", ColorPalette::default(), 0.0);
        }
    }

    pub fn set_hide_system_volume(&self, hide: bool) {
        if !hide && !self.volume_osd_hidden.swap(false, Ordering::SeqCst) {
            return;
        }
        unsafe {
            let hwnd = FindWindowW(w!("NativeHWNDHost"), PCWSTR::null());
            if hwnd.0 != 0 {
                self.volume_osd_hidden.store(hide, Ordering::SeqCst);
                let _ = ShowWindow(hwnd, if hide { SW_HIDE } else { SW_SHOWNA });
            }
        }
    }

    pub fn set_key_hook_enabled(&self, enabled: bool) {
        let _transition = self.hook_transition.lock();
        let currently_running = self.hook_running.load(Ordering::SeqCst);
        if enabled && !currently_running {
            self.start_key_hook_locked();
        } else if !enabled && (currently_running || self.hook_thread_id.load(Ordering::SeqCst) != 0) {
            self.stop_key_hook_locked();
        }
    }

    fn start_key_hook_locked(&self) {
        if self.hook_running.swap(true, Ordering::SeqCst) {
            return;
        }

        let running_flag = Arc::clone(&self.hook_running);
        let tid_store = Arc::clone(&self.hook_thread_id);
        let (ready_tx, ready_rx) = mpsc::sync_channel::<()>(1);

        let spawned = std::thread::Builder::new()
            .name("constellation-keyhook".to_string())
            .spawn(move || unsafe {
                let tid = GetCurrentThreadId();
                tid_store.store(tid, Ordering::SeqCst);

                let mut msg = MSG::default();
                let _ = PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_NOREMOVE);
                let _ = ready_tx.send(());

                let hmod = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), hmod, 0);
                if let Ok(hhook) = hook {
                    while running_flag.load(Ordering::SeqCst)
                        && GetMessageW(&mut msg, HWND::default(), 0, 0).0 > 0
                    {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    let _ = UnhookWindowsHookEx(hhook);
                }

                tid_store.store(0, Ordering::SeqCst);
                running_flag.store(false, Ordering::SeqCst);
            });

        match spawned {
            Ok(handle) => {
                let _ = ready_rx.recv_timeout(Duration::from_millis(500));
                if let Ok(mut guard) = self.hook_thread.lock() {
                    *guard = Some(handle);
                }
            }
            Err(_) => {
                self.hook_running.store(false, Ordering::SeqCst);
            }
        }
    }

    fn stop_key_hook_locked(&self) {
        self.hook_running.store(false, Ordering::SeqCst);
        let tid = self.hook_thread_id.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
        if let Ok(mut guard) = self.hook_thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }

    pub fn stop_key_hook(&self) {
        let _transition = self.hook_transition.lock();
        self.stop_key_hook_locked();
    }

    pub fn cleanup(&self) {
        self.stop_key_hook();
        self.set_keep_screen_on(false);
        self.set_hide_system_volume(false);
        self.restore_taskbar();
    }
}

#[cfg(target_os = "windows")]
impl Drop for PlatformController {
    fn drop(&mut self) {
        self.cleanup();
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn ll_keyboard_proc(
    code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if code >= 0 && l_param.0 != 0 {
        let msg_id = w_param.0 as u32;
        let is_down = msg_id == WM_KEYDOWN || msg_id == WM_SYSKEYDOWN;
        let is_up = msg_id == WM_KEYUP || msg_id == WM_SYSKEYUP;

        if is_down || is_up {
            // Only classify key geometry (letter/space/wide) and timing; never store or log key text
            let kb = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let kind = classify_vk_anonymously(kb.vkCode);
            let wpm = record_key_timing_and_wpm(is_down);
            if let Some(cell) = KEY_PULSE_TX.get() {
                if let Ok(guard) = cell.try_lock() {
                    if let Some(ref tx) = *guard {
                        let _ = tx.try_send(KeyPulseEvent {
                            kind: kind.to_string(),
                            down: is_down,
                            wpm,
                        });
                    }
                }
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, w_param, l_param)
}

#[cfg(target_os = "windows")]
fn classify_vk_anonymously(vk: u32) -> &'static str {
    match vk {
        0x20 => "space",
        0x08 | 0x09 | 0x0D | 0x10..=0x14 | 0x1B | 0x2E | 0x5B..=0x5D | 0xA0..=0xA5 => "wide",
        _ => "letter",
    }
}

#[cfg(target_os = "windows")]
fn record_key_timing_and_wpm(is_down: bool) -> u32 {
    let Some(cell) = KEY_TIMESTAMPS.get() else {
        return 0;
    };
    let Ok(mut q) = cell.try_lock() else {
        return 0;
    };
    let now = Instant::now();
    let window = Duration::from_secs(15);
    while let Some(&front) = q.front() {
        if now.duration_since(front) > window {
            q.pop_front();
        } else {
            break;
        }
    }
    if is_down && q.len() < 512 {
        q.push_back(now);
    }
    // 15-second window * 4 = keys/min; divide by 5 chars/word
    ((q.len() as f64 * 4.0) / 5.0).round() as u32
}

#[cfg(target_os = "windows")]
fn abgr(a: u8, r: u8, g: u8, b: u8) -> u32 {
    ((a as u32) << 24) | ((b as u32) << 16) | ((g as u32) << 8) | (r as u32)
}

#[cfg(target_os = "windows")]
fn apply_taskbar_composition(mode: &str, palette: ColorPalette, beat: f32) {
    let (state, flags, color) = match mode {
        "opaque" => (ACCENT_ENABLE_GRADIENT, 2, abgr(0xFF, 0x0E, 0x0E, 0x12)),
        "clear" => (ACCENT_ENABLE_TRANSPARENTGRADIENT, 2, abgr(0x01, 0x00, 0x00, 0x00)),
        "blur" => (ACCENT_ENABLE_BLURBEHIND, 2, abgr(0x66, 0x0E, 0x0E, 0x12)),
        "acrylic" => (ACCENT_ENABLE_ACRYLICBLURBEHIND, 2, abgr(0x88, 0x12, 0x12, 0x16)),
        "album" => {
            let r = (palette.r as f32 * 0.45) as u8;
            let g = (palette.g as f32 * 0.45) as u8;
            let b = (palette.b as f32 * 0.45) as u8;
            (ACCENT_ENABLE_ACRYLICBLURBEHIND, 2, abgr(0x88, r, g, b))
        }
        "beat" => {
            let pulse = beat.clamp(0.0, 1.0);
            let alpha = (95.0 + pulse * 95.0) as u8;
            let scale = 0.35 + pulse * 0.45;
            let r = (palette.r as f32 * scale).min(255.0) as u8;
            let g = (palette.g as f32 * scale).min(255.0) as u8;
            let b = (palette.b as f32 * scale).min(255.0) as u8;
            (ACCENT_ENABLE_ACRYLICBLURBEHIND, 2, abgr(alpha, r, g, b))
        }
        _ => (ACCENT_DISABLED, 0, 0),
    };

    unsafe {
        let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else {
            return;
        };
        let Some(proc_addr) = GetProcAddress(user32, s!("SetWindowCompositionAttribute")) else {
            return;
        };
        let set_wca: SetWindowCompositionAttributeFn = std::mem::transmute(proc_addr);

        let mut policy = AccentPolicy {
            accent_state: state,
            accent_flags: flags,
            gradient_color: color,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: WCA_ACCENT_POLICY,
            pv_data: &mut policy as *mut _ as *mut c_void,
            cb_data: std::mem::size_of::<AccentPolicy>(),
        };

        let primary = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null());
        if primary.0 != 0 {
            let _ = set_wca(primary, &mut data);
        }

        let mut secondary = HWND::default();
        loop {
            let found = FindWindowExW(
                HWND::default(),
                secondary,
                w!("Shell_SecondaryTrayWnd"),
                PCWSTR::null(),
            );
            if found.0 == 0 {
                break;
            }
            let _ = set_wca(found, &mut data);
            secondary = found;
        }
    }
}

#[cfg(target_os = "windows")]
pub fn apply_dwm_borderless(hwnd_raw: isize) {
    let hwnd = HWND(hwnd_raw);
    unsafe {
        let border_color: u32 = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_color as *const _ as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
        let corner_pref = DWMWCP_DONOTROUND.0 as u32;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner_pref as *const _ as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(target_os = "windows")]
pub fn is_fullscreen_app() -> bool {
    unsafe {
        if let Ok(state) = SHQueryUserNotificationState() {
            return state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE;
        }
    }
    false
}

#[cfg(target_os = "windows")]
pub fn trim_working_set() {
    unsafe {
        let handle = GetCurrentProcess();
        let _ = SetProcessWorkingSetSize(handle, usize::MAX, usize::MAX);
    }
}
