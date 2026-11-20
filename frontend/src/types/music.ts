export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface LyricLine {
  line_index: number;
  text: string;
  start_time: number;
  end_time: number;
  words: WordTimestamp[];
}

export interface LyricsData {
  title: string;
  artist: string;
  has_synced: boolean;
  has_word_sync?: boolean;
  source?: 'lrclib_word' | 'lrclib_lrc' | 'plain' | 'none';
  plain?: string;
  lines: LyricLine[];
}

export interface ColorPalette {
  r: number;
  g: number;
  b: number;
}

export interface TrackInfo {
  player: string;
  title: string;
  artist: string;
  album: string;
  art_url: string;
  art_data_url?: string;
  has_art?: boolean;
  art_key?: string;
  length: number;
  status: 'Playing' | 'Paused' | 'Stopped' | string;
  position: number;
  timestamp: number;
  server_mono?: number;
}

export interface StreamPayload {
  track: TrackInfo;
  lyrics: LyricsData | null;
  lyrics_loading?: boolean;
  palette: ColorPalette;
  track_offset?: number;
  server_mono?: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
}
