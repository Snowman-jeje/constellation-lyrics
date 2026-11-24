import type { ColorPalette } from '../types/music';
import { ConstellationManager } from './constellation';
import { GOLD_ACCENT, calibrateAccentRgb } from './lyricTiming';

interface StardustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
}

export interface ConstellationRenderOptions {
  fontScale?: number;
  lightMode?: boolean;
  reducedMotion?: boolean;
  showAmbientGlow?: boolean;
  beat?: number;
}

export class ConstellationRenderer {
  private ambientCanvas: HTMLCanvasElement;
  private mainCanvas: HTMLCanvasElement;
  private ambientCtx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private manager: ConstellationManager;

  width = 0;
  height = 0;

  private reticleX = -100;
  private reticleY = -100;
  private reticleVx = 0;
  private reticleVy = 0;
  private reticleAlpha = 0.0;
  private stardustParticles: StardustParticle[] = [];

  private primaryColor: ColorPalette = { ...GOLD_ACCENT };
  private targetPrimaryColor: ColorPalette = { ...GOLD_ACCENT };

  private fontScale = 1.0;
  private lightMode = false;
  private reducedMotion = false;
  private showAmbientGlow = true;
  private beat = 0;

  constructor(
    ambientCanvas: HTMLCanvasElement,
    mainCanvas: HTMLCanvasElement,
    manager: ConstellationManager,
  ) {
    this.ambientCanvas = ambientCanvas;
    this.mainCanvas = mainCanvas;
    const aCtx = ambientCanvas.getContext('2d');
    const mCtx = mainCanvas.getContext('2d');
    if (!aCtx || !mCtx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ambientCtx = aCtx;
    this.ctx = mCtx;
    this.manager = manager;
    this.resize();
  }

  resize(explicitWidth?: number, explicitHeight?: number): void {
    const parent = this.mainCanvas.parentElement;
    const nextW = explicitWidth ?? (parent?.clientWidth || window.innerWidth);
    const nextH = explicitHeight ?? (parent?.clientHeight || window.innerHeight);

    this.width = Math.max(1, nextW);
    this.height = Math.max(1, nextH);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ambientCanvas.width = Math.round(this.width * dpr);
    this.ambientCanvas.height = Math.round(this.height * dpr);
    this.mainCanvas.width = Math.round(this.width * dpr);
    this.mainCanvas.height = Math.round(this.height * dpr);

    this.ambientCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.manager.rescaleLayout(this.width, this.height);
  }

  setPalette(rgb: ColorPalette): void {
    if (rgb && typeof rgb.r === 'number') {
      const calibrated = calibrateAccentRgb(rgb, this.lightMode);
      this.targetPrimaryColor = calibrated;
    }
  }

  setOptions(options: ConstellationRenderOptions): void {
    if (typeof options.fontScale === 'number') {
      this.fontScale = Math.max(0.7, Math.min(1.6, options.fontScale));
    }
    if (typeof options.lightMode === 'boolean') {
      const changed = this.lightMode !== options.lightMode;
      this.lightMode = options.lightMode;
      if (changed) {
        this.targetPrimaryColor = calibrateAccentRgb(this.targetPrimaryColor, this.lightMode);
      }
    }
    if (typeof options.reducedMotion === 'boolean') {
      this.reducedMotion = options.reducedMotion;
    }
    if (typeof options.showAmbientGlow === 'boolean') {
      this.showAmbientGlow = options.showAmbientGlow;
    }
    if (typeof options.beat === 'number') {
      this.beat = Math.max(0, Math.min(1, options.beat));
    }
  }

  render(dt: number): void {
    const time = performance.now() * 0.001;

    const lerpRate = Math.min(1, dt * 3.5);
    this.primaryColor.r += (this.targetPrimaryColor.r - this.primaryColor.r) * lerpRate;
    this.primaryColor.g += (this.targetPrimaryColor.g - this.primaryColor.g) * lerpRate;
    this.primaryColor.b += (this.targetPrimaryColor.b - this.primaryColor.b) * lerpRate;

    this.renderAmbientBacklight(time);
    this.renderMainCanvas(dt, time);
  }

  private renderAmbientBacklight(time: number): void {
    const ctx = this.ambientCtx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);
    if (!this.showAmbientGlow) return;

    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);

