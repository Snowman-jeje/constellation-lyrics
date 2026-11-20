use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{UpdateCheckResult, UpdateProgressEvent};

const RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/Snowman-jeje/constellation-lyrics/releases/latest";
const MAX_INSTALLER_BYTES: usize = 150 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    html_url: String,
    assets: Vec<GithubAsset>,
}

fn build_http_client() -> Result<reqwest::Client, String> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.stop();
        }
        let url = attempt.url();
        if url.scheme() != "https" || !is_allowed_github_host(url.host_str()) {
            return attempt.stop();
        }
        attempt.follow()
    });
    reqwest::Client::builder()
        .user_agent("ConstellationSuite-Updater/3.0")
        .redirect(redirect_policy)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed building updater HTTP client: {e}"))
}

fn is_allowed_github_host(host: Option<&str>) -> bool {
    let Some(raw) = host else {
        return false;
    };
    let h = raw.trim().to_ascii_lowercase();
    h == "api.github.com"
        || h == "github.com"
        || h == "objects.githubusercontent.com"
        || h == "release-assets.githubusercontent.com"
        || h.ends_with(".githubusercontent.com")
}

fn parse_semver(raw: &str) -> (u64, u64, u64) {
    let clean = raw.trim().trim_start_matches(['v', 'V']);
    let core = clean.split(['-', '+']).next().unwrap_or("");
    let mut parts = core.split('.');
    let major = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn pick_platform_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    #[cfg(target_os = "windows")]
    {
        assets
            .iter()
            .find(|a| {
                let low = a.name.to_ascii_lowercase();
                low.ends_with("-setup.exe") || low.ends_with(".exe")
            })
    }

    #[cfg(target_os = "linux")]
    {
        let prefer_appimage = std::env::var_os("APPIMAGE").is_some();
        if prefer_appimage {
            if let Some(appimg) = assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".appimage"))
            {
                return Some(appimg);
            }
        }
        assets
            .iter()
            .find(|a| a.name.to_ascii_lowercase().ends_with(".appimage"))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| a.name.to_ascii_lowercase().ends_with(".deb"))
            })
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = assets;
        None
    }
}

fn pick_checksum_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    #[cfg(target_os = "windows")]
    let preferred = "checksums-windows.txt";
    #[cfg(target_os = "linux")]
    let preferred = "checksums-linux.txt";
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let preferred = "checksums.txt";

    assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case(preferred))
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().contains("checksums"))
        })
}

async fn fetch_latest_release(client: &reqwest::Client) -> Result<Option<GithubRelease>, String> {
    let resp = client
        .get(RELEASES_LATEST_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Network error checking updates: {e}"))?;

    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }
    let release = resp
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("Invalid GitHub release payload: {e}"))?;
    Ok(Some(release))
}

pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = build_http_client()?;
    let Some(release) = fetch_latest_release(&client).await? else {
        return Ok(UpdateCheckResult {
            current_version: current_version.clone(),
            latest_version: current_version,
            has_update: false,
            release_notes: String::new(),
            asset_name: None,
            asset_size: 0,
            download_url: None,
            html_url: "https://github.com/Snowman-jeje/constellation-lyrics/releases".to_string(),
        });
    };

    let latest_version = release.tag_name.trim().trim_start_matches(['v', 'V']).to_string();
    let has_update = parse_semver(&latest_version) > parse_semver(&current_version);
    let asset = pick_platform_asset(&release.assets);

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        has_update,
        release_notes: release.body.unwrap_or_default().chars().take(1200).collect(),
        asset_name: asset.map(|a| a.name.clone()),
        asset_size: asset.map(|a| a.size).unwrap_or(0),
        download_url: asset.map(|a| a.browser_download_url.clone()),
        html_url: release.html_url,
    })
}

fn sanitize_filename(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_str()?;
    let clean: String = base
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .collect();
    if clean.is_empty() || clean.contains("..") {
        None
    } else {
        Some(clean)
    }
}

