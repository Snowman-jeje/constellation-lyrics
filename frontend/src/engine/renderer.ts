import type { ColorPalette } from '../types/music';
import { ConstellationManager } from './constellation';
import { GOLD_ACCENT, calibrateAccentRgb } from './lyricTiming';

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
  private reticleFromX = -100;
  private reticleFromY = -100;
  private reticleProgress = 1.0;
  private reticleLineIndex = -1;
  private reticleWordIndex = -1;
  private reticleAlpha = 0.0;

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
    this.renderEdges(ctx);
    this.renderReticle(ctx, dt, time);
    this.renderWords(ctx);
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
      if (star.size > 2.4) {
        this.drawDiamondFlare(ctx, sx, sy, star.size * 2.2, star.size * 0.45);
        this.drawDiamondFlare(ctx, sx, sy, star.size * 0.45, star.size * 2.2);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
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
          ? `rgba(17, 17, 20, ${0.15 * edge.progress})`
          : `rgba(244, 242, 237, ${0.20 * edge.progress})`;
        ctx.lineWidth = 1.05;
        ctx.shadowBlur = 0;
      } else if (isLineActive) {
        ctx.strokeStyle = this.lightMode
          ? `rgba(${pr}, ${pg}, ${pb}, ${0.82 * edge.progress})`
          : `rgba(244, 242, 237, ${0.78 * edge.progress})`;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, ${this.lightMode ? 0.30 : 0.85})`;
        ctx.shadowBlur = 14;
      } else {
        ctx.strokeStyle = this.lightMode
          ? `rgba(17, 17, 20, ${0.28 * edge.progress})`
          : `rgba(244, 242, 237, ${0.34 * edge.progress})`;
        ctx.lineWidth = 1.35;
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
    if (count >= 16) {
      baseActiveFont = 36;
      baseInactiveFont = 23;
    } else if (count >= 14) {
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

      const starRadius = (w.active ? 9.5 : 6.2) * scale;
      const flareLen = (w.active ? 22 : 13.5) * scale;
      const flareWidth = (w.active ? 3.8 : 2.4) * scale;

      ctx.fillStyle = w.active ? activeInk : nodeInactiveInk;
      if (w.active && !this.lightMode) {
        ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, 0.85)`;
        ctx.shadowBlur = 16;
      }
      this.drawDiamondFlare(ctx, 0, 0, flareLen, flareWidth);
      this.drawDiamondFlare(ctx, 0, 0, flareWidth, flareLen);
      ctx.beginPath();
      ctx.arc(0, 0, starRadius * 0.65, 0, Math.PI * 2);
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
        ctx.fillText(w.word, 0, 28);
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = inactiveInk;
        ctx.fillText(w.word, 0, 19);
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
      const isNewLine = activeTarget.lineIndex !== this.reticleLineIndex;
      const isNewWord = activeTarget.wordIndex !== this.reticleWordIndex;

      if (this.reticleX < 0 || this.reducedMotion || isNewLine) {
        this.reticleX = activeTarget.x;
        this.reticleY = activeTarget.y;
        this.reticleFromX = activeTarget.x;
        this.reticleFromY = activeTarget.y;
        this.reticleProgress = 1.0;
      } else if (isNewWord) {
        this.reticleFromX = this.reticleX;
        this.reticleFromY = this.reticleY;
        this.reticleProgress = 0.0;
      }

      this.reticleLineIndex = activeTarget.lineIndex;
      this.reticleWordIndex = activeTarget.wordIndex;

      if (this.reticleProgress < 1.0) {
        // Fast quartic ease-out (140ms) for snappy yet fluid star-to-star motion
        this.reticleProgress = Math.min(1.0, this.reticleProgress + dt / 0.14);
        const ease = 1.0 - Math.pow(1.0 - this.reticleProgress, 4);
        this.reticleX = this.reticleFromX + (activeTarget.x - this.reticleFromX) * ease;
        this.reticleY = this.reticleFromY + (activeTarget.y - this.reticleFromY) * ease;
      } else {
        this.reticleX = activeTarget.x;
        this.reticleY = activeTarget.y;
      }

      this.reticleAlpha = 1.0;
    } else {
      this.reticleAlpha = 0.0;
      this.reticleWordIndex = -1;
    }

    if (this.reticleAlpha < 0.02) return;

    ctx.save();
    ctx.translate(this.reticleX, this.reticleY);
    ctx.globalAlpha = this.reticleAlpha;

    const ringRadius = 30 + (this.reducedMotion ? 0 : Math.sin(time * 3) * 2.2) + this.beat * 4.5;
    ctx.strokeStyle = this.lightMode
      ? `rgba(${pr}, ${pg}, ${pb}, 0.48)`
      : 'rgba(244, 242, 237, 0.48)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    const pulse = this.reducedMotion ? 1.0 : 1.0 + Math.sin(time * 4) * 0.08 + this.beat * 0.14;
    const spikeLen = 54 * pulse;
    const spikeWidth = 4.6;

    ctx.fillStyle = this.lightMode ? '#111114' : '#F4F2ED';
    ctx.shadowColor = `rgba(${pr}, ${pg}, ${pb}, ${this.lightMode ? 0.28 : 0.88})`;
    ctx.shadowBlur = this.lightMode ? 12 : 24;

    this.drawDiamondFlare(ctx, 0, 0, spikeLen, spikeWidth);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth, spikeLen);

    ctx.save();
    ctx.rotate(Math.PI / 4);
    this.drawDiamondFlare(ctx, 0, 0, spikeLen * 0.46, spikeWidth * 0.72);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth * 0.72, spikeLen * 0.46);
    ctx.restore();

    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
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
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
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
}
