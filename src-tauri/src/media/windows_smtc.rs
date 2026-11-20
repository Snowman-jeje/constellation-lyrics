use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot;
use windows::core::Interface;
use windows::Foundation::{AsyncStatus, IAsyncOperation};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{
    DataReader, DataReaderLoadOperation, IInputStream, IRandomAccessStreamReference,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};

use super::MediaSnapshot;

const WINRT_EPOCH_OFFSET_TICKS: i64 = 116_444_736_000_000_000;

enum SmtcCommand {
    GetSnapshot(oneshot::Sender<Option<MediaSnapshot>>),
    PlayPause(oneshot::Sender<bool>),
    Next(oneshot::Sender<bool>),
    Previous(oneshot::Sender<bool>),
    Seek(f64, oneshot::Sender<bool>),
}

pub struct WindowsSmtcMonitor {
    tx: mpsc::Sender<SmtcCommand>,
}

impl WindowsSmtcMonitor {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<SmtcCommand>();
        let _ = std::thread::Builder::new()
            .name("constellation-smtc".to_string())
            .spawn(move || run_smtc_worker(rx));
        Self { tx }
    }

    pub async fn get_snapshot(&self) -> Option<MediaSnapshot> {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(SmtcCommand::GetSnapshot(reply_tx)).is_err() {
            return None;
        }
        reply_rx.await.ok().flatten()
    }

    pub async fn play_pause(&self) -> bool {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(SmtcCommand::PlayPause(reply_tx)).is_err() {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }

    pub async fn next_track(&self) -> bool {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(SmtcCommand::Next(reply_tx)).is_err() {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }

    pub async fn previous_track(&self) -> bool {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(SmtcCommand::Previous(reply_tx)).is_err() {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }

    pub async fn seek(&self, seconds: f64) -> bool {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(SmtcCommand::Seek(seconds, reply_tx)).is_err() {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }
}

struct ComMtaGuard(bool);

impl ComMtaGuard {
    fn new() -> Self {
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self(hr.is_ok())
    }
}

impl Drop for ComMtaGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

struct SmtcWorkerState {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
    last_thumb_key: String,
    cached_art_bytes: Vec<u8>,
}

impl SmtcWorkerState {
    fn new() -> Self {
        Self {
            manager: None,
            last_thumb_key: String::new(),
            cached_art_bytes: Vec::new(),
        }
    }

    fn ensure_manager(&mut self) -> Option<GlobalSystemMediaTransportControlsSessionManager> {
        if let Some(ref mgr) = self.manager {
            if mgr.GetSessions().is_ok() {
                return Some(mgr.clone());
            }
            self.manager = None;
        }
        let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?;
        let mgr = wait_async(op, 120).ok()?;
        self.manager = Some(mgr.clone());
        Some(mgr)
    }

    fn active_session(&mut self) -> Option<GlobalSystemMediaTransportControlsSession> {
        let mgr = self.ensure_manager()?;
        let current = mgr.GetCurrentSession().ok();
        if let Some(ref sess) = current {
            if is_session_playing(sess) {
                return current;
            }
        }
        if let Ok(sessions) = mgr.GetSessions() {
            let size = sessions.Size().unwrap_or(0);
            let mut fallback: Option<GlobalSystemMediaTransportControlsSession> = None;
            for idx in 0..size {
                if let Ok(sess) = sessions.GetAt(idx) {
                    if is_session_playing(&sess) {
                        return Some(sess);
                    }
                    if fallback.is_none() {
                        fallback = Some(sess);
                    }
                }
            }
            if current.is_some() {
                return current;
            }
            if fallback.is_some() {
                return fallback;
            }
        }
        current
    }

    fn snapshot(&mut self) -> Option<MediaSnapshot> {
        let session = self.active_session()?;

        let status = match session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
        {
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) => "Playing",
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused) => "Paused",
            _ => "Stopped",
        };

        let props_op = session.TryGetMediaPropertiesAsync().ok()?;
        let props = wait_async(props_op, 100).ok()?;

        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();

        let title = title.trim().to_string();
        let artist = artist.trim().to_string();
        let album = album.trim().to_string();

        if title.is_empty() && artist.is_empty() {
            return None;
        }

        let raw_app_id = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let player = normalize_player_name(&raw_app_id);

        let (position, length) = read_timeline(&session, status == "Playing");

        let thumb_key = format!("{artist}::{title}::{album}");
        if thumb_key != self.last_thumb_key {
            self.last_thumb_key = thumb_key;
            self.cached_art_bytes = read_thumbnail_bytes(props.Thumbnail().ok());
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        Some(MediaSnapshot {
            player,
            title,
            artist,
            album,
            art_url: String::new(),
            raw_art_bytes: self.cached_art_bytes.clone(),
            length,
            status: status.to_string(),
            position,
            timestamp,
        })
    }
}

fn run_smtc_worker(rx: mpsc::Receiver<SmtcCommand>) {
    let _com = ComMtaGuard::new();
    let mut state = SmtcWorkerState::new();

    while let Ok(cmd) = rx.recv() {
        match cmd {
            SmtcCommand::GetSnapshot(reply) => {
                let _ = reply.send(state.snapshot());
            }
            SmtcCommand::PlayPause(reply) => {
                let ok = if let Some(sess) = state.active_session() {
                    sess.TryTogglePlayPauseAsync()
                        .ok()
                        .and_then(|op| wait_async_bool(op, 100).ok())
                        .unwrap_or(false)
                } else {
                    false
                };
                if !ok {
                    send_media_key(VK_MEDIA_PLAY_PAUSE);
                }
                let _ = reply.send(true);
            }
            SmtcCommand::Next(reply) => {
                let ok = if let Some(sess) = state.active_session() {
                    sess.TrySkipNextAsync()
                        .ok()
                        .and_then(|op| wait_async_bool(op, 100).ok())
                        .unwrap_or(false)
                } else {
                    false
                };
                if !ok {
                    send_media_key(VK_MEDIA_NEXT_TRACK);
                }
                let _ = reply.send(true);
            }
            SmtcCommand::Previous(reply) => {
                let ok = if let Some(sess) = state.active_session() {
                    sess.TrySkipPreviousAsync()
                        .ok()
                        .and_then(|op| wait_async_bool(op, 100).ok())
                        .unwrap_or(false)
                } else {
                    false
                };
                if !ok {
                    send_media_key(VK_MEDIA_PREV_TRACK);
                }
                let _ = reply.send(true);
            }
            SmtcCommand::Seek(seconds, reply) => {
                let ok = if let Some(sess) = state.active_session() {
                    let ticks = (seconds.max(0.0) * 10_000_000.0) as i64;
                    sess.TryChangePlaybackPositionAsync(ticks)
                        .ok()
                        .and_then(|op| wait_async_bool(op, 100).ok())
                        .unwrap_or(false)
                } else {
                    false
                };
                let _ = reply.send(ok);
            }
        }
    }
}

fn is_session_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false)
}

