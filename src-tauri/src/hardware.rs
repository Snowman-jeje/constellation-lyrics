use std::sync::Mutex;
use std::time::Instant;

use sysinfo::{Networks, System};

use crate::models::HardwareSnapshot;

pub struct HardwareMonitor {
    inner: Mutex<HardwareInner>,
}

struct HardwareInner {
    sys: System,
    networks: Networks,
    last_net_sample: Instant,
}

impl HardwareMonitor {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let networks = Networks::new_with_refreshed_list();
        Self {
            inner: Mutex::new(HardwareInner {
                sys,
                networks,
                last_net_sample: Instant::now(),
            }),
        }
    }

    pub fn snapshot(&self) -> HardwareSnapshot {
        let Ok(mut guard) = self.inner.lock() else {
            return HardwareSnapshot::default();
        };
        guard.sys.refresh_cpu_usage();
        guard.sys.refresh_memory();
        guard.networks.refresh(true);

        let elapsed = guard
            .last_net_sample
            .elapsed()
            .as_secs_f64()
            .max(0.25);
        guard.last_net_sample = Instant::now();

        let mut rx_bytes = 0u64;
        let mut tx_bytes = 0u64;
        for (_, data) in &guard.networks {
            rx_bytes = rx_bytes.saturating_add(data.received());
            tx_bytes = tx_bytes.saturating_add(data.transmitted());
        }

        let cpu_pct = (guard.sys.global_cpu_usage() * 10.0).round() / 10.0;
        let bytes_per_gb = 1024.0 * 1024.0 * 1024.0;
        let ram_used_gb =
            ((guard.sys.used_memory() as f64 / bytes_per_gb) * 100.0).round() / 100.0;
        let ram_total_gb =
            ((guard.sys.total_memory() as f64 / bytes_per_gb) * 100.0).round() / 100.0;
        let net_rx_kbps = ((rx_bytes as f64 / 1024.0 / elapsed) * 10.0).round() / 10.0;
        let net_tx_kbps = ((tx_bytes as f64 / 1024.0 / elapsed) * 10.0).round() / 10.0;

        let (battery_pct, charging) = read_battery_status();

        HardwareSnapshot {
            cpu_pct,
            ram_used_gb,
            ram_total_gb,
            net_rx_kbps,
            net_tx_kbps,
            battery_pct,
            charging,
        }
    }
}

#[cfg(target_os = "windows")]
fn read_battery_status() -> (Option<u8>, bool) {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut power = SYSTEM_POWER_STATUS::default();
    let ok = unsafe { GetSystemPowerStatus(&mut power) }.is_ok();
    if !ok {
        return (None, false);
    }
    let has_battery = (power.BatteryFlag & 128) == 0 && power.BatteryLifePercent <= 100;
    let pct = if has_battery {
        Some(power.BatteryLifePercent)
    } else {
        None
    };
    let charging = power.ACLineStatus == 1 || (power.BatteryFlag & 8) != 0;
    (pct, charging)
}

#[cfg(target_os = "linux")]
fn read_battery_status() -> (Option<u8>, bool) {
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
                return (Some(pct.min(100)), charging);
            }
        }
    }
    (None, false)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn read_battery_status() -> (Option<u8>, bool) {
    (None, false)
}
