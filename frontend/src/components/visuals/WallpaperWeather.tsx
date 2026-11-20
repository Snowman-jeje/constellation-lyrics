import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../../engine/lyricTiming';
import type { WallpaperWeatherKind } from '../../types/suite';

export interface WallpaperWeatherProps {
  kind: WallpaperWeatherKind;
  isLightBackdrop?: boolean;
  beat?: number;
  reducedMotion?: boolean;
}

interface WeatherParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

export function WallpaperWeather({
  kind,
  isLightBackdrop = false,
  beat = 0,
  reducedMotion = false,
}: WallpaperWeatherProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const osReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion || osReduced;

  const dynamicRef = useRef({
    kind,
    isLight: isLightBackdrop,
    beat: 0,
    reduced: isReduced,
  });

  useEffect(() => {
    dynamicRef.current = {
      kind,
      isLight: isLightBackdrop,
      beat: Math.max(0, Math.min(1, beat)),
      reduced: isReduced,
    };
  }, [kind, isLightBackdrop, beat, isReduced]);

  useEffect(() => {
    if (kind === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 1;
    let height = 1;

    const particles: WeatherParticle[] = [];
    const spawnCount =
      kind === 'rain' ? 95 : kind === 'snow' ? 64 : kind === 'mist' ? 14 : 78;

    for (let i = 0; i < spawnCount; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        vx:
          kind === 'rain'
            ? -0.08 - Math.random() * 0.04
            : kind === 'mist'
              ? (Math.random() > 0.5 ? 1 : -1) * (0.012 + Math.random() * 0.015)
              : (Math.random() - 0.5) * 0.025,
        vy:
          kind === 'rain'
            ? 0.72 + Math.random() * 0.45
            : kind === 'snow'
              ? 0.04 + Math.random() * 0.055
              : kind === 'mist'
                ? (Math.random() - 0.5) * 0.005
                : -0.006 - Math.random() * 0.01,
        size:
          kind === 'rain'
            ? 12 + Math.random() * 14
            : kind === 'mist'
              ? 180 + Math.random() * 200
              : 1.0 + Math.random() * 2.2,
        alpha: kind === 'mist' ? 0.04 + Math.random() * 0.05 : 0.16 + Math.random() * 0.42,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const syncSize = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, parent?.clientWidth || window.innerWidth);
      height = Math.max(1, parent?.clientHeight || window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', syncSize);

    let rafId = 0;
    let lastNow = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.06, Math.max(0.001, (now - lastNow) * 0.001));
      lastNow = now;

      if (!document.hidden) {
        const cfg = dynamicRef.current;
        const t = now * 0.001;
        const rgb = cfg.isLight ? '20, 20, 24' : '244, 242, 237';
        const beatLift = cfg.reduced ? 0 : cfg.beat * 0.18;

        ctx.clearRect(0, 0, width, height);

        for (const p of particles) {
          if (!cfg.reduced) {
            if (cfg.kind === 'snow') {
              p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 0.012) * dt;
            } else {
              p.x += p.vx * dt;
            }
            p.y += p.vy * dt;

            if (p.y > 1.08) p.y = -0.08;
            if (p.y < -0.08) p.y = 1.08;
            if (p.x > 1.08) p.x = -0.08;
            if (p.x < -0.08) p.x = 1.08;
          }

          const px = p.x * width;
          const py = p.y * height;

          if (cfg.kind === 'rain') {
            ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.65, p.alpha * 0.55 + beatLift * 0.25)})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + p.vx * 36, py + p.size);
            ctx.stroke();
          } else if (cfg.kind === 'mist') {
            const grad = ctx.createRadialGradient(px, py, 0, px, py, p.size);
            grad.addColorStop(0, `rgba(${rgb}, ${p.alpha + beatLift * 0.06})`);
            grad.addColorStop(1, `rgba(${rgb}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fill();
          } else if (cfg.kind === 'stars') {
            const twinkle = cfg.reduced ? 0 : Math.sin(t * 1.9 + p.phase) * 0.28;
            const alpha = Math.max(0.05, Math.min(0.85, p.alpha + twinkle + beatLift * 0.35));
            ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(px, py, p.size * 0.72, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // snow
            ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.75, p.alpha + beatLift * 0.2)})`;
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (!dynamicRef.current.reduced) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', syncSize);
    };
  }, [kind, isReduced, isLightBackdrop]);

  if (kind === 'none') return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
      aria-hidden="true"
    />
  );
}
