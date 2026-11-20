"""
LRCLIB Synchronized Lyrics Client with Native 'lyricsfile' Word-Sync Engine.
Pulls official millisecond-accurate word timestamps (hasWordSync) from studio recordings.
"""

import os
import re
import json
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests
import yaml

CACHE_DIR = Path.home() / '.cache' / 'constellation-lyrics'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

class LyricsFetcher:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'ConstellationLyrics/3.0 (https://github.com/nathanael/constellation-lyrics)'
        })

    @staticmethod
    def sanitize_title(title: str) -> str:
        if not title:
            return ""
        t = re.sub(r'\(.*?(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe).*?\)', '', title, flags=re.IGNORECASE)
        t = re.sub(r'\[.*?(official|audio|video|lyrics?|feat\.?|ft\.?|remaster|visualizer|expanded|deluxe).*?\]', '', t, flags=re.IGNORECASE)
        t = re.sub(r'\s*-\s*(official|audio|video|lyrics?|remastered).*$', '', t, flags=re.IGNORECASE)
        t = re.sub(r'\s+', ' ', t).strip()
        return t or title

    @staticmethod
    def extract_artists(artist: str) -> List[str]:
        if not artist:
            return []
        parts = re.split(r'[,&]|\s+(?:dan|and|feat\.?|ft\.?)\s+', artist, flags=re.IGNORECASE)
        cleaned = [p.strip() for p in parts if p.strip()]
        results = []
        if cleaned:
            results.append(cleaned[0])
        if artist not in results:
            results.append(artist)
        return results

    def _get_cache_path(self, artist: str, title: str, duration: float) -> Path:
        key = f"{artist.lower().strip()}_{title.lower().strip()}_{round(duration)}"
        h = hashlib.md5(key.encode('utf-8')).hexdigest()
        return CACHE_DIR / f"{h}.json"

    def fetch(self, title: str, artist: str, album: str = "", duration: float = 0.0) -> Dict[str, Any]:
        clean_title = self.sanitize_title(title)
        if not clean_title:
            return {'title': '', 'artist': '', 'has_synced': False, 'lines': []}

        artist_candidates = self.extract_artists(artist)
        if not artist_candidates:
            artist_candidates = [""]

        cache_file = self._get_cache_path(artist_candidates[0], clean_title, duration)
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass

        full_payload = None

        # Strategy 1: Search and prioritize candidates that have hasWordSync=True matching duration!
        queries = [
            f"{artist_candidates[0]} {clean_title}".strip(),
            clean_title
        ]

        best_cand_id = None
        min_diff = 9999.0

        for q in queries:
            try:
                sr = self.session.get('https://lrclib.net/api/search', params={'q': q}, timeout=4)
                if sr.status_code == 200:
                    results = sr.json()
                    if results and isinstance(results, list):
                        # Filter for candidates with syncedLyrics
                        synced_results = [r for r in results if r.get('syncedLyrics')]
                        
                        # Prioritize candidates with hasWordSync
                        word_sync_results = [r for r in synced_results if r.get('hasWordSync')]
                        pool = word_sync_results if word_sync_results else synced_results

                        for item in pool:
                            cand_dur = float(item.get('duration') or 0.0)
                            diff = abs(cand_dur - duration) if (duration > 0 and cand_dur > 0) else 0.0
                            if diff < min_diff:
                                min_diff = diff
                                best_cand_id = item.get('id')
                if best_cand_id and min_diff < 3.0:
                    break
            except Exception:
                continue

        # Fetch the complete item by ID to get full lyricsfile
        if best_cand_id:
            try:
                gr = self.session.get(f'https://lrclib.net/api/get/{best_cand_id}', timeout=4)
                if gr.status_code == 200:
                    full_payload = gr.json()
            except Exception:
                pass

        # Strategy 2 Fallback: Direct GET
        if not full_payload:
            for cand_artist in artist_candidates:
                params = {
                    'track_name': clean_title,
                    'artist_name': cand_artist
                }
                if duration > 0:
                    params['duration'] = round(duration)
                try:
                    r = self.session.get('https://lrclib.net/api/get', params=params, timeout=4)
                    if r.status_code == 200:
                        cand = r.json()
                        if cand.get('syncedLyrics'):
                            full_payload = cand
                            break
                except Exception:
                    continue

        parsed_data = self._parse_payload(full_payload, clean_title, artist)
        
        # Save to cache
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(parsed_data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        return parsed_data

    def _parse_payload(self, payload: Optional[Dict[str, Any]], title: str, artist: str) -> Dict[str, Any]:
        if not payload:
            return {
                'title': title,
                'artist': artist,
                'has_synced': False,
                'lines': []
            }

        # 1. Check if official lyricsfile (word-by-word studio YAML) is available!
        raw_lyricsfile = payload.get('lyricsfile')
        if raw_lyricsfile:
            parsed_lines = self._parse_lyricsfile(raw_lyricsfile)
            if parsed_lines:
                return {
                    'title': payload.get('trackName', title),
                    'artist': payload.get('artistName', artist),
                    'has_synced': True,
                    'has_word_sync': True,
                    'lines': parsed_lines
                }

        # 2. Fallback to syncedLyrics (LRC)
        synced_lrc = payload.get('syncedLyrics') or ""
        plain_lyrics = payload.get('plainLyrics') or ""

        if not synced_lrc:
            return {
                'title': payload.get('trackName', title),
                'artist': payload.get('artistName', artist),
                'has_synced': False,
                'plain': plain_lyrics,
                'lines': []
            }

        lines = self._parse_lrc(synced_lrc)
        return {
            'title': payload.get('trackName', title),
            'artist': payload.get('artistName', artist),
            'has_synced': len(lines) > 0,
            'has_word_sync': False,
            'lines': lines
        }

    def _parse_lyricsfile(self, raw_yaml: str) -> List[Dict[str, Any]]:
        try:
            doc = yaml.safe_load(raw_yaml)
            if not doc or 'lines' not in doc:
                return []

            lines: List[Dict[str, Any]] = []
            for idx, raw_line in enumerate(doc['lines']):
                raw_words = raw_line.get('words', [])
                line_text = raw_line.get('text', '').strip()
                # Remove parenthetical lyrics and ad-libs from line text
                clean_line_text = re.sub(r'\(.*?\)[,\s]*', ' ', line_text).strip()
                clean_line_text = re.sub(r'\s+', ' ', clean_line_text).strip()

                start_sec = raw_line.get('start_ms', 0) / 1000.0
                end_sec = raw_line.get('end_ms', raw_line.get('start_ms', 0) + 3000) / 1000.0

                words: List[Dict[str, Any]] = []
                in_parens = False
                for w_idx, w in enumerate(raw_words):
                    w_text = w.get('text', '').strip()
                    if not w_text:
                        continue

                    # Filter out any word or phrase enclosed in parentheses ()
                    has_open = '(' in w_text
                    has_close = ')' in w_text
                    if has_open and has_close:
                        continue
                    elif has_open:
                        in_parens = True
                        continue
                    elif in_parens:
                        if has_close:
                            in_parens = False
                        continue
                    elif has_close:
                        continue

                    if w_text in ',.?!:;':
                        continue

                    w_start = w.get('start_ms', 0) / 1000.0
                    
                    # Word end is next word's start, or line end
                    if w_idx + 1 < len(raw_words):
                        w_end = raw_words[w_idx + 1].get('start_ms', 0) / 1000.0
                    else:
                        w_end = end_sec

                    words.append({
                        'word': w_text,
                        'start': round(w_start, 3),
                        'end': round(max(w_start + 0.1, w_end), 3)
                    })

                if words:
                    lines.append({
                        'line_index': idx,
                        'text': clean_line_text,
                        'start_time': round(start_sec, 3),
                        'end_time': round(end_sec, 3),
                        'words': words
                    })

            return lines
        except Exception as e:
            print(f"[LyricsFetcher] Error parsing lyricsfile YAML: {e}")
            return []

    def _parse_timestamp(self, ts_str: str) -> float:
        parts = ts_str.strip().split(':')
        if len(parts) == 2:
            minutes = float(parts[0])
            seconds = float(parts[1])
            return minutes * 60 + seconds
        return 0.0

    def _parse_lrc(self, lrc_text: str) -> List[Dict[str, Any]]:
        raw_lines = lrc_text.splitlines()
        parsed_raw: List[Dict[str, Any]] = []

        line_regex = re.compile(r'\[(\d+:\d+(?:\.\d+)?)\](.*)')
        tag_word_regex = re.compile(r'<(\d+:\d+(?:\.\d+)?)>\s*([^<]+)')

        for raw in raw_lines:
            raw = raw.strip()
            if not raw:
                continue
            m = line_regex.match(raw)
            if not m:
                continue
            ts_str, content = m.groups()
            start_time = self._parse_timestamp(ts_str)
            content = content.strip()
            if not content:
                continue

            parsed_raw.append({
                'start_time': start_time,
                'raw_content': content
            })

        parsed_raw.sort(key=lambda x: x['start_time'])
        # Estimate song-level vocal cadence (syllables/sec) from active LRC lines
        def count_syllables(tok: str) -> int:
            w = tok.lower().strip(".,!?:;'\"-()[]{}")
            matches = re.findall(r'[aeiouy]+', w)
            return max(1, len(matches))

        line_rates: List[float] = []
        for i, item in enumerate(parsed_raw):
            if i + 1 >= len(parsed_raw):
                continue
            gap = parsed_raw[i + 1]['start_time'] - item['start_time']
            if 0.6 <= gap <= 6.5:
                clean_raw = re.sub(r'\(.*?\)[,\s]*', ' ', item['raw_content']).strip()
                clean_text = re.sub(r'<[^>]+>', '', clean_raw).strip()
                toks = [t for t in clean_text.split() if '(' not in t and ')' not in t and t not in ',.?!:;']
                if toks:
                    syls = sum(count_syllables(t) for t in toks)
                    line_rates.append(syls / gap)

        if line_rates:
            line_rates.sort()
            median_rate = line_rates[len(line_rates) // 2]
        else:
            median_rate = 3.2

        # Map estimated song BPM/cadence tier to base seconds per syllable
        if median_rate < 2.3:
            # Slow ballad (~60-80 BPM)
            song_sec_per_syl = 0.36
        elif median_rate < 3.4:
            # Mid-tempo pop/R&B (~85-115 BPM)
            song_sec_per_syl = 0.28
        elif median_rate < 4.6:
            # Upbeat / fast pop (~120-138 BPM)
            song_sec_per_syl = 0.21
        else:
            # Rapid / rap flow (140+ BPM)
            song_sec_per_syl = 0.16

        lines: List[Dict[str, Any]] = []

        for i, item in enumerate(parsed_raw):
            start_time = item['start_time']
            raw_content = item['raw_content']
            
            if i + 1 < len(parsed_raw):
                gap_to_next = max(0.5, parsed_raw[i + 1]['start_time'] - start_time)
            else:
                gap_to_next = 4.0

            # Remove parenthetical lyrics, ad-libs, and trailing punctuation
            clean_raw = re.sub(r'\(.*?\)[,\s]*', ' ', raw_content).strip()
            clean_raw = re.sub(r'\s+', ' ', clean_raw).strip()

            # 1. Check for Enhanced LRC word-level tags: <mm:ss.xx> word <mm:ss.xx> word
            tagged_matches = tag_word_regex.findall(clean_raw)
            if len(tagged_matches) >= 2:
                words: List[Dict[str, Any]] = []
                for w_idx, (w_ts, w_txt) in enumerate(tagged_matches):
                    clean_w = w_txt.strip()
                    if not clean_w or '(' in clean_w or ')' in clean_w or clean_w in ',.?!:;':
                        continue
                    w_start = self._parse_timestamp(w_ts)
                    if w_idx + 1 < len(tagged_matches):
                        w_end = self._parse_timestamp(tagged_matches[w_idx + 1][0])
                    else:
                        w_end = start_time + gap_to_next
                    words.append({
                        'word': clean_w,
                        'start': round(w_start, 3),
                        'end': round(max(w_start + 0.1, w_end), 3)
                    })
                if words:
                    lines.append({
                        'line_index': len(lines),
                        'text': re.sub(r'<[^>]+>', '', clean_raw).strip(),
                        'start_time': start_time,
                        'end_time': start_time + gap_to_next,
                        'words': words
                    })
                    continue

            # 2. Adaptive BPM & syllable-weighted vocal cadence pacing
            clean_text = re.sub(r'<[^>]+>', '', clean_raw).strip()
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            tokens = [t for t in clean_text.split() if '(' not in t and ')' not in t and t not in ',.?!:;']
            if not tokens:
                continue

            syllable_counts = [count_syllables(t) for t in tokens]
            total_syllables = sum(syllable_counts)

            # Blend song-level BPM pace with local line density when gap is normal
            local_sec_per_syl = song_sec_per_syl
            if 0.6 <= gap_to_next <= 6.0:
                local_rate = total_syllables / gap_to_next
                if local_rate > 4.8:
                    local_sec_per_syl = min(song_sec_per_syl, 0.16)
                elif local_rate < 2.0 and song_sec_per_syl < 0.30:
                    local_sec_per_syl = 0.32

            estimated_dur = total_syllables * local_sec_per_syl
            max_vocal_window = min(gap_to_next * 0.90, max(1.0, gap_to_next - 0.12))
            vocal_dur = min(max_vocal_window, max(min(gap_to_next * 0.65, 1.0), estimated_dur))

            words: List[Dict[str, Any]] = []
            curr_t = start_time

            for tok, syl in zip(tokens, syllable_counts):
                w_dur = max(0.08, (syl / total_syllables) * vocal_dur)
                words.append({
                    'word': tok,
                    'start': round(curr_t, 3),
                    'end': round(curr_t + w_dur, 3)
                })
                curr_t += w_dur

            lines.append({
                'line_index': len(lines),
                'text': clean_text,
                'start_time': start_time,
                'end_time': start_time + gap_to_next,
                'words': words
            })

        return lines