    const breathe = this.reducedMotion ? 1.0 : 1.0 + Math.sin(time * 1.1) * 0.06 + this.beat * 0.1;
    const radius = Math.max(w, h) * 0.52 * breathe;

    const centerGlow = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, radius);
    if (this.lightMode) {
      centerGlow.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.14)`);
      centerGlow.addColorStop(0.45, `rgba(${pr}, ${pg}, ${pb}, 0.06)`);
      centerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    } else {
      centerGlow.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.42)`);
      centerGlow.addColorStop(0.32, `rgba(${pr}, ${pg}, ${pb}, 0.22)`);
      centerGlow.addColorStop(0.68, `rgba(${pr}, ${pg}, ${pb}, 0.07)`);
      centerGlow.addColorStop(1, 'rgba(7, 7, 9, 0)');
    }

    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, w, h);
  }

  private renderMainCanvas(dt: number, time: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    this.renderBackgroundStars(ctx, time);

    if (this.manager.outgoingAlpha > 0.01) {
      this.renderOutgoingConstellation(ctx);
    }

    this.renderEdges(ctx);
    this.renderReticle(ctx, dt, time);
    this.renderWords(ctx);
    this.renderStardust(ctx, dt);
  }

  private renderOutgoingConstellation(ctx: CanvasRenderingContext2D): void {
    const alpha = this.manager.outgoingAlpha;
    const words = this.manager.outgoingWords;
    const edges = this.manager.outgoingEdges;

    const strokeBase = this.lightMode ? '17, 17, 20' : '244, 242, 237';
    const textBase = this.lightMode ? '17, 17, 20' : '244, 242, 237';

    ctx.save();
    ctx.globalAlpha = alpha;

    for (const edge of edges) {
      const w1 = words[edge.from];
      const w2 = words[edge.to];
      if (!w1 || !w2 || !w1.revealed || !w2.revealed) continue;

      const isFacet = !!edge.isFacet;
      ctx.beginPath();
      ctx.moveTo(w1.x, w1.y);
      ctx.lineTo(w2.x, w2.y);
      ctx.strokeStyle = isFacet
        ? `rgba(${strokeBase}, ${0.08 * alpha})`
        : `rgba(${strokeBase}, ${0.16 * alpha})`;
      ctx.lineWidth = isFacet ? 0.8 : 1.0;
      ctx.stroke();
    }

    for (const w of words) {
      if (!w.revealed) continue;
      ctx.save();
      ctx.fillStyle = `rgba(${textBase}, ${0.4 * alpha})`;
      ctx.font = `400 ${Math.round(28 * this.fontScale)}px 'Instrument Serif', Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(w.word, w.x, w.y + 8);
      ctx.restore();
    }

    ctx.restore();
  }

  private renderBackgroundStars(ctx: CanvasRenderingContext2D, time: number): void {
    const starColor = this.lightMode ? '17, 17, 20' : '244, 242, 237';
    const baseOpacity = this.lightMode ? 0.22 : 0.5;

    for (const star of this.manager.ambientStars) {
      const twinkle = this.reducedMotion
        ? 0
        : Math.sin(time * star.twinkleSpeed * 100 + star.phase) * 0.24;
      const alpha = star.alpha + twinkle;
      if (alpha <= 0) continue;

      const sx = star.x * this.width;
      const sy = star.y * this.height;

      ctx.fillStyle = `rgba(${starColor}, ${Math.max(0, Math.min(1, alpha * baseOpacity))})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderEdges(ctx: CanvasRenderingContext2D): void {
    const words = this.manager.words;
    const edges = this.manager.edges;
    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);

    ctx.save();
    for (const edge of edges) {
      if (edge.progress <= 0.01) continue;

      const w1 = words[edge.from];
      const w2 = words[edge.to];
      if (!w1 || !w2 || !w1.revealed || !w2.revealed) continue;

      const currentX = w1.x + (w2.x - w1.x) * edge.progress;
      const currentY = w1.y + (w2.y - w1.y) * edge.progress;
      const isLineActive = w1.active || w2.active;

      ctx.beginPath();
      ctx.moveTo(w1.x, w1.y);
      ctx.lineTo(currentX, currentY);

      if (edge.isFacet) {
        ctx.strokeStyle = this.lightMode
          ? `rgba(17, 17, 20, ${0.11 * edge.progress})`
          : `rgba(244, 242, 237, ${0.14 * edge.progress})`;
        ctx.lineWidth = 0.85;
        ctx.shadowBlur = 0;
      } else if (isLineActive) {
        ctx.strokeStyle = this.lightMode
          ? `rgba(${pr}, ${pg}, ${pb}, ${0.72 * edge.progress})`
          : `rgba(244, 242, 237, ${0.68 * edge.progress})`;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, ${this.lightMode ? 0.25 : 0.78})`;
        ctx.shadowBlur = 10;
      } else {
        ctx.strokeStyle = this.lightMode
          ? `rgba(17, 17, 20, ${0.2 * edge.progress})`
          : `rgba(244, 242, 237, ${0.24 * edge.progress})`;
        ctx.lineWidth = 1.0;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderWords(ctx: CanvasRenderingContext2D): void {
    const words = this.manager.words;
    const count = words.length;
    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);

    let baseActiveFont = 54;
    let baseInactiveFont = 34;
    if (count >= 14) {
      baseActiveFont = 40;
      baseInactiveFont = 26;
    } else if (count >= 10) {
      baseActiveFont = 46;
      baseInactiveFont = 30;
    }

    const activeInk = this.lightMode ? '#111114' : '#F4F2ED';
    const inactiveInk = this.lightMode
      ? 'rgba(17, 17, 20, 0.72)'
      : 'rgba(244, 242, 237, 0.78)';
    const nodeInactiveInk = this.lightMode
      ? 'rgba(17, 17, 20, 0.65)'
      : 'rgba(244, 242, 237, 0.80)';

    for (let i = 0; i < count; i++) {
      const w = words[i];
      if (!w.revealed || w.revealProgress <= 0.01) continue;

      const progress = w.revealProgress;
      const scale = w.activeScale * (0.86 + 0.14 * progress);
      const glow = w.glowIntensity;

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.globalAlpha = progress;

      const starRadius = (w.active ? 5.8 : 3.8) * scale;
      ctx.fillStyle = w.active ? activeInk : nodeInactiveInk;
      ctx.beginPath();
      ctx.arc(0, 0, starRadius, 0, Math.PI * 2);
      ctx.fill();

      const fontSize = Math.round(
        (w.active ? baseActiveFont : baseInactiveFont) * scale * this.fontScale,
      );
      ctx.font = `400 ${fontSize}px 'Instrument Serif', Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      if (w.active) {
        if (!this.lightMode) {
          ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, 0.78)`;
          ctx.shadowBlur = 24 * glow;
        }
        ctx.fillStyle = activeInk;
        ctx.fillText(w.word, 0, 22);
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = inactiveInk;
        ctx.fillText(w.word, 0, 15);
      }

      ctx.restore();
    }
  }

  private renderReticle(ctx: CanvasRenderingContext2D, dt: number, time: number): void {
    const activeTarget = this.manager.getActiveWordPosition();
    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);

    if (activeTarget) {
      if (this.reticleX < 0 || this.reducedMotion) {
        this.reticleX = activeTarget.x;
        this.reticleY = activeTarget.y;
        this.reticleVx = 0;
        this.reticleVy = 0;
      } else {
        const cadence = this.manager.currentCadence || 2.0;
        const agility = Math.max(1.0, Math.min(2.8, cadence / 2.2));

        const dx = activeTarget.x - this.reticleX;
        const dy = activeTarget.y - this.reticleY;

        const omega = 20.0 + agility * 8.0;
        const damping = 2.0 * omega;

        const ax = omega * omega * dx - damping * this.reticleVx;
        const ay = omega * omega * dy - damping * this.reticleVy;

        const subDt = Math.min(0.04, dt);
        this.reticleVx += ax * subDt;
        this.reticleVy += ay * subDt;
        const curV = Math.hypot(this.reticleVx, this.reticleVy);
        const maxV = 2800;
        if (curV > maxV) {
          this.reticleVx = (this.reticleVx / curV) * maxV;
          this.reticleVy = (this.reticleVy / curV) * maxV;
        }
        this.reticleX += this.reticleVx * subDt;
        this.reticleY += this.reticleVy * subDt;

        const speed = Math.hypot(this.reticleVx, this.reticleVy);
        if (speed > 80 && Math.random() < 0.6) {
          this.stardustParticles.push({
            x: this.reticleX - (this.reticleVx / speed) * 8 + (Math.random() - 0.5) * 14,
            y: this.reticleY - (this.reticleVy / speed) * 8 + (Math.random() - 0.5) * 14,
            vx: -this.reticleVx * 0.12 + (Math.random() - 0.5) * 20,
            vy: -this.reticleVy * 0.12 + (Math.random() - 0.5) * 20,
            alpha: 0.9,
            size: Math.random() * 2.4 + 0.9,
          });
        }
      }

      this.reticleAlpha += (1.0 - this.reticleAlpha) * Math.min(1, dt * 14);
    } else {
      this.reticleAlpha += (0.0 - this.reticleAlpha) * Math.min(1, dt * 6);
      this.reticleVx *= Math.max(0, 1.0 - dt * 10);
      this.reticleVy *= Math.max(0, 1.0 - dt * 10);
    }

    if (this.reticleAlpha < 0.02) return;

    ctx.save();
    ctx.translate(this.reticleX, this.reticleY);
    ctx.globalAlpha = this.reticleAlpha;

    const ringRadius = 22 + (this.reducedMotion ? 0 : Math.sin(time * 3) * 1.6) + this.beat * 3.5;
    ctx.strokeStyle = this.lightMode
      ? `rgba(${pr}, ${pg}, ${pb}, 0.48)`
      : 'rgba(244, 242, 237, 0.48)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    const pulse = this.reducedMotion ? 1.0 : 1.0 + Math.sin(time * 4) * 0.08 + this.beat * 0.12;
    const spikeLen = 34 * pulse;
    const spikeWidth = 3.0;

    ctx.fillStyle = this.lightMode ? '#111114' : '#F4F2ED';
    ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, ${this.lightMode ? 0.25 : 0.85})`;
    ctx.shadowBlur = this.lightMode ? 10 : 20;

    this.drawDiamondFlare(ctx, 0, 0, spikeLen, spikeWidth);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth, spikeLen);

    ctx.save();
    ctx.rotate(Math.PI / 4);
    this.drawDiamondFlare(ctx, 0, 0, spikeLen * 0.44, spikeWidth * 0.68);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth * 0.68, spikeLen * 0.44);
    ctx.restore();

    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
    if (this.lightMode) {
      coreGrad.addColorStop(0, '#111114');
      coreGrad.addColorStop(0.45, `rgba(${pr}, ${pg}, ${pb}, 0.55)`);
      coreGrad.addColorStop(1, 'rgba(17, 17, 20, 0)');
    } else {
      coreGrad.addColorStop(0, '#F4F2ED');
      coreGrad.addColorStop(0.42, `rgba(${pr}, ${pg}, ${pb}, 0.8)`);
      coreGrad.addColorStop(1, 'rgba(214, 185, 140, 0)');
    }
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawDiamondFlare(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + w, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - w, cy);
    ctx.closePath();
    ctx.fill();
  }

  private renderStardust(ctx: CanvasRenderingContext2D, dt: number): void {
    if (this.stardustParticles.length === 0) return;
    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);
    const dustBase = this.lightMode ? '17, 17, 20' : '244, 242, 237';

    ctx.save();
    for (let i = this.stardustParticles.length - 1; i >= 0; i--) {
      const p = this.stardustParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 1.7;

      if (p.alpha <= 0) {
        this.stardustParticles.splice(i, 1);
        continue;
      }

      ctx.fillStyle = `rgba(${dustBase}, ${p.alpha * 0.85})`;
      ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, 0.7)`;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
