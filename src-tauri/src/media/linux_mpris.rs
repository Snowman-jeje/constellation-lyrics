use std::collections::HashMap;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::process::Command;
use tokio::sync::Mutex;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};
use zbus::Connection;

use super::MediaSnapshot;

const DBUS_DEST: &str = "org.freedesktop.DBus";
const DBUS_PATH: &str = "/org/freedesktop/DBus";
const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
const PROPS_IFACE: &str = "org.freedesktop.DBus.Properties";

#[derive(Debug, Clone)]
struct CandidatePlayer {
    bus_name: String,
    player_label: String,
    status: String,
    title: String,
    artist: String,
    album: String,
    art_url: String,
    length: f64,
    position: f64,
    track_id: Option<String>,
    score: i32,
}

pub struct LinuxMprisMonitor {
    conn: Mutex<Option<Connection>>,
}

impl LinuxMprisMonitor {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }

    async fn get_connection(&self) -> Option<Connection> {
        let mut guard = self.conn.lock().await;
        if let Some(ref c) = *guard {
            return Some(c.clone());
        }
        if let Ok(conn) = Connection::session().await {
            *guard = Some(conn.clone());
            return Some(conn);
        }
        None
    }

    async fn find_best_player_zbus(&self) -> Option<CandidatePlayer> {
        let conn = self.get_connection().await?;
        let reply = conn
            .call_method(Some(DBUS_DEST), DBUS_PATH, Some(DBUS_DEST), "ListNames", &())
            .await
            .ok()?;
        let names: Vec<String> = reply.body().deserialize().ok()?;

        let mut best: Option<CandidatePlayer> = None;
        for bus_name in names.into_iter().filter(|n| n.starts_with(MPRIS_PREFIX)) {
            if let Some(cand) = self.query_player(&conn, &bus_name).await {
                if best.as_ref().map(|b| cand.score > b.score).unwrap_or(true) {
                    best = Some(cand);
                }
            }
        }
        best
    }

    async fn query_player(&self, conn: &Connection, bus_name: &str) -> Option<CandidatePlayer> {
        let reply = conn
            .call_method(
                Some(bus_name),
                MPRIS_PATH,
                Some(PROPS_IFACE),
                "GetAll",
                &(MPRIS_PLAYER_IFACE,),
            )
            .await
            .ok()?;

        let props: HashMap<String, OwnedValue> = reply.body().deserialize().ok()?;
        let status = props
            .get("PlaybackStatus")
            .and_then(val_as_string)
            .unwrap_or_else(|| "Stopped".to_string());

        let mut position = props
            .get("Position")
            .and_then(val_as_i64)
            .map(|us| (us as f64) / 1_000_000.0)
            .unwrap_or(0.0);

        if let Ok(pos_reply) = conn
            .call_method(
                Some(bus_name),
                MPRIS_PATH,
                Some(PROPS_IFACE),
                "Get",
                &(MPRIS_PLAYER_IFACE, "Position"),
            )
            .await
        {
            if let Ok(pos_val) = pos_reply.body().deserialize::<OwnedValue>() {
                if let Some(us) = val_as_i64(&pos_val) {
                    position = (us as f64) / 1_000_000.0;
                }
            }
        }

        let metadata = props
            .get("Metadata")
            .and_then(val_as_dict)
            .unwrap_or_default();

        let title = metadata
            .get("xesam:title")
            .and_then(val_as_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        let artist = metadata
            .get("xesam:artist")
            .and_then(val_as_artist)
            .unwrap_or_default()
            .trim()
            .to_string();
        let album = metadata
            .get("xesam:album")
            .and_then(val_as_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        let art_url = metadata
            .get("mpris:artUrl")
            .and_then(val_as_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        let length = metadata
            .get("mpris:length")
            .and_then(val_as_i64)
            .map(|us| (us.max(0) as f64) / 1_000_000.0)
            .unwrap_or(0.0);
        let track_id = metadata
            .get("mpris:trackid")
            .and_then(val_as_string);

        let player_label = bus_name
            .strip_prefix(MPRIS_PREFIX)
            .unwrap_or(bus_name)
            .split('.')
            .next()
            .unwrap_or(bus_name)
            .to_string();

        let score = score_candidate(bus_name, &status, &title, &artist, &album, &art_url);

        Some(CandidatePlayer {
            bus_name: bus_name.to_string(),
            player_label,
            status,
            title,
            artist,
            album,
            art_url,
            length,
            position: position.max(0.0),
            track_id,
            score,
        })
    }

    pub async fn get_snapshot(&self) -> Option<MediaSnapshot> {
        if let Some(cand) = self.find_best_player_zbus().await {
            if !cand.title.is_empty() || !cand.artist.is_empty() {
                return Some(MediaSnapshot {
                    player: cand.player_label,
                    title: cand.title,
                    artist: cand.artist,
                    album: cand.album,
                    art_url: clean_art_url(&cand.art_url),
                    raw_art_bytes: Vec::new(),
                    length: cand.length,
                    status: cand.status,
                    position: cand.position,
                    timestamp: now_unix_secs(),
                });
            }
        }
        playerctl_snapshot().await
    }

    pub async fn play_pause(&self) -> bool {
        if let (Some(conn), Some(cand)) = (self.get_connection().await, self.find_best_player_zbus().await) {
            if conn
                .call_method(
                    Some(cand.bus_name.as_str()),
                    MPRIS_PATH,
                    Some(MPRIS_PLAYER_IFACE),
                    "PlayPause",
                    &(),
                )
                .await
                .is_ok()
            {
                return true;
            }
        }
        run_playerctl_action(&["play-pause"]).await
    }

    pub async fn next_track(&self) -> bool {
        if let (Some(conn), Some(cand)) = (self.get_connection().await, self.find_best_player_zbus().await) {
            if conn
                .call_method(
                    Some(cand.bus_name.as_str()),
                    MPRIS_PATH,
                    Some(MPRIS_PLAYER_IFACE),
                    "Next",
                    &(),
                )
                .await
                .is_ok()
            {
                return true;
            }
        }
        run_playerctl_action(&["next"]).await
    }

    pub async fn previous_track(&self) -> bool {
        if let (Some(conn), Some(cand)) = (self.get_connection().await, self.find_best_player_zbus().await) {
            if conn
                .call_method(
                    Some(cand.bus_name.as_str()),
                    MPRIS_PATH,
                    Some(MPRIS_PLAYER_IFACE),
                    "Previous",
                    &(),
                )
                .await
                .is_ok()
            {
                return true;
            }
        }
        run_playerctl_action(&["previous"]).await
    }

    pub async fn seek(&self, seconds: f64) -> bool {
        let clamped = seconds.max(0.0);
        if let (Some(conn), Some(cand)) = (self.get_connection().await, self.find_best_player_zbus().await) {
            if let Some(ref tid) = cand.track_id {
                if let Ok(path) = ObjectPath::try_from(tid.as_str()) {
                    let target_us = (clamped * 1_000_000.0) as i64;
                    if conn
                        .call_method(
                            Some(cand.bus_name.as_str()),
                            MPRIS_PATH,
                            Some(MPRIS_PLAYER_IFACE),
                            "SetPosition",
                            &(path, target_us),
                        )
                        .await
                        .is_ok()
                    {
                        return true;
                    }
                }
            }
        }
        let pos_arg = format!("{:.3}", clamped);
        run_playerctl_action(&["position", &pos_arg]).await
    }
}

fn score_candidate(
    player_id: &str,
    status: &str,
    title: &str,
    artist: &str,
    album: &str,
    art_url: &str,
) -> i32 {
    let mut score = match status {
        "Playing" => 50,
        "Paused" => 10,
        _ => 0,
    };

    let lower_title = title.to_ascii_lowercase();
    if matches!(
        lower_title.as_str(),
        "" | "youtube music" | "mozilla firefox" | "google chrome" | "chromium"
    ) {
        score -= 30;
    } else {
        score += 20;
    }

    if !artist.is_empty() {
        score += 15;
    }
    if !album.is_empty() && album.to_ascii_lowercase() != "youtube music" {
        score += 5;
    }
    if !art_url.is_empty() {
        score += 5;
    }
    if player_id.contains("plasma-browser-integration") {
        score += 10;
    }
    score
}

fn clean_art_url(raw: &str) -> String {
    if let Some(stripped) = raw.strip_prefix("file://") {
        stripped.to_string()
    } else {
        raw.to_string()
    }
}

fn val_as_string(val: &OwnedValue) -> Option<String> {
    match &**val {
        Value::Str(s) => Some(s.as_str().to_string()),
        Value::ObjectPath(p) => Some(p.as_str().to_string()),
        _ => None,
    }
}

fn val_as_artist(val: &OwnedValue) -> Option<String> {
    match &**val {
        Value::Str(s) => Some(s.as_str().to_string()),
        Value::Array(arr) => {
            let mut items = Vec::new();
            for v in arr.iter() {
                if let Value::Str(s) = v {
                    let t = s.as_str().trim();
                    if !t.is_empty() {
                        items.push(t.to_string());
                    }
                }
            }
            if items.is_empty() {
                None
            } else {
                Some(items.join(", "))
            }
        }
        _ => None,
    }
}

fn val_as_i64(val: &OwnedValue) -> Option<i64> {
    match &**val {
        Value::I64(n) => Some(*n),
        Value::U64(n) => i64::try_from(*n).ok(),
        Value::I32(n) => Some(*n as i64),
        Value::U32(n) => Some(*n as i64),
        _ => None,
    }
}

fn val_as_dict(val: &OwnedValue) -> Option<HashMap<String, OwnedValue>> {
    HashMap::<String, OwnedValue>::try_from(val.clone()).ok()
}

fn now_unix_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

async fn playerctl_output(args: &[&str]) -> Option<String> {
    let out = Command::new("playerctl")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn playerctl_active_player() -> Option<String> {
    let list_raw = playerctl_output(&["-l"]).await?;
    let players: Vec<String> = list_raw
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    if players.is_empty() {
        return None;
    }

    let mut best_name = players[0].clone();
    let mut best_score = i32::MIN;
    for player in players {
        let status = playerctl_output(&["-p", &player, "status"])
            .await
            .unwrap_or_default();
        if status.is_empty() {
            continue;
        }
        let meta = playerctl_output(&[
            "-p",
            &player,
            "metadata",
            "--format",
            "{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}}",
        ])
        .await
        .unwrap_or_default();
        let parts: Vec<&str> = meta.split(";;;").collect();
        let title = parts.first().copied().unwrap_or("").trim();
        let artist = parts.get(1).copied().unwrap_or("").trim();
        let album = parts.get(2).copied().unwrap_or("").trim();
        let art_url = parts.get(3).copied().unwrap_or("").trim();
        let sc = score_candidate(&player, &status, title, artist, album, art_url);
        if sc > best_score {
            best_score = sc;
            best_name = player;
        }
    }
    Some(best_name)
}

async fn playerctl_snapshot() -> Option<MediaSnapshot> {
    let player = playerctl_active_player().await?;
    let status = playerctl_output(&["-p", &player, "status"]).await?;
    let meta = playerctl_output(&[
        "-p",
        &player,
        "metadata",
        "--format",
        "{{playerName}};;;{{title}};;;{{artist}};;;{{album}};;;{{mpris:artUrl}};;;{{mpris:length}}",
    ])
    .await
    .unwrap_or_default();

    let parts: Vec<&str> = meta.split(";;;").collect();
    let p_name = parts
        .first()
        .copied()
        .filter(|s| !s.is_empty())
        .unwrap_or(&player)
        .to_string();
    let title = parts.get(1).copied().unwrap_or("").trim().to_string();
    let artist = parts.get(2).copied().unwrap_or("").trim().to_string();
    let album = parts.get(3).copied().unwrap_or("").trim().to_string();
    let art_url = clean_art_url(parts.get(4).copied().unwrap_or("").trim());
    let length = parts
        .get(5)
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|us| us / 1_000_000.0)
        .unwrap_or(0.0);

    let position = playerctl_output(&["-p", &player, "position"])
        .await
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
        .max(0.0);

    if title.is_empty() && artist.is_empty() {
        return None;
    }

    Some(MediaSnapshot {
        player: p_name,
        title,
        artist,
        album,
        art_url,
        raw_art_bytes: Vec::new(),
        length,
        status,
        position,
        timestamp: now_unix_secs(),
    })
}

async fn run_playerctl_action(action_args: &[&str]) -> bool {
    let Some(player) = playerctl_active_player().await else {
        return false;
    };
    let mut args = vec!["-p", &player];
    args.extend_from_slice(action_args);
    Command::new("playerctl")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}
