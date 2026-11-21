use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use regex::Regex;
use serde::Deserialize;

use crate::models::{LyricLine, LyricsData, WordTimestamp};

const MAX_LYRICS_CACHE_FILES: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibApiItem {
    id: Option<u64>,
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f64>,
    has_word_sync: Option<bool>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
    lyricsfile: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LyricsFileDoc {
    lines: Option<Vec<LyricsFileLine>>,
}

#[derive(Debug, Deserialize)]
struct LyricsFileLine {
    text: Option<String>,
    start_ms: Option<f64>,
    end_ms: Option<f64>,
    words: Option<Vec<LyricsFileWord>>,
}

#[derive(Debug, Deserialize)]
struct LyricsFileWord {
    text: Option<String>,
    start_ms: Option<f64>,
}

pub struct LyricsFetcher {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl LyricsFetcher {
    pub fn new(base_cache_dir: &Path) -> Self {
        let cache_dir = base_cache_dir.join("lyrics");
        let _ = fs::create_dir_all(&cache_dir);
        let client = reqwest::Client::builder()
            .user_agent("ConstellationSuite/3.0 (https://github.com/nathanael/constellation-lyrics)")
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client, cache_dir }
    }

    pub fn sanitize_title(title: &str) -> String {
        static PAREN_RE: OnceLock<Regex> = OnceLock::new();
        static BRACKET_RE: OnceLock<Regex> = OnceLock::new();
        static FEAT_RE: OnceLock<Regex> = OnceLock::new();
        static TRAILING_RE: OnceLock<Regex> = OnceLock::new();
        static WS_RE: OnceLock<Regex> = OnceLock::new();

        if title.trim().is_empty() {
            return String::new();
        }

        let p_re = PAREN_RE.get_or_init(|| {
            Regex::new(r"(?i)[\(（][^\)）]*(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe|version|clip|mv|hd|4k)[^\)）]*[\)）]").unwrap()
        });
        let b_re = BRACKET_RE.get_or_init(|| {
            Regex::new(r"(?i)\[[^\]]*(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe|version|clip|mv|hd|4k)[^\]]*\]").unwrap()
        });
        let feat_re = FEAT_RE.get_or_init(|| {
            Regex::new(r"(?i)\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$").unwrap()
        });
        let t_re = TRAILING_RE.get_or_init(|| {
            Regex::new(r"(?i)\s*-\s*(official|audio|video|lyrics?|remastered|music\s*video|visualizer).*$").unwrap()
        });
        let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

        let s1 = p_re.replace_all(title, "");
        let s2 = b_re.replace_all(&s1, "");
        let s3 = feat_re.replace_all(&s2, "");
        let s4 = t_re.replace_all(&s3, "");
        let cleaned = ws_re.replace_all(&s4, " ").trim().to_string();
        if cleaned.is_empty() {
            title.trim().to_string()
        } else {
            cleaned
        }
    }

    pub fn extract_artists(artist: &str) -> Vec<String> {
        static SPLIT_RE: OnceLock<Regex> = OnceLock::new();
        if artist.trim().is_empty() {
            return Vec::new();
        }
        let re = SPLIT_RE
            .get_or_init(|| Regex::new(r"(?i)[,&]|\s+(?:dan|and|feat\.?|ft\.?)\s+").unwrap());
        let cleaned: Vec<String> = re
            .split(artist)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .collect();

        let mut results = Vec::new();
        if let Some(first) = cleaned.first() {
            results.push(first.clone());
        }
        let trimmed_orig = artist.trim().to_string();
        if !trimmed_orig.is_empty() && !results.contains(&trimmed_orig) {
            results.push(trimmed_orig);
        }
        results
    }

    fn cache_path(&self, artist: &str, title: &str, duration: f64) -> PathBuf {
        let key = format!(
            "{}_{}_{}",
            artist.to_ascii_lowercase().trim(),
            title.to_ascii_lowercase().trim(),
            duration.round() as i64
        );
        let hash = format!("{:x}", md5::compute(key.as_bytes()));
        self.cache_dir.join(format!("{hash}.json"))
    }

    pub fn invalidate_cache(&self, title: &str, artist: &str, duration: f64) {
        let clean_title = Self::sanitize_title(title);
        let artists = Self::extract_artists(artist);
        let primary = artists.first().map(String::as_str).unwrap_or("");
        let path = self.cache_path(primary, &clean_title, duration);
        let _ = fs::remove_file(path);
    }

    pub async fn fetch(
        &self,
        title: &str,
        artist: &str,
        _album: &str,
        duration: f64,
    ) -> LyricsData {
        let clean_title = Self::sanitize_title(title);
        if clean_title.is_empty() {
            return LyricsData::default();
        }

        let mut artist_candidates = Self::extract_artists(artist);
        if artist_candidates.is_empty() {
            artist_candidates.push(String::new());
        }

        let mut candidate_titles = vec![clean_title.clone()];
        if clean_title.contains(" - ") {
            let parts: Vec<&str> = clean_title.splitn(2, " - ").collect();
            if parts.len() == 2 {
                let sub = parts[1].trim().to_string();
                if !sub.is_empty() && !candidate_titles.contains(&sub) {
                    candidate_titles.push(sub);
                }
            }
        }

        let cache_file = self.cache_path(&artist_candidates[0], &clean_title, duration);
        if let Ok(raw) = fs::read_to_string(&cache_file) {
            if let Ok(cached) = serde_json::from_str::<LyricsData>(&raw) {
                return cached;
            }
        }

        let mut queries = Vec::new();
        for t in &candidate_titles {
            let q1 = format!("{} {}", artist_candidates[0], t).trim().to_string();
            if !q1.is_empty() && !queries.contains(&q1) {
                queries.push(q1);
            }
            if !t.is_empty() && !queries.contains(t) {
                queries.push(t.clone());
            }
        }

        let mut best_cand_id: Option<u64> = None;
        let mut best_score = f64::NEG_INFINITY;
        let mut best_fallback_plain: Option<LrcLibApiItem> = None;

        for query in &queries {
            if query.is_empty() {
                continue;
            }
            let Ok(resp) = self
                .client
                .get("https://lrclib.net/api/search")
                .query(&[("q", query.as_str())])
                .send()
                .await
            else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(results) = resp.json::<Vec<LrcLibApiItem>>().await else {
                continue;
            };

            for item in results {
                let has_synced = item
                    .synced_lyrics
                    .as_deref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
                    || item
                        .lyricsfile
                        .as_deref()
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);

                if !has_synced {
                    let has_plain = item
                        .plain_lyrics
                        .as_deref()
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    if has_plain && best_fallback_plain.is_none() {
                        best_fallback_plain = Some(item);
                    }
                    continue;
                }

                for t in &candidate_titles {
                    let cand_score = score_lrclib_candidate(
                        &item,
                        t,
                        &artist_candidates[0],
                        duration,
                    );
                    if cand_score > best_score {
                        best_score = cand_score;
                        best_cand_id = item.id;
                    }
                }
            }

            if best_cand_id.is_some() && best_score >= 420.0 {
                break;
            }
        }

        let mut full_payload: Option<LrcLibApiItem> = None;

        if let Some(id) = best_cand_id {
            let url = format!("https://lrclib.net/api/get/{id}");
            if let Ok(resp) = self.client.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(item) = resp.json::<LrcLibApiItem>().await {
                        full_payload = Some(item);
                    }
                }
            }
        }

        if full_payload.is_none() {
            'fallback_loop: for t in &candidate_titles {
                for cand_artist in &artist_candidates {
                    // Try with duration first
                    let mut req = self.client.get("https://lrclib.net/api/get").query(&[
                        ("track_name", t.as_str()),
                        ("artist_name", cand_artist.as_str()),
                    ]);
                    if duration > 0.0 {
                        let dur_str = (duration.round() as i64).to_string();
                        req = req.query(&[("duration", dur_str.as_str())]);
                    }
                    if let Ok(resp) = req.send().await {
                        if resp.status().is_success() {
                            if let Ok(item) = resp.json::<LrcLibApiItem>().await {
                                let has_sync = item
                                    .synced_lyrics
                                    .as_deref()
                                    .map(|s| !s.trim().is_empty())
                                    .unwrap_or(false)
                                    || item
                                        .lyricsfile
                                        .as_deref()
                                        .map(|s| !s.trim().is_empty())
                                        .unwrap_or(false);
                                if has_sync {
                                    full_payload = Some(item);
                                    break 'fallback_loop;
                                }
                                if best_fallback_plain.is_none() && item.plain_lyrics.is_some() {
                                    best_fallback_plain = Some(item);
                                }
                            }
                        }
                    }

                    // Try without duration if not found (covers YouTube Music intro/outro length differences)
                    if duration > 0.0 {
                        let req_no_dur = self.client.get("https://lrclib.net/api/get").query(&[
                            ("track_name", t.as_str()),
                            ("artist_name", cand_artist.as_str()),
                        ]);
                        if let Ok(resp) = req_no_dur.send().await {
                            if resp.status().is_success() {
                                if let Ok(item) = resp.json::<LrcLibApiItem>().await {
                                    let has_sync = item
                                        .synced_lyrics
                                        .as_deref()
                                        .map(|s| !s.trim().is_empty())
                                        .unwrap_or(false)
                                        || item
                                            .lyricsfile
                                            .as_deref()
                                            .map(|s| !s.trim().is_empty())
                                            .unwrap_or(false);
                                    if has_sync {
                                        full_payload = Some(item);
                                        break 'fallback_loop;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if full_payload.is_none() {
            full_payload = best_fallback_plain;
        }

        let parsed = parse_payload(full_payload.as_ref(), &clean_title, artist);
        if let Ok(json_str) = serde_json::to_string_pretty(&parsed) {
            let _ = fs::write(&cache_file, json_str);
            prune_lyrics_cache(&self.cache_dir, MAX_LYRICS_CACHE_FILES);
        }

        parsed
    }
}

fn score_lrclib_candidate(
    item: &LrcLibApiItem,
    clean_title: &str,
    primary_artist: &str,
    duration: f64,
) -> f64 {
    let mut score = 0.0;
    if item
        .synced_lyrics
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
        || item
            .lyricsfile
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    {
        score += 250.0;
    }
    if item.has_word_sync == Some(true) {
        score += 150.0;
    }

    let cand_title = item
        .track_name
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let cand_artist = item
        .artist_name
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let norm_title = clean_title.to_ascii_lowercase();
    let norm_artist = primary_artist.to_ascii_lowercase();

    if !norm_title.is_empty() {
        if cand_title == norm_title {
            score += 220.0;
        } else if cand_title.contains(&norm_title) || norm_title.contains(&cand_title) {
            score += 120.0;
        }
    }
    if !norm_artist.is_empty() {
        if cand_artist == norm_artist {
            score += 180.0;
        } else if cand_artist.contains(&norm_artist) || norm_artist.contains(&cand_artist) {
            score += 90.0;
        }
    }

    if duration > 0.0 {
        if let Some(cand_dur) = item.duration {
            if cand_dur > 0.0 {
                let diff = (cand_dur - duration).abs();
                if diff < 3.0 {
                    score += 120.0;
                } else if diff < 8.0 {
                    score += 60.0;
                } else if diff < 20.0 {
                    score -= diff * 2.0;
                } else {
                    score -= 40.0 + (diff - 20.0).min(30.0) * 1.5;
                }
            }
        }
    }

    score
}

fn parse_payload(payload: Option<&LrcLibApiItem>, title: &str, artist: &str) -> LyricsData {
    let Some(item) = payload else {
        return LyricsData {
            title: title.to_string(),
            artist: artist.to_string(),
            has_synced: false,
            has_word_sync: false,
            source: "none".to_string(),
            plain: None,
            lines: Vec::new(),
        };
    };

    let res_title = item
        .track_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(title)
        .to_string();
    let res_artist = item
        .artist_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(artist)
        .to_string();

    if let Some(raw_yaml) = item.lyricsfile.as_deref() {
        if !raw_yaml.trim().is_empty() {
            let parsed_lines = parse_lyricsfile_yaml(raw_yaml);
            if !parsed_lines.is_empty() {
                return LyricsData {
                    title: res_title,
                    artist: res_artist,
                    has_synced: true,
                    has_word_sync: true,
                    source: "lrclib_word".to_string(),
                    plain: item.plain_lyrics.clone(),
                    lines: parsed_lines,
                };
            }
        }
    }

    let synced_lrc = item.synced_lyrics.as_deref().unwrap_or("");
    let plain_lyrics = item
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);

    if synced_lrc.trim().is_empty() {
        let source = if plain_lyrics.is_some() {
            "plain".to_string()
        } else {
            "none".to_string()
        };
        return LyricsData {
            title: res_title,
            artist: res_artist,
            has_synced: false,
            has_word_sync: false,
            source,
            plain: plain_lyrics,
            lines: Vec::new(),
        };
    }

    let (lines, had_enhanced_tags) = parse_lrc(synced_lrc);
    let has_synced = !lines.is_empty();
    let source = if has_synced {
        if had_enhanced_tags {
            "lrclib_word".to_string()
        } else {
            "lrclib_lrc".to_string()
        }
    } else if plain_lyrics.is_some() {
        "plain".to_string()
    } else {
        "none".to_string()
    };

    LyricsData {
        title: res_title,
        artist: res_artist,
        has_synced,
        has_word_sync: had_enhanced_tags,
        source,
        plain: plain_lyrics,
        lines,
    }
}

fn parse_lyricsfile_yaml(raw_yaml: &str) -> Vec<LyricLine> {
    static PAREN_STRIP: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();

    let Ok(doc) = serde_yaml::from_str::<LyricsFileDoc>(raw_yaml) else {
        return Vec::new();
    };
    let Some(raw_lines) = doc.lines else {
        return Vec::new();
    };

    let p_re = PAREN_STRIP
        .get_or_init(|| Regex::new(r"[\(（\[][^\)）\]]*[\)）\]][,\s]*").unwrap());
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

    let mut lines = Vec::new();
    for (idx, raw_line) in raw_lines.into_iter().enumerate() {
        let line_text_raw = raw_line.text.unwrap_or_default();
        let step1 = p_re.replace_all(line_text_raw.trim(), " ");
        let clean_line_text = ws_re.replace_all(&step1, " ").trim().to_string();

        let start_ms = raw_line.start_ms.unwrap_or(0.0);
        let end_ms = raw_line.end_ms.unwrap_or(start_ms + 3000.0);
        let start_sec = start_ms / 1000.0;
        let end_sec = end_ms / 1000.0;

        let raw_words = raw_line.words.unwrap_or_default();
        let mut words = Vec::new();
        let mut in_parens = false;

        for w_idx in 0..raw_words.len() {
            let w_text = raw_words[w_idx].text.as_deref().unwrap_or("").trim();
            if w_text.is_empty() {
                continue;
            }
            let has_open = w_text.contains('(') || w_text.contains('（') || w_text.contains('[');
            let has_close = w_text.contains(')') || w_text.contains('）') || w_text.contains(']');
            if has_open && has_close {
                continue;
            } else if has_open {
                in_parens = true;
                continue;
            } else if in_parens {
                if has_close {
                    in_parens = false;
                }
                continue;
            } else if has_close {
                continue;
            }

            if is_punct_only(w_text) {
                continue;
            }

            let w_start = raw_words[w_idx].start_ms.unwrap_or(0.0) / 1000.0;
            let w_end = if w_idx + 1 < raw_words.len() {
                raw_words[w_idx + 1].start_ms.unwrap_or(0.0) / 1000.0
            } else {
                end_sec
            };

            words.push(WordTimestamp {
                word: w_text.to_string(),
                start: round3(w_start),
                end: round3(w_end.max(w_start + 0.1)),
            });
        }

        if !words.is_empty() {
            lines.push(LyricLine {
                line_index: idx,
                text: clean_line_text,
                start_time: round3(start_sec),
                end_time: round3(end_sec),
                words,
            });
        }
    }
    lines
}

fn parse_lrc(lrc_text: &str) -> (Vec<LyricLine>, bool) {
    static LINE_TAG_RE: OnceLock<Regex> = OnceLock::new();
    static WORD_TAG_RE: OnceLock<Regex> = OnceLock::new();
    static PAREN_STRIP: OnceLock<Regex> = OnceLock::new();
    static ANGLE_TAG_STRIP: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();

    let tag_re = LINE_TAG_RE.get_or_init(|| Regex::new(r"\[(\d+:\d+(?:\.\d+)?)\]").unwrap());
    let word_re =
        WORD_TAG_RE.get_or_init(|| Regex::new(r"<(\d+:\d+(?:\.\d+)?)>\s*([^<]+)").unwrap());
    let p_re = PAREN_STRIP
        .get_or_init(|| Regex::new(r"[\(（\[][^\)）\]]*[\)）\]][,\s]*").unwrap());
    let angle_re = ANGLE_TAG_STRIP.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

    struct RawLrcItem {
        start_time: f64,
        raw_content: String,
    }

    let mut parsed_raw: Vec<RawLrcItem> = Vec::new();
    for raw_line in lrc_text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut timestamps = Vec::new();
        let mut last_end = 0usize;
        for cap in tag_re.captures_iter(trimmed) {
            if let Some(m) = cap.get(0) {
                last_end = m.end();
            }
            if let Some(ts) = cap.get(1) {
                timestamps.push(parse_timestamp(ts.as_str()));
            }
        }
        if timestamps.is_empty() {
            continue;
        }
        let content = trimmed[last_end..].trim();
        if content.is_empty() {
            continue;
        }
        for ts in timestamps {
            parsed_raw.push(RawLrcItem {
                start_time: ts,
                raw_content: content.to_string(),
            });
        }
    }

    parsed_raw.sort_by(|a, b| {
        a.start_time
            .partial_cmp(&b.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut line_rates = Vec::new();
    for i in 0..parsed_raw.len().saturating_sub(1) {
        let gap = parsed_raw[i + 1].start_time - parsed_raw[i].start_time;
        if (0.6..=6.5).contains(&gap) {
            let s1 = p_re.replace_all(&parsed_raw[i].raw_content, " ");
            let s2 = angle_re.replace_all(&s1, "");
            let toks: Vec<&str> = s2
                .split_whitespace()
                .filter(|t| {
                    !t.contains('(')
                        && !t.contains(')')
                        && !t.contains('（')
                        && !t.contains('）')
                        && !t.contains('[')
                        && !t.contains(']')
                        && !is_punct_only(t)
                })
                .collect();
            if !toks.is_empty() {
                let syls: usize = toks.iter().map(|t| count_syllables(t)).sum();
                line_rates.push((syls as f64) / gap);
            }
        }
    }

    let median_rate = if line_rates.is_empty() {
        3.2
    } else {
        line_rates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        line_rates[line_rates.len() / 2]
    };

    let song_sec_per_syl: f64 = if median_rate < 2.3 {
        0.36
    } else if median_rate < 3.4 {
        0.28
    } else if median_rate < 4.6 {
        0.21
    } else {
        0.16
    };

    let mut lines = Vec::new();
    let mut had_enhanced_tags = false;

    for i in 0..parsed_raw.len() {
        let start_time = parsed_raw[i].start_time;
        let gap_to_next = if i + 1 < parsed_raw.len() {
            (parsed_raw[i + 1].start_time - start_time).max(0.5)
        } else {
            4.0
        };

        let s1 = p_re.replace_all(&parsed_raw[i].raw_content, " ");
        let clean_raw = ws_re.replace_all(&s1, " ").trim().to_string();

        let tagged_matches: Vec<(String, String)> = word_re
            .captures_iter(&clean_raw)
            .filter_map(|cap| {
                let ts = cap.get(1)?.as_str().to_string();
                let txt = cap.get(2)?.as_str().trim().to_string();
                Some((ts, txt))
            })
            .collect();

        if tagged_matches.len() >= 2 {
            let mut words = Vec::new();
            for w_idx in 0..tagged_matches.len() {
                let clean_w = tagged_matches[w_idx].1.trim();
                if clean_w.is_empty()
                    || clean_w.contains('(')
                    || clean_w.contains(')')
                    || clean_w.contains('（')
                    || clean_w.contains('）')
                    || clean_w.contains('[')
                    || clean_w.contains(']')
                    || is_punct_only(clean_w)
                {
                    continue;
                }
                let w_start = parse_timestamp(&tagged_matches[w_idx].0);
                let w_end = if w_idx + 1 < tagged_matches.len() {
                    parse_timestamp(&tagged_matches[w_idx + 1].0)
                } else {
                    start_time + gap_to_next
                };
                words.push(WordTimestamp {
                    word: clean_w.to_string(),
                    start: round3(w_start),
                    end: round3(w_end.max(w_start + 0.1)),
                });
            }
            if !words.is_empty() {
                had_enhanced_tags = true;
                let line_txt = ws_re
                    .replace_all(&angle_re.replace_all(&clean_raw, ""), " ")
                    .trim()
                    .to_string();
                lines.push(LyricLine {
                    line_index: lines.len(),
                    text: line_txt,
                    start_time,
                    end_time: start_time + gap_to_next,
                    words,
                });
                continue;
            }
        }

        let s2 = angle_re.replace_all(&clean_raw, "");
        let clean_text = ws_re.replace_all(&s2, " ").trim().to_string();
        let tokens: Vec<&str> = clean_text
            .split_whitespace()
            .filter(|t| {
                !t.contains('(')
                    && !t.contains(')')
                    && !t.contains('（')
                    && !t.contains('）')
                    && !t.contains('[')
                    && !t.contains(']')
                    && !is_punct_only(t)
            })
            .collect();
        if tokens.is_empty() {
            continue;
        }

        let syllable_counts: Vec<usize> = tokens.iter().map(|t| count_syllables(t)).collect();
        let total_syllables: usize = syllable_counts.iter().sum::<usize>().max(1);

        let mut local_sec_per_syl = song_sec_per_syl;
        if gap_to_next > 0.5 {
            let line_tempo = (total_syllables as f64) / gap_to_next;
            if line_tempo > 3.6 {
                local_sec_per_syl = (gap_to_next * 0.88) / (total_syllables as f64);
            } else if line_tempo < 1.8 && song_sec_per_syl < 0.32 {
                local_sec_per_syl = 0.32;
            }
        }

        let estimated_dur = (total_syllables as f64) * local_sec_per_syl;
        let max_vocal_window = (gap_to_next * 0.88).min((gap_to_next - 0.20).max(0.6));
        let min_vocal_window = (gap_to_next * 0.55).min(1.2);
        let vocal_dur = estimated_dur.clamp(min_vocal_window, max_vocal_window);

        let mut words = Vec::with_capacity(tokens.len());
        let mut curr_t = start_time;
        for (tok, syl) in tokens.into_iter().zip(syllable_counts.into_iter()) {
            let w_dur = ((syl as f64) / (total_syllables as f64) * vocal_dur).max(0.12);
            words.push(WordTimestamp {
                word: tok.to_string(),
                start: round3(curr_t),
                end: round3(curr_t + w_dur),
            });
            curr_t += w_dur;
        }

        lines.push(LyricLine {
            line_index: lines.len(),
            text: clean_text,
            start_time,
            end_time: start_time + gap_to_next,
            words,
        });
    }

    (lines, had_enhanced_tags)
}

fn parse_timestamp(ts_str: &str) -> f64 {
    let mut parts = ts_str.trim().split(':');
    let Some(m_str) = parts.next() else {
        return 0.0;
    };
    let Some(s_str) = parts.next() else {
        return 0.0;
    };
    if parts.next().is_some() {
        return 0.0;
    }
    let m: f64 = m_str.parse().unwrap_or(0.0);
    let s: f64 = s_str.parse().unwrap_or(0.0);
    m * 60.0 + s
}

fn count_syllables(tok: &str) -> usize {
    static VOWEL_RUN_RE: OnceLock<Regex> = OnceLock::new();
    let re = VOWEL_RUN_RE.get_or_init(|| Regex::new(r"[aeiouy]+").unwrap());
    let trimmed = tok
        .to_ascii_lowercase()
        .trim_matches(|c: char| ".,!?:;'\"-()[]{}".contains(c))
        .to_string();
    re.find_iter(&trimmed).count().max(1)
}

fn is_punct_only(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| ",.?!:;".contains(c))
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn prune_lyrics_cache(dir: &Path, max_files: usize) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = read_dir
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let mtime = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                Some((mtime, path))
            } else {
                None
            }
        })
        .collect();
    if files.len() <= max_files {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let to_remove = files.len() - max_files;
    for (_, path) in files.into_iter().take(to_remove) {
        let _ = fs::remove_file(path);
    }
}
