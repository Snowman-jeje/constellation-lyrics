/**
 * Constellation Graph and Layout Engine
 * Words appear sequentially ONE BY ONE as they are sung ("keluar satu persatu").
 * Features instant line transition with smooth stardust dissolution (no delay between lines).
 */

class ConstellationManager {
  constructor() {
    this.currentLineIndex = -1;
    this.words = []; // Array of word node objects
    this.edges = []; // Array of [index1, index2] connecting lines
    this.activeWordIndex = -1;
    
    // Outgoing constellation for zero-delay smooth cross-dissolve
    this.outgoingWords = [];
    this.outgoingEdges = [];
    this.outgoingAlpha = 0.0;

    // Ambient stars for background and instrumental fallback
    this.ambientStars = [];
    this.initAmbientStars(90);
  }

  initAmbientStars(count) {
    this.ambientStars = [];
    for (let i = 0; i < count; i++) {
      this.ambientStars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.8 + 0.6,
        alpha: Math.random() * 0.7 + 0.2,
        twinkleSpeed: Math.random() * 0.03 + 0.01,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  setLine(lineData, width, height) {
    if (!lineData || !lineData.words || lineData.words.length === 0) {
      if (this.words.length > 0) {
        this.outgoingWords = this.words.map(w => ({
          ...w,
          vx: (Math.random() - 0.5) * 20,
          vy: -Math.random() * 18 - 6
        }));
        this.outgoingEdges = [...this.edges];
        this.outgoingAlpha = 0.8;
      }
      this.words = [];
      this.edges = [];
      this.currentLineIndex = -1;
      return;
    }

    if (this.currentLineIndex === lineData.line_index) return;

    // Stash current constellation as outgoing for seamless dissolve
    if (this.words.length > 0) {
      this.outgoingWords = this.words.map(w => ({
        ...w,
        vx: (Math.random() - 0.5) * 24,
        vy: -Math.random() * 22 - 8
      }));
      this.outgoingEdges = [...this.edges];
      this.outgoingAlpha = 0.75;
    }

    this.currentLineIndex = lineData.line_index;
    // Filter out parenthetical lyrics and ad-libs in frontend
    const rawWords = (lineData.words || []).filter(w => {
      const txt = (w.word || '').trim();
      return txt && !txt.startsWith('(') && !txt.endsWith(')') && !txt.includes('(') && !txt.includes(')');
    });
    const count = rawWords.length;

    // Calculate cadence (words per second - WPS) for adaptive rap agility
    const lineStart = lineData.start_time || 0;
    const lineEnd = lineData.end_time || (lineStart + 4.0);
    const lineDuration = Math.max(0.6, lineEnd - lineStart);
    const cadence = count / lineDuration;
    this.currentCadence = cadence;

    // Center area bounds - EXPANDED to full cinematic 88% width x 74% height
    const minX = width * 0.08;
    const maxX = width * 0.92;
    const minY = height * 0.14;
    const maxY = height * 0.80;
    const centerX = width * 0.5;
    const centerY = height * 0.47;

    const spanX = maxX - minX;
    const spanY = maxY - minY;

    // Deterministic pseudo-random seed from line text
    let hash = 0;
    for (let i = 0; i < lineData.text.length; i++) {
      hash = (hash << 5) - hash + lineData.text.charCodeAt(i);
      hash |= 0;
    }

    const prng = (seed) => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Fast rap / dense lyric flow detection (count >= 8 or cadence >= 2.8 wps)
    const isRapidFlow = count >= 8 || cadence >= 2.8;
    const patternType = Math.abs(hash) % 3;

    const newWords = [];
    for (let i = 0; i < count; i++) {
      const w = rawWords[i];
      const r1 = prng(hash + i * 19);
      const r2 = prng(hash + i * 37);

      const progress = count > 1 ? i / (count - 1) : 0.5;

      // Broad horizontal layout across the entire screen
      let posX = minX + progress * spanX;
      posX += (r1 - 0.5) * (spanX / Math.max(3, count)) * (isRapidFlow ? 0.35 : 0.6);

      let posY = centerY;
      if (isRapidFlow) {
        // Rhythmic Cosmic Stream: gentle undulating curve with smooth proximity between words
        // Eliminates erratic 600px vertical leaps so reticle and eyes track rapid syllables effortlessly
        const flowWave = Math.sin(progress * Math.PI * 2.2 + (hash % 4)) * (spanY * 0.28);
        const microJitter = (r2 - 0.5) * (spanY * 0.16);
        posY = centerY + flowWave + microJitter;
      } else {
        // Expansive Celestial Archetypes for moderate/slow lyrics
        if (patternType === 0) {
          // High-low alternating zigzag constellation (like Cassiopeia / Pegasus)
          const altitude = (i % 2 === 0 ? -1 : 1) * (0.35 + 0.3 * r2);
          posY = centerY + altitude * (spanY * 0.5);
        } else if (patternType === 1) {
          // Wide soaring parabola / arch across the stars (like Orion / Ursa Major)
          const arch = Math.sin(progress * Math.PI) * (spanY * 0.48);
          const sign = (hash % 2 === 0) ? -1 : 1;
          posY = centerY + sign * arch + (r2 - 0.5) * (spanY * 0.25);
        } else {
          // Celestial wave sweeping across high and low horizons
          const wave = Math.sin(progress * Math.PI * 1.8 + (hash % 5)) * (spanY * 0.44);
          posY = centerY + wave + (r2 - 0.5) * (spanY * 0.22);
        }
      }

      // Constrain strictly within screen margins
      const targetX = Math.max(minX, Math.min(maxX, posX));
      const targetY = Math.max(minY, Math.min(maxY, posY));

      newWords.push({
        index: i,
        word: w.word,
        start: w.start,
        end: w.end,
        x: targetX,
        y: targetY,
        baseX: targetX,
        baseY: targetY,
        phase: r1 * Math.PI * 2,
        revealed: false,
        revealProgress: 0.0,
        active: false,
        activeScale: 1.0,
        glowIntensity: 0.0
      });
    }

    // Adaptive relaxation step: prevent crowding while preserving fluid stream
    const minDist = isRapidFlow ? Math.max(90, Math.min(130, spanX / (count * 0.95))) : 135;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = newWords[j].x - newWords[i].x;
          const dy = newWords[j].y - newWords[i].y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist && dist > 0.001) {
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            newWords[i].x = Math.max(minX, Math.min(maxX, newWords[i].x - nx * overlap));
            newWords[i].y = Math.max(minY, Math.min(maxY, newWords[i].y - ny * overlap));
            newWords[j].x = Math.max(minX, Math.min(maxX, newWords[j].x + nx * overlap));
            newWords[j].y = Math.max(minY, Math.min(maxY, newWords[j].y + ny * overlap));
            newWords[i].baseX = newWords[i].x;
            newWords[i].baseY = newWords[i].y;
            newWords[j].baseX = newWords[j].x;
            newWords[j].baseY = newWords[j].y;
          }
        }
      }
    }

    // Build constellation edges
    const newEdges = [];
    for (let i = 0; i < count; i++) {
      if (i + 1 < count) {
        newEdges.push({ from: i, to: i + 1, progress: 0.0 });
      }
      let nearestDist = Infinity;
      let nearestIdx = -1;
      for (let j = 0; j < count; j++) {
        if (i === j || j === i + 1 || j === i - 1) continue;
        const dx = newWords[i].x - newWords[j].x;
        const dy = newWords[i].y - newWords[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < nearestDist && dist < spanX * 0.48) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }
      if (nearestIdx !== -1) {
        const exists = newEdges.some(e => (e.from === i && e.to === nearestIdx) || (e.from === nearestIdx && e.to === i));
        if (!exists) {
          newEdges.push({ from: i, to: nearestIdx, progress: 0.0 });
        }
      }
    }

    this.words = newWords;
    this.edges = newEdges;
  }

  update(currentPosition, dt) {
    const time = performance.now() * 0.001;

    // 1. Dissolve outgoing constellation without blocking
    if (this.outgoingAlpha > 0.01) {
      this.outgoingAlpha -= dt * 2.2;
      for (const w of this.outgoingWords) {
        w.x += w.vx * dt;
        w.y += w.vy * dt;
      }
    } else {
      this.outgoingAlpha = 0.0;
      this.outgoingWords = [];
      this.outgoingEdges = [];
    }

    let activeIdx = -1;

    // Dynamic agility multiplier for fast rap flow (fluid, no discrete teleportation)
    const cadence = this.currentCadence || 2.0;
    const agilityMultiplier = Math.max(1.0, Math.min(2.8, cadence / 2.2));
    const revealRate = 22 * agilityMultiplier;
    const scaleRate = 16 * agilityMultiplier;
    const glowRate = 14 * agilityMultiplier;
    const edgeRate = 18 * agilityMultiplier;

    // 2. Reveal active words ONE BY ONE as audio reaches them (smooth blooming)
    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i];

      if (currentPosition >= w.start) {
        w.revealed = true;
        // Fluid continuous ease-in (no sudden jarring snap)
        w.revealProgress += (1.0 - w.revealProgress) * Math.min(1, dt * revealRate);
      } else {
        w.revealed = false;
        w.revealProgress = 0.0;
      }

      const isSinging = (currentPosition >= w.start && currentPosition <= w.end);
      if (isSinging) {
        activeIdx = i;
      }

      // Celestial floating (smooth organic micro-motion)
      w.x = w.baseX + Math.sin(time * 0.8 + w.phase) * (agilityMultiplier > 1.4 ? 3.0 : 5.0);
      w.y = w.baseY + Math.cos(time * 0.7 + w.phase) * (agilityMultiplier > 1.4 ? 3.0 : 5.0);
    }

    if (activeIdx === -1 && this.words.length > 0) {
      for (let i = this.words.length - 1; i >= 0; i--) {
        if (this.words[i].revealed) {
          activeIdx = i;
          break;
        }
      }
    }

    this.activeWordIndex = activeIdx;

    // Update active word glow & scale with smooth exponential curves
    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i];
      const isActive = (i === activeIdx && w.revealed);
      w.active = isActive;

      const targetScale = isActive ? 1.35 : 1.0;
      const targetGlow = isActive ? 1.0 : 0.0;
      w.activeScale += (targetScale - w.activeScale) * Math.min(1, dt * scaleRate);
      w.glowIntensity += (targetGlow - w.glowIntensity) * Math.min(1, dt * glowRate);
    }

    // 3. Progressive line drawing: laser-smooth growth
    for (const edge of this.edges) {
      const wFrom = this.words[edge.from];
      const wTo = this.words[edge.to];
      if (wFrom && wTo && wFrom.revealed && wTo.revealed) {
        edge.progress += (1.0 - edge.progress) * Math.min(1, dt * edgeRate);
      } else {
        edge.progress = 0.0;
      }
    }
  }

  getActiveWordPosition() {
    if (this.activeWordIndex >= 0 && this.activeWordIndex < this.words.length) {
      const w = this.words[this.activeWordIndex];
      if (w.revealed) {
        return { x: w.x, y: w.y, word: w.word };
      }
    }
    return null;
  }
}
