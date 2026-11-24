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
  isFacet?: boolean;
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

    const minX = width * 0.12;
    const maxX = width * 0.88;
    const minY = height * 0.22;
    const maxY = height * 0.72;
    const centerY = height * 0.47;

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
    const patternType = Math.abs(hash) % 5;

    const newWords: WordNode[] = [];
    for (let i = 0; i < count; i++) {
      const w = rawWords[i];
      const r1 = prng(hash + i * 19);
      const r2 = prng(hash + i * 37);
      const progress = count > 1 ? i / (count - 1) : 0.5;

      let posX = minX + spanX * 0.5;
      let posY = centerY;

      if (count === 1) {
        posX = minX + spanX * 0.5;
        posY = centerY;
      } else if (isRapidFlow) {
        // High cadence rap flow: dynamic sweeping celestial curve with fast forward momentum
        posX = minX + progress * spanX + (r1 - 0.5) * (spanX / count) * 0.45;
        const wave = Math.sin(progress * Math.PI * 2.4 + (hash % 6)) * (spanY * 0.32);
        const microJitter = (r2 - 0.5) * (spanY * 0.16);
        posY = centerY + wave + microJitter;
      } else if (patternType === 0) {
        // Pattern 0: Spiral Nebula (Logarithmic Galactic Whirl)
        const dir = hash % 2 === 0 ? 1 : -1;
        const totalRevolutions = 1.35 + 0.35 * ((hash >> 1) % 3);
        const theta0 = ((hash % 12) / 12) * Math.PI * 2;
        const theta = theta0 + dir * progress * Math.PI * 2 * totalRevolutions;
        const maxRadius = Math.min(spanX * 0.44, spanY * 0.46);
        const minRadius = Math.max(28, maxRadius * 0.16);
        const radius = minRadius + Math.pow(progress, 0.82) * (maxRadius - minRadius);

        posX = minX + spanX * 0.5 + Math.cos(theta) * radius * 1.08;
        posY = centerY + Math.sin(theta) * radius * 0.88;
      } else if (patternType === 1) {
        // Pattern 1: Astrolabe Orbit (Concentric Ellipses)
        const tiltAngle = (((hash % 7) - 3) * Math.PI) / 18;
        const orbitAngle = ((hash % 8) / 8) * Math.PI * 2 + (progress - 0.5) * Math.PI * 1.85;
        const trackTier = i % 2 === 0 ? 0.74 : 1.08;
        const a = spanX * 0.38 * trackTier;
        const b = spanY * 0.36 * trackTier;
        const rawX = Math.cos(orbitAngle) * a;
        const rawY = Math.sin(orbitAngle) * b;

        posX = minX + spanX * 0.5 + rawX * Math.cos(tiltAngle) - rawY * Math.sin(tiltAngle);
        posY = centerY + rawX * Math.sin(tiltAngle) + rawY * Math.cos(tiltAngle);
      } else if (patternType === 2) {
        // Pattern 2: Diagonal Celestial Shatter (Fractal Zig-Zag Vector)
        const dirX = hash % 2 === 0 ? 1 : -1;
        const dirY = (hash >> 2) % 2 === 0 ? 1 : -1;
        const startX = dirX > 0 ? minX + spanX * 0.08 : maxX - spanX * 0.08;
        const endX = dirX > 0 ? maxX - spanX * 0.08 : minX + spanX * 0.08;
        const startY = dirY > 0 ? minY + spanY * 0.10 : maxY - spanY * 0.10;
        const endY = dirY > 0 ? maxY - spanY * 0.10 : minY + spanY * 0.10;

        const lineX = startX + progress * (endX - startX);
        const lineY = startY + progress * (endY - startY);

        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const zigSign = i % 2 === 0 ? -1 : 1;
        const amplitude = (0.22 + 0.28 * r2) * spanY * 0.42;
        posX = lineX + nx * zigSign * amplitude;
        posY = lineY + ny * zigSign * amplitude;
      } else if (patternType === 3) {
        // Pattern 3: Polyhedral Facet Cluster (Geometric Delaunay Jewel)
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const maxR = Math.min(spanX * 0.42, spanY * 0.44);
        const clusterRadius = maxR * Math.sqrt((i + 1) / count);
        const theta = i * goldenAngle + ((hash % 10) / 10) * Math.PI * 2;

        posX = minX + spanX * 0.5 + Math.cos(theta) * clusterRadius * 1.15 + (r1 - 0.5) * 24;
        posY = centerY + Math.sin(theta) * clusterRadius * 0.88 + (r2 - 0.5) * 24;
      } else {
        // Pattern 4: Freeform Astronomical Constellation (Cassiopeia / Cygnus Map)
        const segmentCount = 4;
        const seg = Math.min(segmentCount - 1, Math.floor(progress * segmentCount));
        const segT = progress * segmentCount - seg;

        const anchors = [
          { x: minX + spanX * 0.06, y: centerY + (hash % 3 === 0 ? -1 : 1) * spanY * 0.38 },
          { x: minX + spanX * 0.32, y: centerY + (hash % 2 === 0 ? 1 : -1) * spanY * 0.28 },
          { x: minX + spanX * 0.52, y: centerY + (hash % 4 === 0 ? -1 : 1) * spanY * 0.42 },
          { x: minX + spanX * 0.74, y: centerY + (hash % 2 === 0 ? -1 : 1) * spanY * 0.26 },
          { x: minX + spanX * 0.94, y: centerY + (hash % 3 === 0 ? 1 : -1) * spanY * 0.36 },
        ];

        const pA = anchors[seg];
        const pB = anchors[seg + 1] || anchors[seg];

        const interpX = pA.x + segT * (pB.x - pA.x);
        const interpY = pA.y + segT * (pB.y - pA.y);

        posX = interpX + (r1 - 0.5) * (spanX * 0.08);
        posY = interpY + (r2 - 0.5) * (spanY * 0.16);
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

    // 6-pass collision & elliptical margin relaxation solver
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = newWords[j].x - newWords[i].x;
          const dy = newWords[j].y - newWords[i].y;

          const lenI = newWords[i].word.length;
          const lenJ = newWords[j].word.length;
          const reqX = Math.max(92, (lenI + lenJ) * 7.5 + 24);
          const reqY = 56;

          const normSq = (dx * dx) / (reqX * reqX) + (dy * dy) / (reqY * reqY);
          if (normSq < 1.0 && normSq > 0.00001) {
            const normDist = Math.sqrt(normSq);
            const overlap = (1.0 - normDist) * 0.5;
            const pushX = (((dx === 0 ? prng(hash + i) - 0.5 : dx) / normDist) * overlap);
            const pushY = (((dy === 0 ? prng(hash + j) - 0.5 : dy) / normDist) * overlap);

            newWords[i].x = Math.max(minX, Math.min(maxX, newWords[i].x - pushX));
            newWords[i].y = Math.max(minY, Math.min(maxY, newWords[i].y - pushY));
            newWords[j].x = Math.max(minX, Math.min(maxX, newWords[j].x + pushX));
            newWords[j].y = Math.max(minY, Math.min(maxY, newWords[j].y + pushY));

            newWords[i].baseX = newWords[i].x;
            newWords[i].baseY = newWords[i].y;
            newWords[j].baseX = newWords[j].x;
            newWords[j].baseY = newWords[j].y;
          }
        }
      }
    }

    const newEdges: ConstellationEdge[] = [];

    // 1. Primary lyric path (i -> i + 1)
    for (let i = 0; i < count - 1; i++) {
      newEdges.push({ from: i, to: i + 1, progress: 0.0, isFacet: false });
    }

    // 2. Secondary celestial facets (triangulation / nearest non-adjacent links)
    for (let i = 0; i < count; i++) {
      const candidates: { idx: number; dist: number }[] = [];
      for (let j = 0; j < count; j++) {
        if (i === j || j === i + 1 || j === i - 1) continue;
        const dx = newWords[i].x - newWords[j].x;
        const dy = newWords[i].y - newWords[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < spanX * 0.44) {
          candidates.push({ idx: j, dist });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
      const maxFacets = Math.min(2, candidates.length);
      for (let k = 0; k < maxFacets; k++) {
        const targetIdx = candidates[k].idx;
        const exists = newEdges.some(
          (e) => (e.from === i && e.to === targetIdx) || (e.from === targetIdx && e.to === i),
        );
        if (!exists) {
          newEdges.push({ from: i, to: targetIdx, progress: 0.0, isFacet: true });
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
