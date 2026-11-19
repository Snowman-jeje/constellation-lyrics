/**
 * High-performance 60+ FPS Canvas Renderer
 * Renders dynamic ambient backlight from album artwork, starry background,
 * sequential word-by-word constellation reveal, and the signature 4-point star reticle.
 */

class ConstellationRenderer {
  constructor(ambientCanvas, mainCanvas, manager) {
    this.ambientCanvas = ambientCanvas;
    this.mainCanvas = mainCanvas;
    this.ambientCtx = ambientCanvas.getContext('2d');
    this.ctx = mainCanvas.getContext('2d');
    this.manager = manager;

    // Reticle (4-point crosshair star) position and physics
    this.reticleX = -100;
    this.reticleY = -100;
    this.reticleAlpha = 0.0;
    this.stardustParticles = [];

    // Ambient theme colors (dynamically adapted from album cover)
    this.primaryColor = { r: 255, g: 104, b: 43 };
    this.targetPrimaryColor = { r: 255, g: 104, b: 43 };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    const dpr = window.devicePixelRatio || 1;
    this.ambientCanvas.width = this.width * dpr;
    this.ambientCanvas.height = this.height * dpr;
    this.mainCanvas.width = this.width * dpr;
    this.mainCanvas.height = this.height * dpr;

    this.ambientCtx.scale(dpr, dpr);
    this.ctx.scale(dpr, dpr);
  }

  setPalette(rgb) {
    if (rgb && typeof rgb.r === 'number') {
      this.targetPrimaryColor = { r: rgb.r, g: rgb.g, b: rgb.b };
    }
  }

  render(dt) {
    const time = performance.now() * 0.001;

    // Smooth color transition
    this.primaryColor.r += (this.targetPrimaryColor.r - this.primaryColor.r) * Math.min(1, dt * 3);
    this.primaryColor.g += (this.targetPrimaryColor.g - this.primaryColor.g) * Math.min(1, dt * 3);
    this.primaryColor.b += (this.targetPrimaryColor.b - this.primaryColor.b) * Math.min(1, dt * 3);

    this.renderAmbientBacklight(time);
    this.renderMainCanvas(dt, time);
  }

