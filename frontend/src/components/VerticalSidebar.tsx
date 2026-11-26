import { getCalibratedAccent } from '../store/tauriBridge';
import type { ColorPalette, TrackInfo } from '../types/music';

interface VerticalSidebarProps {
  track: TrackInfo | null;
  palette: ColorPalette;
}

export function VerticalSidebar({ track, palette }: VerticalSidebarProps) {
  const hasTrack = Boolean(track && track.title && track.title !== 'No Track Playing');
  const title = hasTrack ? track!.title : 'Constellation Suite';
  const subtitle = hasTrack
    ? [track?.artist, track?.album && track.album.toLowerCase() !== 'youtube music' ? track.album : '']
        .filter(Boolean)
        .join(' — ')
    : 'Synced Celestial Lyrics';

  const accent = getCalibratedAccent(palette);

  return (
    <aside className="pointer-events-none fixed left-7 top-6 z-10 hidden max-w-[36vw] sm:flex items-center gap-3">
      <span
        className="h-7 w-[2px] shrink-0 rounded-full opacity-55 transition-colors duration-1000"
        style={{ backgroundColor: accent.css }}
      />
      <div className="min-w-0">
        <div
          className="truncate font-display text-[13px] font-medium tracking-[0.14em] uppercase transition-colors duration-1000"
          style={{ color: `rgba(${accent.rgb}, 0.88)` }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate text-[11px] tracking-[0.08em] text-[#F4F2ED]/50">
            {subtitle}
          </div>
        )}
      </div>
    </aside>
  );
}
