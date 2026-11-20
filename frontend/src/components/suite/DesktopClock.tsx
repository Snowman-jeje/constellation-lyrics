import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { getCalibratedAccent, isTauriRuntime, setWindowIgnoreCursor } from '../../store/tauriBridge';
import { useSuiteStore } from '../../store/useSuiteStore';
import type { ColorPalette } from '../../types/music';
import { BezelPanel } from './AtelierPrimitives';

interface DesktopClockProps {
  standalone?: boolean;
  palette?: ColorPalette;
}

const ROMAN_HOURS = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

export function DesktopClock({ standalone = false, palette }: DesktopClockProps) {
  const { settings, updateSection } = useSuiteStore();
  const { desktop } = settings;
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(() => new Date());

  const dragStateRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: desktop.clockX, origY: desktop.clockY });

  const [localPos, setLocalPos] = useState({ x: desktop.clockX, y: desktop.clockY });

  useEffect(() => {
    setLocalPos({ x: desktop.clockX, y: desktop.clockY });
  }, [desktop.clockX, desktop.clockY]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return;
    void setWindowIgnoreCursor(false);
  }, [standalone]);

  const hours24 = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hh = String(hours24).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  const dateText = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const accent = getCalibratedAccent(palette);
  const inkColor = desktop.clockColor || '#F4F2ED';
  const glowStyle = desktop.clockGlow
    ? { textShadow: `0 0 28px rgba(${accent.rgb}, 0.35)` }
    : undefined;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (standalone) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: localPos.x,
      origY: localPos.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (standalone || !dragStateRef.current.dragging) return;
    const maxX = Math.max(20, window.innerWidth - 260);
    const maxY = Math.max(20, window.innerHeight - 160);
    const nextX = Math.min(maxX, Math.max(16, dragStateRef.current.origX + (e.clientX - dragStateRef.current.startX)));
    const nextY = Math.min(maxY, Math.max(16, dragStateRef.current.origY + (e.clientY - dragStateRef.current.startY)));
    setLocalPos({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const handlePointerUp = () => {
    if (standalone || !dragStateRef.current.dragging) return;
    dragStateRef.current.dragging = false;
    updateSection('desktop', { clockX: localPos.x, clockY: localPos.y });
  };

  const secondAngle = seconds * 6;
  const minuteAngle = minutes * 6 + seconds * 0.1;
  const hourAngle = (hours24 % 12) * 30 + minutes * 0.5;

  const clockBody = (
    <div
      className="select-none"
      style={{
        transform: `scale(${desktop.clockSize})`,
        transformOrigin: standalone ? 'center center' : 'top left',
        color: inkColor,
      }}
    >
      {desktop.clockFace === 'roman' ? (
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative h-28 w-28">
            <svg viewBox="0 0 160 160" className="h-full w-full overflow-visible">
              <circle
                cx="80"
                cy="80"
                r="74"
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1"
              />
              <circle
                cx="80"
                cy="80"
                r="68"
                fill="none"
                stroke={`rgba(${accent.rgb}, 0.25)`}
                strokeWidth="0.75"
              />
              {ROMAN_HOURS.map((label, idx) => {
                const rad = ((idx * 30 - 90) * Math.PI) / 180;
                const tx = 80 + Math.cos(rad) * 55;
                const ty = 80 + Math.sin(rad) * 55;
                const cardinal = idx % 3 === 0;
                return (
                  <text
                    key={label}
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={cardinal ? inkColor : 'rgba(244,242,237,0.52)'}
                    fontSize={cardinal ? '10' : '7.5'}
                    fontFamily="'Instrument Serif', Georgia, serif"
                    letterSpacing="0.06em"
                  >
                    {label}
                  </text>
                );
              })}
              {/* Hour Hand */}
              <line
                x1="80"
                y1="80"
                x2="80"
                y2="46"
                stroke={inkColor}
                strokeWidth="1.8"
                strokeLinecap="round"
                transform={`rotate(${hourAngle} 80 80)`}
              />
              {/* Minute Hand */}
              <line
                x1="80"
                y1="80"
                x2="80"
                y2="30"
                stroke={inkColor}
                strokeWidth="1.2"
                strokeLinecap="round"
                transform={`rotate(${minuteAngle} 80 80)`}
              />
              {/* Second Needle */}
              <line
                x1="80"
                y1="88"
                x2="80"
                y2="24"
                stroke={accent.css}
                strokeWidth="0.8"
                strokeLinecap="round"
                transform={`rotate(${secondAngle} 80 80)`}
              />
              <circle cx="80" cy="80" r="2.6" fill={accent.css} />
            </svg>
          </div>
          {desktop.clockShowDate && (
            <span className="font-display text-[10px] uppercase tracking-[0.28em] text-[#8E8A82]">
              {dateText}
            </span>
          )}
        </div>
      ) : desktop.clockFace === 'mono' ? (
        <div className="flex flex-col items-start gap-1">
          <div
            className="font-mono text-[2.4rem] font-normal leading-none tracking-tight tabular-nums"
            style={glowStyle}
          >
            {hh}:{mm}
            <span className="ml-1.5 text-[1.1rem] text-[#8E8A82]">:{ss}</span>
          </div>
          {desktop.clockShowDate && (
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8E8A82]">
              <span className="h-1 w-1 rounded-full" style={{ backgroundColor: accent.css }} />
              <span>{dateText}</span>
            </div>
          )}
        </div>
      ) : desktop.clockFace === 'minimal' ? (
        <div className="flex flex-col items-center gap-1">
          <div
            className="font-sans text-[3.1rem] font-extralight leading-none tracking-[-0.04em] tabular-nums"
            style={glowStyle}
          >
            {hh}
            <span className="mx-0.5 opacity-45">:</span>
            {mm}
          </div>
          {desktop.clockShowDate && (
            <span className="font-sans text-[10px] font-medium uppercase tracking-[0.26em] text-[#8E8A82]">
              {dateText}
            </span>
          )}
        </div>
      ) : (
        /* atelier editorial serif */
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="font-display text-[3.25rem] font-medium leading-none tracking-[0.02em] tabular-nums"
            style={glowStyle}
          >
            {hh}
            <span className="mx-1 font-light" style={{ color: accent.css }}>
              :
            </span>
            {mm}
          </div>
          {desktop.clockShowDate && (
            <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.28em] text-[#8E8A82]">
              <span className="h-[1px] w-4 bg-white/15" />
              <span className="font-sans">{dateText}</span>
              <span className="h-[1px] w-4 bg-white/15" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  const wrapperProps = standalone
    ? {
        'data-tauri-drag-region': true,
      }
    : {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
      };

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.28 }}
      style={
        standalone
          ? undefined
          : {
              position: 'fixed',
              left: `${localPos.x}px`,
              top: `${localPos.y}px`,
              zIndex: 18,
            }
      }
      className={
        standalone
          ? 'flex h-screen w-screen items-center justify-center'
          : 'cursor-grab active:cursor-grabbing'
      }
      {...wrapperProps}
    >
      {desktop.clockTransparent ? (
        <div className="px-4 py-2">{clockBody}</div>
      ) : (
        <BezelPanel
          radiusClass="rounded-[1.75rem]"
          innerRadiusClass="rounded-[calc(1.75rem-0.375rem)]"
          innerClassName="px-6 py-4"
        >
          {clockBody}
        </BezelPanel>
      )}
    </motion.div>
  );
}