  renderAmbientBacklight(time) {
    const ctx = this.ambientCtx;
    const w = this.width;
    const h = this.height;

    // Clear canvas so underlying album cover artwork shines through
    ctx.clearRect(0, 0, w, h);

    const pr = Math.round(this.primaryColor.r);
    const pg = Math.round(this.primaryColor.g);
    const pb = Math.round(this.primaryColor.b);

    // Ethereal breathing ambient glow in the center adapted to album palette
    const pulse = 1.0 + Math.sin(time * 1.1) * 0.08;
    const radius = Math.max(w, h) * 0.55 * pulse;

    const centerGlow = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, radius);
    centerGlow.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.55)`);
    centerGlow.addColorStop(0.3, `rgba(${pr}, ${pg}, ${pb}, 0.32)`);
    centerGlow.addColorStop(0.65, `rgba(${pr}, ${pg}, ${pb}, 0.10)`);
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, w, h);
  }

  renderMainCanvas(dt, time) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Twinkling background stars
    this.renderBackgroundStars(ctx, time);

    // 2. Draw smoothly dissolving outgoing constellation
    if (this.manager.outgoingAlpha > 0.01) {
      this.renderOutgoingConstellation(ctx);
    }

    // 3. Draw revealed constellation edges
    this.renderEdges(ctx);

    // 4. Draw revealed word nodes ONE BY ONE
    this.renderWords(ctx, time);

    // 5. Sparkling 4-point star reticle tracker
    this.renderReticle(ctx, dt, time);

    // 6. Floating stardust particles
    this.renderStardust(ctx, dt);
  }

  renderOutgoingConstellation(ctx) {
    const alpha = this.manager.outgoingAlpha;
    const words = this.manager.outgoingWords;
    const edges = this.manager.outgoingEdges;

    ctx.save();
    ctx.globalAlpha = alpha;

    for (const edge of edges) {
      const w1 = words[edge.from];
      const w2 = words[edge.to];
      if (!w1 || !w2 || !w1.revealed || !w2.revealed) continue;

      ctx.beginPath();
      ctx.moveTo(w1.x, w1.y);
      ctx.lineTo(w2.x, w2.y);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    for (const w of words) {
      if (!w.revealed) continue;
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.45 * alpha})`;
      ctx.font = `600 24px 'Plus Jakarta Sans', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(w.word, w.x, w.y + 6);
      ctx.restore();
    }

    ctx.restore();
  }

  renderBackgroundStars(ctx, time) {
    for (const star of this.manager.ambientStars) {
      const alpha = star.alpha + Math.sin(time * star.twinkleSpeed * 100 + star.phase) * 0.25;
      if (alpha <= 0) continue;

      const sx = star.x * this.width;
      const sy = star.y * this.height;

      ctx.fillStyle = `rgba(255, 250, 240, ${Math.max(0, Math.min(1, alpha * 0.55))})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderEdges(ctx) {
    const words = this.manager.words;
    const edges = this.manager.edges;

    ctx.save();
    for (const edge of edges) {
      if (edge.progress <= 0.01) continue;

      const w1 = words[edge.from];
      const w2 = words[edge.to];
      if (!w1 || !w2 || !w1.revealed || !w2.revealed) continue;

      // Draw progressive connection line
      const currentX = w1.x + (w2.x - w1.x) * edge.progress;
      const currentY = w1.y + (w2.y - w1.y) * edge.progress;

      const isLineActive = w1.active || w2.active;

      ctx.beginPath();
      ctx.moveTo(w1.x, w1.y);
      ctx.lineTo(currentX, currentY);

      if (isLineActive) {
        ctx.strokeStyle = `rgba(255, 235, 210, ${0.65 * edge.progress})`;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = `rgba(${this.primaryColor.r}, ${this.primaryColor.g}, ${this.primaryColor.b}, 0.85)`;
        ctx.shadowBlur = 12;
      } else {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 * edge.progress})`;
        ctx.lineWidth = 1.1;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  renderWords(ctx, time) {
    const words = this.manager.words;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // ONLY render revealed words!
      if (!w.revealed || w.revealProgress <= 0.01) continue;

      const progress = w.revealProgress;
      const scale = w.activeScale * (0.85 + 0.15 * progress);
      const glow = w.glowIntensity;

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.globalAlpha = progress;

      // Star vertex dot - ENLARGED
      const starRadius = (w.active ? 6.2 : 4.0) * scale;
      ctx.fillStyle = w.active ? '#ffffff' : 'rgba(255, 255, 255, 0.82)';
      ctx.beginPath();
      ctx.arc(0, 0, starRadius, 0, Math.PI * 2);
      ctx.fill();

      // Word Typography - BOLD CINEMATIC SIZE (adaptive to word density)
      const count = this.manager.words.length;
      let baseActiveFont = 48;
      let baseInactiveFont = 30;
      if (count >= 14) {
        baseActiveFont = 36;
        baseInactiveFont = 23;
      } else if (count >= 10) {
        baseActiveFont = 42;
        baseInactiveFont = 26;
      }

      const fontSize = Math.round((w.active ? baseActiveFont : baseInactiveFont) * scale);
      ctx.font = `${w.active ? '700' : '600'} ${fontSize}px 'Plus Jakarta Sans', -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      if (w.active) {
        // Multi-layered bright halo for active word
        ctx.shadowColor = 'rgba(255, 255, 255, 0.95)';
        ctx.shadowBlur = 32 * glow;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(w.word, 0, 12);

        // Album-tinted outer flare
        ctx.shadowColor = `rgba(${this.primaryColor.r}, ${this.primaryColor.g}, ${this.primaryColor.b}, 0.95)`;
        ctx.shadowBlur = 54 * glow;
        ctx.fillText(w.word, 0, 12);
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(w.word, 0, 9);
      }

      ctx.restore();
    }
  }

  renderReticle(ctx, dt, time) {
    const activeTarget = this.manager.getActiveWordPosition();

    if (activeTarget) {
      if (this.reticleX < 0) {
        this.reticleX = activeTarget.x;
        this.reticleY = activeTarget.y;
      }

      // Adaptive high-agility spring glide toward active word (eliminates rap delay)
      const cadence = this.manager.currentCadence || 2.0;
      const agility = Math.max(1.0, Math.min(3.8, cadence / 2.0));

      const dx = activeTarget.x - this.reticleX;
      const dy = activeTarget.y - this.reticleY;
      const dist = Math.hypot(dx, dy);

      // Base agility scales with vocal flow; boost speed if reticle is trailing target
      let speedFactor = 16 * agility;
      if (dist > 150 && agility > 1.2) {
        speedFactor += (dist / 14) * (agility * 0.7);
      }

      const lerpSpeed = Math.min(1.0, dt * speedFactor);
      this.reticleX += dx * lerpSpeed;
      this.reticleY += dy * lerpSpeed;
      this.reticleAlpha += (1.0 - this.reticleAlpha) * Math.min(1, dt * 14);

      // Spawn stardust sparkles
      if (Math.random() < (agility > 1.4 ? 0.65 : 0.45)) {
        this.stardustParticles.push({
          x: this.reticleX + (Math.random() - 0.5) * 26,
          y: this.reticleY + (Math.random() - 0.5) * 26,
          vx: (Math.random() - 0.5) * 32,
          vy: (Math.random() - 0.5) * 32 - 14,
          alpha: 1.0,
          size: Math.random() * 3.0 + 1.2
        });
      }
    } else {
      this.reticleAlpha += (0.0 - this.reticleAlpha) * Math.min(1, dt * 6);
    }

    if (this.reticleAlpha < 0.02) return;

    ctx.save();
    ctx.translate(this.reticleX, this.reticleY);
    ctx.globalAlpha = this.reticleAlpha;

    // 1. Outer target ring - ENLARGED
    const ringRadius = 42 + Math.sin(time * 3) * 2.5;
    ctx.strokeStyle = `rgba(255, 240, 220, 0.65)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Glowing 4-point crosshair star spikes - MAJESTIC LARGE SIZE
    const pulse = 1.0 + Math.sin(time * 4) * 0.12;
    const spikeLen = 78 * pulse;
    const spikeWidth = 5.4;

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = `rgba(${this.primaryColor.r}, ${this.primaryColor.g}, ${this.primaryColor.b}, 0.95)`;
    ctx.shadowBlur = 32;

    // Vertical & horizontal diamond flares
    this.drawDiamondFlare(ctx, 0, 0, spikeLen, spikeWidth);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth, spikeLen);

    // Diagonal smaller flares
    ctx.save();
    ctx.rotate(Math.PI / 4);
    this.drawDiamondFlare(ctx, 0, 0, spikeLen * 0.48, spikeWidth * 0.72);
    this.drawDiamondFlare(ctx, 0, 0, spikeWidth * 0.72, spikeLen * 0.48);
    ctx.restore();

    // Radiant star center
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.4, 'rgba(255, 245, 225, 0.95)');
    coreGrad.addColorStop(1, 'rgba(255, 200, 150, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawDiamondFlare(ctx, cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + w, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - w, cy);
    ctx.closePath();
    ctx.fill();
  }

  renderStardust(ctx, dt) {
    ctx.save();
    for (let i = this.stardustParticles.length - 1; i >= 0; i--) {
      const p = this.stardustParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 1.6;

      if (p.alpha <= 0) {
        this.stardustParticles.splice(i, 1);
        continue;
      }

      ctx.fillStyle = `rgba(255, 240, 220, ${p.alpha})`;
      ctx.shadowColor = `rgba(${this.primaryColor.r}, ${this.primaryColor.g}, ${this.primaryColor.b}, 0.8)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