fn normalize_player_name(raw_id: &str) -> String {
    let base = raw_id.split('!').next().unwrap_or(raw_id).trim();
    let stripped = if base.to_ascii_lowercase().ends_with(".exe") {
        &base[..base.len() - 4]
    } else {
        base
    };
    if stripped.is_empty() {
        "SMTC".to_string()
    } else {
        stripped.to_string()
    }
}

fn read_timeline(
    session: &GlobalSystemMediaTransportControlsSession,
    is_playing: bool,
) -> (f64, f64) {
    let Ok(timeline) = session.GetTimelineProperties() else {
        return (0.0, 0.0);
    };
    let raw_pos = timeline
        .Position()
        .map(|t| (t.Duration as f64 / 10_000_000.0).max(0.0))
        .unwrap_or(0.0);
    let end_sec = timeline
        .EndTime()
        .map(|t| (t.Duration as f64 / 10_000_000.0).max(0.0))
        .unwrap_or(0.0);

    let mut pos = raw_pos;
    if is_playing {
        if let Ok(last_upd) = timeline.LastUpdatedTime() {
            if last_upd.UniversalTime > 0 {
                if let Ok(now_dur) = SystemTime::now().duration_since(UNIX_EPOCH) {
                    let now_ticks = (now_dur.as_nanos() / 100) as i64 + WINRT_EPOCH_OFFSET_TICKS;
                    let elapsed = (now_ticks - last_upd.UniversalTime) as f64 / 10_000_000.0;
                    if (0.0..3600.0).contains(&elapsed) {
                        pos += elapsed;
                    }
                }
            }
        }
    }

    if end_sec > 0.0 {
        pos = pos.min(end_sec);
    }

    ((pos * 10000.0).round() / 10000.0, end_sec)
}

fn read_thumbnail_bytes(thumb_ref: Option<IRandomAccessStreamReference>) -> Vec<u8> {
    let Some(thumb) = thumb_ref else {
        return Vec::new();
    };
    let Ok(open_op) = thumb.OpenReadAsync() else {
        return Vec::new();
    };
    let Ok(stream) = wait_async(open_op, 120) else {
        return Vec::new();
    };

    let size = stream.Size().unwrap_or(0);
    if size == 0 || size > 16 * 1024 * 1024 {
        let _ = stream.Close();
        return Vec::new();
    }

    let Ok(input_stream) = stream.cast::<IInputStream>() else {
        let _ = stream.Close();
        return Vec::new();
    };
    let Ok(reader) = DataReader::CreateDataReader(&input_stream) else {
        let _ = stream.Close();
        return Vec::new();
    };

    let loaded = reader
        .LoadAsync(size as u32)
        .ok()
        .and_then(|op| wait_async_load(&op, 160).ok())
        .unwrap_or(0);

    if loaded == 0 {
        let _ = reader.Close();
        let _ = stream.Close();
        return Vec::new();
    }

    let mut buf = vec![0u8; loaded as usize];
    let ok = reader.ReadBytes(&mut buf).is_ok();
    let _ = reader.Close();
    let _ = stream.Close();
    if ok {
        buf
    } else {
        Vec::new()
    }
}

fn wait_async<T: Interface + windows::core::RuntimeType>(
    op: IAsyncOperation<T>,
    max_iters: usize,
) -> windows::core::Result<T> {
    let mut count = 0;
    while op.Status()? == AsyncStatus::Started && count < max_iters {
        std::thread::sleep(Duration::from_millis(5));
        count += 1;
    }
    op.GetResults()
}

fn wait_async_bool(op: IAsyncOperation<bool>, max_iters: usize) -> windows::core::Result<bool> {
    let mut count = 0;
    while op.Status()? == AsyncStatus::Started && count < max_iters {
        std::thread::sleep(Duration::from_millis(5));
        count += 1;
    }
    op.GetResults()
}

fn wait_async_load(
    op: &DataReaderLoadOperation,
    max_iters: usize,
) -> windows::core::Result<u32> {
    let mut count = 0;
    while op.Status()? == AsyncStatus::Started && count < max_iters {
        std::thread::sleep(Duration::from_millis(5));
        count += 1;
    }
    op.GetResults()
}

fn send_media_key(vk: VIRTUAL_KEY) {
    let down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_EXTENDEDKEY,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [down, up];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}
