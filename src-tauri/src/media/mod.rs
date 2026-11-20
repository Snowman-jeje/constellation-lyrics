#[cfg(target_os = "linux")]
mod linux_mpris;
#[cfg(target_os = "windows")]
mod windows_smtc;

#[derive(Debug, Clone, Default)]
pub struct MediaSnapshot {
    pub player: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art_url: String,
    pub raw_art_bytes: Vec<u8>,
    pub length: f64,
    pub status: String,
    pub position: f64,
    pub timestamp: f64,
}

pub struct MediaMonitor {
    #[cfg(target_os = "windows")]
    inner: windows_smtc::WindowsSmtcMonitor,
    #[cfg(target_os = "linux")]
    inner: linux_mpris::LinuxMprisMonitor,
}

impl MediaMonitor {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: windows_smtc::WindowsSmtcMonitor::new(),
            #[cfg(target_os = "linux")]
            inner: linux_mpris::LinuxMprisMonitor::new(),
        }
    }

    pub async fn get_snapshot(&self) -> Option<MediaSnapshot> {
        #[cfg(target_os = "windows")]
        {
            self.inner.get_snapshot().await
        }
        #[cfg(target_os = "linux")]
        {
            self.inner.get_snapshot().await
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            None
        }
    }

    pub async fn play_pause(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            self.inner.play_pause().await
        }
        #[cfg(target_os = "linux")]
        {
            self.inner.play_pause().await
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }

    pub async fn next_track(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            self.inner.next_track().await
        }
        #[cfg(target_os = "linux")]
        {
            self.inner.next_track().await
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }

    pub async fn previous_track(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            self.inner.previous_track().await
        }
        #[cfg(target_os = "linux")]
        {
            self.inner.previous_track().await
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }

    pub async fn seek(&self, seconds: f64) -> bool {
        if !seconds.is_finite() {
            return false;
        }
        let clamped = seconds.max(0.0);
        #[cfg(target_os = "windows")]
        {
            self.inner.seek(clamped).await
        }
        #[cfg(target_os = "linux")]
        {
            self.inner.seek(clamped).await
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = clamped;
            false
        }
    }
}
