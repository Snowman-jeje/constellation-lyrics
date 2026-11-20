use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use regex::Regex;
use serde::Deserialize;

use crate::models::ColorPalette;

const MAX_CACHE_ENTRIES: usize = 64;
const MAX_DOWNLOAD_BYTES: usize = 15 * 1024 * 1024;
const MIN_PREFERRED_PX: u32 = 500;
const TARGET_MIN_PX: u32 = 720;
const MAX_UPSCALE_DIM: u32 = 1440;

#[derive(Debug, Clone, Default)]
pub struct ResolvedCover {
    pub art_data_url: Option<String>,
    pub palette: ColorPalette,
    pub art_key: String,
}

pub struct CoverResolver {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl CoverResolver {
    pub fn new(base_cache_dir: &Path) -> Self {
        let cache_dir = base_cache_dir.join("covers");
        let _ = fs::create_dir_all(&cache_dir);
        let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 4 {
                return attempt.stop();
            }
            let url = attempt.url();
            if url.scheme() != "https" || !is_safe_url_host(url.host_str()) {
                return attempt.stop();
            }
            attempt.follow()
        });
        let client = reqwest::Client::builder()
            .user_agent("ConstellationSuite/3.0 (https://github.com/nathanael/constellation-lyrics)")
            .redirect(redirect_policy)
            .timeout(Duration::from_secs(4))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client, cache_dir }
    }

    pub async fn resolve(
        &self,
        title: &str,
        artist: &str,
        album: &str,
        art_url: &str,
        raw_art_bytes: &[u8],
    ) -> ResolvedCover {
        let clean_title = sanitize_query_title(title);
        let clean_artist = primary_artist(artist);
        if clean_title.is_empty() && clean_artist.is_empty() && raw_art_bytes.is_empty() && art_url.is_empty() {
            return ResolvedCover::default();
        }

        let sig_input = format!(
            "{}::{}::{}::{}",
            clean_artist.to_ascii_lowercase(),
            clean_title.to_ascii_lowercase(),
            album.trim().to_ascii_lowercase(),
            if !art_url.is_empty() {
                art_url.to_string()
            } else if !raw_art_bytes.is_empty() {
                let sample = &raw_art_bytes[..raw_art_bytes.len().min(256)];
                format!("{:x}_{}", md5::compute(sample), raw_art_bytes.len())
            } else {
                "none".to_string()
            }
        );
        let art_key = format!("{:x}", md5::compute(sig_input.as_bytes()));

        if let Some(cached) = self.load_from_cache(&art_key) {
            return cached;
        }

        let mut candidate_img = self.decode_source_image(art_url, raw_art_bytes).await;
        let needs_higher_res = match &candidate_img {
            None => true,
            Some(img) => img.width().min(img.height()) < MIN_PREFERRED_PX,
        };

        if needs_higher_res && (!clean_title.is_empty() || !clean_artist.is_empty()) {
            if let Some(fallback_img) = self
                .fetch_remote_fallback(&clean_title, &clean_artist, album)
                .await
            {
                let take_fallback = match &candidate_img {
                    None => true,
                    Some(existing) => {
                        fallback_img.width().min(fallback_img.height())
                            > existing.width().min(existing.height())
                    }
                };
                if take_fallback {
                    candidate_img = Some(fallback_img);
                }
            }
        }

        let Some(img) = candidate_img else {
            return ResolvedCover::default();
        };

        let upscaled = upscale_if_needed(img);
        let palette = extract_palette(&upscaled);
        let Some(jpeg_bytes) = encode_jpeg(&upscaled) else {
            return ResolvedCover::default();
        };

        let data_url = format!("data:image/jpeg;base64,{}", BASE64.encode(&jpeg_bytes));
        self.save_to_cache(&art_key, &jpeg_bytes, palette);

        ResolvedCover {
            art_data_url: Some(data_url),
            palette,
            art_key,
        }
    }

    async fn decode_source_image(
        &self,
        art_url: &str,
        raw_art_bytes: &[u8],
    ) -> Option<DynamicImage> {
        if !raw_art_bytes.is_empty() && raw_art_bytes.len() <= MAX_DOWNLOAD_BYTES {
            if let Ok(img) = image::load_from_memory(raw_art_bytes) {
                return Some(img);
            }
        }

        let trimmed = art_url.trim();
        if trimmed.is_empty() {
            return None;
        }

        if let Some(path) = parse_file_uri(trimmed) {
            if let Ok(bytes) = read_bounded_local_file(&path) {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    return Some(img);
                }
            }
            return None;
        }

        if Path::new(trimmed).is_absolute() {
            if let Ok(bytes) = read_bounded_local_file(Path::new(trimmed)) {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    return Some(img);
                }
            }
            return None;
        }

        if trimmed.starts_with("https://") {
            if let Some(bytes) = self.download_image_bytes(trimmed).await {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    return Some(img);
                }
            }
        }

        None
    }

    async fn fetch_remote_fallback(
        &self,
        title: &str,
        artist: &str,
        album: &str,
    ) -> Option<DynamicImage> {
        if let Some(img) = self.try_itunes(title, artist).await {
            return Some(img);
        }
        if let Some(img) = self.try_deezer(title, artist).await {
            return Some(img);
        }
        self.try_musicbrainz(title, artist, album).await
    }

    async fn try_itunes(&self, title: &str, artist: &str) -> Option<DynamicImage> {
        #[derive(Deserialize)]
        struct ItunesResp {
            results: Vec<ItunesItem>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ItunesItem {
            artwork_url100: Option<String>,
            track_name: Option<String>,
            artist_name: Option<String>,
        }

        let term = format!("{artist} {title}").trim().to_string();
        if term.is_empty() {
            return None;
        }

        let resp = self
            .client
            .get("https://itunes.apple.com/search")
            .query(&[
                ("term", term.as_str()),
                ("entity", "song"),
                ("limit", "5"),
            ])
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let body: ItunesResp = resp.json().await.ok()?;
        let norm_title = title.to_ascii_lowercase();
        let norm_artist = artist.to_ascii_lowercase();

        let best = body.results.into_iter().max_by_key(|item| {
            let mut s = 0i32;
            let t = item.track_name.as_deref().unwrap_or("").to_ascii_lowercase();
            let a = item.artist_name.as_deref().unwrap_or("").to_ascii_lowercase();
            if !norm_title.is_empty() && (t == norm_title || t.contains(&norm_title)) {
                s += 10;
            }
            if !norm_artist.is_empty() && (a == norm_artist || a.contains(&norm_artist)) {
                s += 10;
            }
            if item.artwork_url100.is_some() {
                s += 5;
            }
            s
        })?;

        let raw_url = best.artwork_url100?;
        let hi_res = raw_url
            .replace("100x100bb", "1000x1000bb")
            .replace("60x60bb", "1000x1000bb")
            .replace("30x30bb", "1000x1000bb");

        let bytes = self.download_image_bytes(&hi_res).await?;
        image::load_from_memory(&bytes).ok()
    }

    async fn try_deezer(&self, title: &str, artist: &str) -> Option<DynamicImage> {
        #[derive(Deserialize)]
        struct DeezerResp {
            data: Option<Vec<DeezerItem>>,
        }
        #[derive(Deserialize)]
        struct DeezerItem {
            title: Option<String>,
            artist: Option<DeezerArtist>,
            album: Option<DeezerAlbum>,
        }
        #[derive(Deserialize)]
        struct DeezerArtist {
            name: Option<String>,
        }
        #[derive(Deserialize)]
        struct DeezerAlbum {
            cover_xl: Option<String>,
            cover_big: Option<String>,
        }

        let q = format!("{artist} {title}").trim().to_string();
        if q.is_empty() {
            return None;
        }

        let resp = self
            .client
            .get("https://api.deezer.com/search")
            .query(&[("q", q.as_str()), ("limit", "5")])
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let body: DeezerResp = resp.json().await.ok()?;
        let items = body.data?;
        let norm_title = title.to_ascii_lowercase();
        let norm_artist = artist.to_ascii_lowercase();

        let best = items.into_iter().max_by_key(|item| {
            let mut s = 0i32;
            let t = item.title.as_deref().unwrap_or("").to_ascii_lowercase();
            let a = item
                .artist
                .as_ref()
                .and_then(|x| x.name.as_deref())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !norm_title.is_empty() && (t == norm_title || t.contains(&norm_title)) {
                s += 10;
            }
            if !norm_artist.is_empty() && (a == norm_artist || a.contains(&norm_artist)) {
                s += 10;
            }
            s
        })?;

        let album = best.album?;
        let url = album.cover_xl.or(album.cover_big)?;
        let bytes = self.download_image_bytes(&url).await?;
        image::load_from_memory(&bytes).ok()
    }

    async fn try_musicbrainz(
        &self,
        title: &str,
        artist: &str,
        album: &str,
    ) -> Option<DynamicImage> {
        #[derive(Deserialize)]
        struct MbResp {
            recordings: Option<Vec<MbRecording>>,
        }
        #[derive(Deserialize)]
        struct MbRecording {
            releases: Option<Vec<MbRelease>>,
        }
        #[derive(Deserialize)]
        struct MbRelease {
            id: Option<String>,
        }

        if title.is_empty() {
            return None;
        }

        let query = if !artist.is_empty() {
            format!("recording:\"{title}\" AND artist:\"{artist}\"")
        } else if !album.is_empty() {
            format!("recording:\"{title}\" AND release:\"{album}\"")
        } else {
            format!("recording:\"{title}\"")
        };

        let resp = self
            .client
            .get("https://musicbrainz.org/ws/2/recording/")
            .query(&[("query", query.as_str()), ("fmt", "json"), ("limit", "3")])
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let body: MbResp = resp.json().await.ok()?;
        let recordings = body.recordings?;
        for rec in recordings {
            if let Some(releases) = rec.releases {
                for rel in releases.into_iter().take(2) {
                    if let Some(mbid) = rel.id {
                        let clean_id: String = mbid
                            .chars()
                            .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                            .collect();
                        if clean_id.len() >= 16 {
                            let caa_url =
                                format!("https://coverartarchive.org/release/{clean_id}/front-500");
                            if let Some(bytes) = self.download_image_bytes(&caa_url).await {
                                if let Ok(img) = image::load_from_memory(&bytes) {
                                    return Some(img);
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    async fn download_image_bytes(&self, url: &str) -> Option<Vec<u8>> {
        let parsed = reqwest::Url::parse(url).ok()?;
        if parsed.scheme() != "https" || !is_safe_url_host(parsed.host_str()) {
            return None;
        }
        let host = parsed.host_str()?;
        let port = parsed.port_or_known_default().unwrap_or(443);
        if let Ok(addrs) = tokio::net::lookup_host((host, port)).await {
            for addr in addrs {
                if is_forbidden_ip(addr.ip()) {
                    return None;
                }
            }
        } else {
            return None;
        }
        let resp = self.client.get(parsed).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        if let Some(len) = resp.content_length() {
            if len as usize > MAX_DOWNLOAD_BYTES {
                return None;
            }
        }
        let bytes = resp.bytes().await.ok()?;
        if bytes.is_empty() || bytes.len() > MAX_DOWNLOAD_BYTES {
            return None;
        }
        Some(bytes.to_vec())
    }

    fn load_from_cache(&self, art_key: &str) -> Option<ResolvedCover> {
        let jpg_path = self.cache_dir.join(format!("{art_key}.jpg"));
        let rgb_path = self.cache_dir.join(format!("{art_key}.rgb.json"));
        let bytes = fs::read(&jpg_path).ok()?;
        if bytes.is_empty() {
            return None;
        }
        let palette = fs::read_to_string(&rgb_path)
            .ok()
            .and_then(|s| serde_json::from_str::<ColorPalette>(&s).ok())
            .unwrap_or_else(|| {
                image::load_from_memory(&bytes)
                    .map(|img| extract_palette(&img))
                    .unwrap_or_default()
            });
        let data_url = format!("data:image/jpeg;base64,{}", BASE64.encode(&bytes));
        Some(ResolvedCover {
            art_data_url: Some(data_url),
            palette,
            art_key: art_key.to_string(),
        })
    }

    fn save_to_cache(&self, art_key: &str, jpeg_bytes: &[u8], palette: ColorPalette) {
        let jpg_path = self.cache_dir.join(format!("{art_key}.jpg"));
        let rgb_path = self.cache_dir.join(format!("{art_key}.rgb.json"));
        let _ = fs::write(&jpg_path, jpeg_bytes);
        if let Ok(rgb_json) = serde_json::to_string(&palette) {
            let _ = fs::write(&rgb_path, rgb_json);
        }
        prune_cover_cache(&self.cache_dir, MAX_CACHE_ENTRIES);
    }
}

fn read_bounded_local_file(path: &Path) -> Result<Vec<u8>, ()> {
    let meta = fs::metadata(path).map_err(|_| ())?;
    if !meta.is_file() || meta.len() as usize > MAX_DOWNLOAD_BYTES {
        return Err(());
    }
    fs::read(path).map_err(|_| ())
}

fn upscale_if_needed(img: DynamicImage) -> DynamicImage {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return img;
    }
    let min_dim = w.min(h);
    if min_dim >= TARGET_MIN_PX {
        return img;
    }
    let scale = (TARGET_MIN_PX as f64) / (min_dim as f64);
    let mut new_w = ((w as f64) * scale).round() as u32;
    let mut new_h = ((h as f64) * scale).round() as u32;
    let max_dim = new_w.max(new_h);
    if max_dim > MAX_UPSCALE_DIM {
        let down = (MAX_UPSCALE_DIM as f64) / (max_dim as f64);
        new_w = ((new_w as f64) * down).round().max(1.0) as u32;
        new_h = ((new_h as f64) * down).round().max(1.0) as u32;
    }
    img.resize_exact(new_w.max(1), new_h.max(1), FilterType::Lanczos3)
}

pub fn extract_palette(img: &DynamicImage) -> ColorPalette {
    let small = img.resize_exact(48, 48, FilterType::Triangle).to_rgb8();
    let mut counts: HashMap<(u8, u8, u8), u32> = HashMap::new();

    for pixel in small.pixels() {
        // Light quantization reduces noise while keeping vibrant hues distinct
        let r = pixel[0] & 0xFC;
        let g = pixel[1] & 0xFC;
        let b = pixel[2] & 0xFC;
        *counts.entry((r, g, b)).or_insert(0) += 1;
    }

    let mut best = ColorPalette::default();
    let mut best_score = -1.0_f64;

    for ((r, g, b), count) in counts {
        let bright = (r as u32 + g as u32 + b as u32) / 3;
        if !(30..=235).contains(&bright) {
            continue;
        }
        let max_c = r.max(g).max(b) as f64;
        let min_c = r.min(g).min(b) as f64;
        let sat = if max_c > 0.0 {
            (max_c - min_c) / max_c
        } else {
            0.0
        };
        let score = sat * (count as f64).powf(0.6);
        if score > best_score {
            best_score = score;
            best = ColorPalette { r, g, b };
        }
    }

    best
}

fn encode_jpeg(img: &DynamicImage) -> Option<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out = Cursor::new(Vec::new());
    let mut enc = JpegEncoder::new_with_quality(&mut out, 88);
    enc.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    Some(out.into_inner())
}

fn prune_cover_cache(dir: &Path, max_entries: usize) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut jpgs: Vec<(SystemTime, PathBuf)> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jpg") {
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            jpgs.push((mtime, path));
        }
    }
    if jpgs.len() <= max_entries {
        return;
    }
    jpgs.sort_by_key(|(t, _)| *t);
    let to_remove = jpgs.len() - max_entries;
    for (_, path) in jpgs.into_iter().take(to_remove) {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            let rgb_path = dir.join(format!("{stem}.rgb.json"));
            let _ = fs::remove_file(&rgb_path);
        }
        let _ = fs::remove_file(path);
    }
}

fn sanitize_query_title(title: &str) -> String {
    static PAREN_RE: OnceLock<Regex> = OnceLock::new();
    static BRACKET_RE: OnceLock<Regex> = OnceLock::new();
    static TRAILING_RE: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();

    let p_re = PAREN_RE.get_or_init(|| {
        Regex::new(r"(?i)\([^)]*(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe)[^)]*\)").unwrap()
    });
    let b_re = BRACKET_RE.get_or_init(|| {
        Regex::new(r"(?i)\[[^\]]*(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe)[^\]]*\]").unwrap()
    });
    let t_re = TRAILING_RE.get_or_init(|| {
        Regex::new(r"(?i)\s*-\s*(official|audio|video|lyrics?|remastered).*$").unwrap()
    });
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

    let step1 = p_re.replace_all(title, "");
    let step2 = b_re.replace_all(&step1, "");
    let step3 = t_re.replace_all(&step2, "");
    let cleaned = ws_re.replace_all(&step3, " ").trim().to_string();
    if cleaned.is_empty() {
        title.trim().to_string()
    } else {
        cleaned
    }
}

fn primary_artist(artist: &str) -> String {
    static SPLIT_RE: OnceLock<Regex> = OnceLock::new();
    let re = SPLIT_RE
        .get_or_init(|| Regex::new(r"(?i)[,&]|\s+(?:dan|and|feat\.?|ft\.?)\s+").unwrap());
    re.split(artist)
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or_else(|| artist.trim())
        .to_string()
}

fn parse_file_uri(raw: &str) -> Option<PathBuf> {
    let parsed = reqwest::Url::parse(raw).ok()?;
    if parsed.scheme() != "file" {
        return None;
    }
    if let Ok(path) = parsed.to_file_path() {
        return Some(path);
    }
    let decoded = percent_decode(parsed.path());
    #[cfg(target_os = "windows")]
    {
        let trimmed = decoded.strip_prefix('/').unwrap_or(&decoded);
        let p = PathBuf::from(trimmed.replace('/', "\\"));
        return if p.is_absolute() { Some(p) } else { None };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let p = PathBuf::from(decoded);
        if p.is_absolute() { Some(p) } else { None }
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn is_safe_url_host(host: Option<&str>) -> bool {
    let Some(raw) = host else {
        return false;
    };
    let h = raw.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if h.is_empty()
        || h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".internal")
    {
        return false;
    }
    if let Ok(ip) = h.parse::<IpAddr>() {
        return !is_forbidden_ip(ip);
    }
    true
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_forbidden_ipv4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_forbidden_ipv4(mapped);
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xfe00) == 0xfc00
                || (seg0 & 0xffc0) == 0xfe80
        }
    }
}

fn is_forbidden_ipv4(ip: Ipv4Addr) -> bool {
    let oct = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (oct[0] == 100 && (oct[1] & 0xc0) == 64)
}
