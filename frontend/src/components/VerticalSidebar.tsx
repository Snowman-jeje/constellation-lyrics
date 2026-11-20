import { getCalibratedAccent } from '../store/tauriBridge';
import type { ColorPalette, TrackInfo } from '../types/music';

interface VerticalSidebarProps {
  track: TrackInfo | null;
  palette: ColorPalette;
}

export function VerticalSidebar({ track, palette }: VerticalSidebarProps) {
  let label = 'OBSIDIAN ATELIER';
  if (track && track.title && track.title !== 'No Track Playing') {
    if (track.album && track.album.toLowerCase() !== 'youtube music') {
      label = track.album;
    } else if (track.artist && track.title) {
      label = `${track.artist} / ${track.title}`;
    } else {
      label = track.title;
    }
  }

  const accent = getCalibratedAccent(palette);

  return (
    <aside className="pointer-events-none fixed left-[2.2vw] top-1/2 z-10 hidden max-h-[82vh] -translate-y-1/2 overflow-hidden sm:flex flex-col items-center gap-4">
      <span
        className="h-8 w-[1px] opacity-35 transition-colors duration-1000"
        style={{ backgroundColor: accent.css }}
      />
      <span
        className="vertical-sidebar-text block max-h-[64vh] truncate whitespace-nowrap font-display text-[clamp(0.68rem,1vw,0.9rem)] uppercase tracking-[0.34em] transition-[color,opacity] duration-1000"
        style={{
          color: `rgba(${accent.rgb}, 0.72)`,
        }}
      >
        {label}
      </span>
      <span
        className="h-8 w-[1px] opacity-35 transition-colors duration-1000"
        style={{ backgroundColor: accent.css }}
      />
    </aside>
  );
}
