import type { LyricLine } from '../types/music';
import { resolveLineWords } from './lyricTiming';

export interface WordNode {
  index: number;
  word: string;
  start: number;
  end: number;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  phase: number;
  revealed: boolean;
  revealProgress: number;
  active: boolean;
  activeScale: number;
  glowIntensity: number;
}

export interface OutgoingWordNode extends WordNode {
  vx: number;
  vy: number;
}

export interface ConstellationEdge {
  from: number;
  to: number;
  progress: number;
}

export interface AmbientStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinkleSpeed: number;
  phase: number;
}

export class ConstellationManager {
  currentLineIndex = -1;
  words: WordNode[] = [];
  edges: ConstellationEdge[] = [];
  activeWordIndex = -1;
  currentCadence = 2.0;

  outgoingWords: OutgoingWordNode[] = [];
  outgoingEdges: ConstellationEdge[] = [];
  outgoingAlpha = 0.0;

  ambientStars: AmbientStar[] = [];
  private layoutWidth = 0;
  private layoutHeight = 0;

  constructor() {
    this.initAmbientStars(95);
  }

  initAmbientStars(count: number): void {
    this.ambientStars = [];
    for (let i = 0; i < count; i++) {
      this.ambientStars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.7 + 0.55,
        alpha: Math.random() * 0.65 + 0.2,
        twinkleSpeed: Math.random() * 0.025 + 0.008,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  rescaleLayout(width: number, height: number): void {
    if (
      this.layoutWidth > 0 &&
      this.layoutHeight > 0 &&
      width > 0 &&
      height > 0 &&
      (width !== this.layoutWidth || height !== this.layoutHeight)
    ) {
      const sx = width / this.layoutWidth;
      const sy = height / this.layoutHeight;
      for (const w of this.words) {
        w.baseX *= sx;
        w.baseY *= sy;
        w.x *= sx;
        w.y *= sy;
      }
      for (const w of this.outgoingWords) {
        w.baseX *= sx;
        w.baseY *= sy;
        w.x *= sx;
        w.y *= sy;
      }
    }
    this.layoutWidth = width;
    this.layoutHeight = height;
  }

  setLine(
    lineData: LyricLine | null,
    width: number,
    height: number,
    nextLineStart?: number,
  ): void {
    this.layoutWidth = width;
    this.layoutHeight = height;

    if (!lineData) {
      this.triggerOutgoing();
      this.words = [];
      this.edges = [];
      this.currentLineIndex = -1;
      this.activeWordIndex = -1;
      return;
    }

    const resolvedWords = resolveLineWords(lineData, nextLineStart);
    if (resolvedWords.length === 0) {
      this.triggerOutgoing();
      this.words = [];
      this.edges = [];
      this.currentLineIndex = -1;
      this.activeWordIndex = -1;
      return;
    }

    if (this.currentLineIndex === lineData.line_index) return;

    this.triggerOutgoing();
    this.currentLineIndex = lineData.line_index;

    const filtered = resolvedWords.filter((w) => {
      const txt = (w.word || '').trim();
      return txt && !txt.includes('(') && !txt.includes(')');
    });
    const rawWords = filtered.length > 0 ? filtered : resolvedWords.filter((w) => w.word.trim());
    const count = rawWords.length;

    const lineStart = lineData.start_time || 0;
    const lineEnd = lineData.end_time || nextLineStart || lineStart + 4.0;
    const lineDuration = Math.max(0.6, lineEnd - lineStart);
    const cadence = count / lineDuration;
    this.currentCadence = cadence;

    const minX = width * 0.1;
    const maxX = width * 0.9;
    const minY = height * 0.16;
    const maxY = height * 0.76;
    const centerY = height * 0.46;

    const spanX = Math.max(120, maxX - minX);
    const spanY = Math.max(100, maxY - minY);

    let hash = 0;
    for (let i = 0; i < lineData.text.length; i++) {
      hash = (hash << 5) - hash + lineData.text.charCodeAt(i);
      hash |= 0;
    }

    const prng = (seed: number) => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const isRapidFlow = count >= 8 || cadence >= 2.8;
    const patternType = Math.abs(hash) % 3;

    const newWords: WordNode[] = [];
    for (let i = 0; i < count; i++) {
      const w = rawWords[i];
      const r1 = prng(hash + i * 19);
      const r2 = prng(hash + i * 37);
      const progress = count > 1 ? i / (count - 1) : 0.5;

      let posX = minX + progress * spanX;
      posX += (r1 - 0.5) * (spanX / Math.max(3, count)) * (isRapidFlow ? 0.35 : 0.6);

      let posY = centerY;
      if (isRapidFlow) {
        const flowWave = Math.sin(progress * Math.PI * 2.2 + (hash % 4)) * (spanY * 0.28);
        const microJitter = (r2 - 0.5) * (spanY * 0.16);
        posY = centerY + flowWave + microJitter;
      } else if (patternType === 0) {
        const altitude = (i % 2 === 0 ? -1 : 1) * (0.35 + 0.3 * r2);
        posY = centerY + altitude * (spanY * 0.5);
      } else if (patternType === 1) {
        const arch = Math.sin(progress * Math.PI) * (spanY * 0.48);
        const sign = hash % 2 === 0 ? -1 : 1;
        posY = centerY + sign * arch + (r2 - 0.5) * (spanY * 0.25);
      } else {
        const wave = Math.sin(progress * Math.PI * 1.8 + (hash % 5)) * (spanY * 0.44);
        posY = centerY + wave + (r2 - 0.5) * (spanY * 0.22);
      }

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
        glowIntensity: 0.0,
      });
    }

    const minDist = isRapidFlow ? Math.max(84, Math.min(130, spanX / (count * 0.95))) : 132;
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

    const newEdges: ConstellationEdge[] = [];
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
        const exists = newEdges.some(
          (e) => (e.from === i && e.to === nearestIdx) || (e.from === nearestIdx && e.to === i),
        );
        if (!exists) {
          newEdges.push({ from: i, to: nearestIdx, progress: 0.0 });
        }
      }
    }

    this.words = newWords;
    this.edges = newEdges;
  }

  private triggerOutgoing(): void {
    if (this.words.length === 0) return;
    this.outgoingWords = this.words.map((w) => ({
      ...w,
      vx: (Math.random() - 0.5) * 22,
      vy: -Math.random() * 20 - 6,
    }));
    this.outgoingEdges = [...this.edges];
    this.outgoingAlpha = 0.78;
  }

  update(currentPosition: number, dt: number, reducedMotion = false): void {
    const time = performance.now() * 0.001;

    if (this.outgoingAlpha > 0.01) {
      this.outgoingAlpha -= dt * 2.2;
      if (!reducedMotion) {
        for (const w of this.outgoingWords) {
          w.x += w.vx * dt;
          w.y += w.vy * dt;
        }
      }
    } else {
      this.outgoingAlpha = 0.0;
      this.outgoingWords = [];
      this.outgoingEdges = [];
    }

    let activeIdx = -1;
    const cadence = this.currentCadence || 2.0;
    const agilityMultiplier = Math.max(1.0, Math.min(2.8, cadence / 2.2));
    const revealRate = reducedMotion ? 60 : 22 * agilityMultiplier;
    const scaleRate = reducedMotion ? 60 : 16 * agilityMultiplier;
    const glowRate = reducedMotion ? 60 : 14 * agilityMultiplier;
    const edgeRate = reducedMotion ? 60 : 18 * agilityMultiplier;

    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i];

      if (currentPosition >= w.start) {
        if (!w.revealed) {
          w.revealed = true;
          w.revealProgress = Math.max(w.revealProgress, 0.45);
        }
        w.revealProgress += (1.0 - w.revealProgress) * Math.min(1, dt * revealRate);
      } else {
        w.revealed = false;
        w.revealProgress = 0.0;
      }

      if (currentPosition >= w.start && currentPosition <= w.end) {
        activeIdx = i;
      }

      if (reducedMotion) {
        w.x = w.baseX;
        w.y = w.baseY;
      } else {
        const amp = agilityMultiplier > 1.4 ? 2.8 : 4.5;
        w.x = w.baseX + Math.sin(time * 0.8 + w.phase) * amp;
        w.y = w.baseY + Math.cos(time * 0.7 + w.phase) * amp;
      }
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

    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i];
      const isActive = i === activeIdx && w.revealed;
      w.active = isActive;

      const targetScale = isActive ? 1.32 : 1.0;
      const targetGlow = isActive ? 1.0 : 0.0;
      w.activeScale += (targetScale - w.activeScale) * Math.min(1, dt * scaleRate);
      w.glowIntensity += (targetGlow - w.glowIntensity) * Math.min(1, dt * glowRate);
    }

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

  getActiveWordPosition(): { x: number; y: number; word: string } | null {
    if (this.activeWordIndex >= 0 && this.activeWordIndex < this.words.length) {
      const w = this.words[this.activeWordIndex];
      if (w.revealed) {
        return { x: w.x, y: w.y, word: w.word };
      }
    }
    return null;
  }
}