fn emit_progress(app: &AppHandle, stage: &str, progress: u8, message: impl Into<String>) {
    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: stage.to_string(),
            progress,
            message: message.into(),
        },
    );
}

pub async fn download_and_install_update(app: &AppHandle) -> Result<(), String> {
    let client = build_http_client()?;
    emit_progress(app, "checking", 5, "Checking latest release");

    let release = fetch_latest_release(&client)
        .await?
        .ok_or_else(|| "No published GitHub releases found".to_string())?;

    let current_version = env!("CARGO_PKG_VERSION");
    let latest_version = release.tag_name.trim().trim_start_matches(['v', 'V']);
    if parse_semver(latest_version) <= parse_semver(current_version) {
        return Err("Already on the latest version".to_string());
    }

    let asset = pick_platform_asset(&release.assets)
        .ok_or_else(|| "No compatible installer found in release assets".to_string())?;

    let parsed_url = reqwest::Url::parse(&asset.browser_download_url)
        .map_err(|_| "Invalid download URL".to_string())?;
    if parsed_url.scheme() != "https" || !is_allowed_github_host(parsed_url.host_str()) {
        return Err("Blocked untrusted update download host".to_string());
    }

    let safe_name = sanitize_filename(&asset.name)
        .ok_or_else(|| "Invalid installer asset filename".to_string())?;
    let updates_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("constellation-suite"))
        .join("updates");
    let _ = fs::create_dir_all(&updates_dir);
    let target_path = updates_dir.join(&safe_name);

    emit_progress(app, "downloading", 20, format!("Downloading {safe_name}"));
    let resp = client
        .get(parsed_url)
        .send()
        .await
        .map_err(|e| format!("Failed downloading update: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_INSTALLER_BYTES {
            return Err("Update installer exceeds maximum allowed size".to_string());
        }
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed reading installer bytes: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_INSTALLER_BYTES {
        return Err("Downloaded installer payload is empty or oversized".to_string());
    }

    emit_progress(app, "verifying", 75, "Verifying SHA-256 checksum");
    if let Some(cs_asset) = pick_checksum_asset(&release.assets) {
        if let Ok(cs_url) = reqwest::Url::parse(&cs_asset.browser_download_url) {
            if cs_url.scheme() == "https" && is_allowed_github_host(cs_url.host_str()) {
                if let Ok(cs_resp) = client.get(cs_url).send().await {
                    if cs_resp.status().is_success() {
                        if let Ok(cs_text) = cs_resp.text().await {
                            let expected_hash = cs_text.lines().find_map(|line| {
                                let mut cols = line.split_whitespace();
                                let hash = cols.next()?;
                                let file = cols.next()?;
                                let file_name = Path::new(file.trim_start_matches('*'))
                                    .file_name()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or(file);
                                if file_name.eq_ignore_ascii_case(&asset.name) {
                                    Some(hash.to_ascii_lowercase())
                                } else {
                                    None
                                }
                            });
                            if let Some(expected) = expected_hash {
                                let actual = format!("{:x}", Sha256::digest(&bytes));
                                if actual != expected {
                                    return Err("Checksum verification failed for downloaded update".to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fs::write(&target_path, &bytes).map_err(|e| format!("Failed writing update file: {e}"))?;

    emit_progress(app, "installing", 95, "Launching installer");
    launch_installer(&target_path)?;
    Ok(())
}

fn launch_installer(installer_path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new(installer_path)
            .spawn()
            .map_err(|e| format!("Failed launching installer: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let lower = installer_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if lower.ends_with(".appimage") {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(installer_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(installer_path, perms).map_err(|e| e.to_string())?;
            Command::new(installer_path)
                .spawn()
                .map_err(|e| format!("Failed launching AppImage: {e}"))?;
        } else {
            Command::new("xdg-open")
                .arg(installer_path)
                .spawn()
                .map_err(|e| format!("Failed opening package installer: {e}"))?;
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = installer_path;
        Err("Auto-install is unsupported on this OS".to_string())
    }
}
