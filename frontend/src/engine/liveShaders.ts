import type { LiveSceneKind } from '../types/suite';

export const LIVE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_COMMON = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_beat;
uniform float u_bass;
uniform float u_reaction;
uniform float u_speed;
uniform vec3 u_color1;
uniform vec3 u_color2;

const vec3 VOID_BASE = vec3(0.027, 0.027, 0.036);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * noise2d(p);
    p = rot * p * 2.03 + vec2(11.3, 7.1);
    amp *= 0.5;
  }
  return value;
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec2 aspectUv() {
  vec2 p = v_uv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;
  return p;
}

vec4 finishColor(vec3 col) {
  // Filmic soft shoulder compression preserving deep obsidian shadows
  col = max(col, vec3(0.0));
  col = VOID_BASE + col / (1.0 + col * 0.65);
  // Subtle ordered micro-dither to prevent 8-bit gradient banding
  float dither = (hash21(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.005;
  return vec4(clamp(col + dither, 0.0, 1.0), 1.0);
}
`;

const SHADER_BODIES: Record<LiveSceneKind, string> = {
  aurora: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.32;
  float pulse = 1.0 + (u_beat * 0.35 + u_bass * 0.25) * u_reaction;

  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float bandOffset = (fi - 1.5) * 0.24;
    float wave = sin(p.x * (1.2 + fi * 0.25) + t * (0.8 + fi * 0.14) + fi * 1.7) * 0.24;
    wave += (fbm(vec2(p.x * 1.15 + t * 0.35, fi * 2.3 + t * 0.12)) - 0.5) * 0.42;

    float yDist = abs(p.y - (bandOffset + wave));
    float curtain = exp(-yDist * (5.2 - fi * 0.45));
    float shimmer = 0.55 + 0.45 * noise2d(vec2(p.x * 7.5 - t * 1.1, p.y * 2.2 + fi));
    float upwardFade = smoothstep(-0.9, 0.55, p.y - wave * 0.5);

    vec3 tint = mix(u_color1, u_color2, fi / 3.0);
    col += tint * curtain * shimmer * upwardFade * (0.28 * pulse);
  }

  // Subtle ambient star specks in upper sky
  vec2 starCell = floor(v_uv * vec2(110.0, 62.0));
  float starRnd = hash21(starCell);
  if (starRnd > 0.992) {
    float twinkle = 0.45 + 0.55 * sin(u_time * 2.2 + starRnd * 62.8);
    col += mix(u_color1, vec3(0.96, 0.95, 0.92), 0.7) * twinkle * 0.22;
  }

  fragColor = finishColor(col);
}
`,

  orb: `
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.42;
  float react = (u_beat * 0.16 + u_bass * 0.14) * u_reaction;

  vec2 c1 = vec2(sin(t * 0.7) * 0.55, cos(t * 0.53) * 0.26);
  vec2 c2 = vec2(cos(t * 0.61 + 1.4) * 0.62, sin(t * 0.79 + 0.8) * 0.34);
  vec2 c3 = vec2(sin(t * 0.47 + 3.1) * 0.36, cos(t * 0.68 + 2.2) * 0.42);

  float d1 = length(p - c1) - (0.34 + react * 0.45);
  float d2 = length(p - c2) - (0.26 + react * 0.30);
  float d3 = length(p - c3) - (0.21 + react * 0.25);

  float d = smin(smin(d1, d2, 0.32), d3, 0.28);

  float core = 1.0 - smoothstep(-0.22, 0.08, d);
  float rim = exp(-abs(d) * 14.0);
  float halo = exp(-max(d, 0.0) * 2.8);
  float ring = exp(-abs(d - 0.16 - react * 0.22) * 26.0) * 0.55;

  float caustic = fbm(p * 3.0 + vec2(t * 0.4, -t * 0.3));
  vec3 tint = mix(u_color1, u_color2, smoothstep(-0.6, 0.7, p.x + caustic * 0.35));

  vec3 col = tint * halo * (0.36 + react * 0.9);
  col += mix(tint, vec3(0.96, 0.95, 0.93), 0.45) * rim * (0.42 + react * 0.6);
  col += u_color2 * ring * (0.5 + u_beat * u_reaction);
  col += tint * core * (0.22 + caustic * 0.28);

  fragColor = finishColor(col);
}
`,

  sea: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.45;
  float react = (u_bass * 0.25 + u_beat * 0.2) * u_reaction;

  float horizon = 0.08;
  vec3 col = vec3(0.0);

  if (p.y > horizon) {
    float skyH = clamp((p.y - horizon) / 1.1, 0.0, 1.0);
    vec3 glow = mix(u_color1, u_color2, 0.45) * exp(-skyH * 3.8) * (0.32 + react * 0.45);
    float moon = exp(-length(p - vec2(0.0, 0.42)) * 3.2);
    col += glow + mix(u_color1, vec3(0.96, 0.94, 0.90), 0.5) * moon * 0.24;
  } else {
    float depth = max(0.035, horizon - p.y);
    vec2 seaUv = vec2(p.x / depth * 0.48, 1.25 / depth + t * 0.9);
    float w1 = fbm(seaUv * 0.85 + vec2(t * 0.22, 0.0));
    float w2 = fbm(seaUv * 1.9 - vec2(0.0, t * 0.55));
    float crest = smoothstep(0.54 - react * 0.08, 0.84, w1 * 0.6 + w2 * 0.45);

    float specBand = exp(-abs(p.x) * (2.6 + depth * 2.2));
    float distFade = smoothstep(0.02, 0.48, depth);

    vec3 waterBody = mix(u_color2, u_color1, w1) * (0.18 + depth * 0.22);
    vec3 specular = mix(u_color1, vec3(0.96, 0.95, 0.92), 0.6) * crest * (0.35 + specBand * 0.85) * (1.0 + react * 0.8);
    col += (waterBody + specular) * distFade;
  }

  float mistLine = exp(-abs(p.y - horizon) * 16.0);
  col += mix(u_color1, u_color2, 0.5) * mistLine * 0.28;

  fragColor = finishColor(col);
}
`,

  dream: `
void main() {
  vec2 p = aspectUv() * 1.15;
  float t = u_time * 0.18;
  float react = (u_bass * 0.32 + u_beat * 0.24) * u_reaction;

  vec2 q = vec2(
    fbm(p + vec2(t * 0.7, t * 0.3)),
    fbm(p + vec2(5.2 - t * 0.5, 1.3 + t * 0.4))
  );

  vec2 r = vec2(
    fbm(p + 2.2 * q + vec2(1.7, 9.2) + t * 0.35),
    fbm(p + 2.2 * q + vec2(8.3, 2.8) - t * 0.28)
  );

  float f = fbm(p + 2.0 * r);
  float veil = smoothstep(0.22, 0.86, f);

  vec3 cA = mix(u_color1, u_color2, clamp(q.x * 1.25, 0.0, 1.0));
  vec3 cB = mix(u_color2, vec3(0.84, 0.73, 0.55), clamp(r.y * 1.15, 0.0, 1.0));

  float radial = exp(-length(p) * 0.68);
  vec3 col = mix(cA, cB, veil) * (0.28 + veil * 0.42) * (0.65 + 0.55 * radial);
  col *= 1.0 + react * 0.85;

  fragColor = finishColor(col);
}
`,

  fall: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.85;
  float react = (u_beat * 0.38 + u_bass * 0.22) * u_reaction;

  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 14.0 + fi * 11.0;
    vec2 grid = vec2(p.x * scale + fi * 3.1, p.y * (1.8 + fi * 0.4) + t * (0.9 + fi * 0.35));
    float colId = floor(grid.x);
    float colOffset = hash21(vec2(colId, fi * 17.0));
    float localX = abs(fract(grid.x) - 0.5);

    float stream = 1.0 - smoothstep(0.02, 0.22, localX);
    float dropPhase = fract(grid.y * 0.22 + colOffset * 7.3);
    float tail = smoothstep(0.0, 0.65, dropPhase) * (1.0 - smoothstep(0.72, 1.0, dropPhase));
    float intensity = stream * tail * (0.4 + 0.6 * colOffset);

    vec3 tint = mix(u_color1, u_color2, fi / 2.0);
    col += tint * intensity * (0.26 + react * 0.45);
  }

  // Rising basal mist curtain
  float baseMist = exp(-max(p.y + 0.85, 0.0) * 3.2);
  float mistNoise = fbm(vec2(p.x * 2.5 - u_time * 0.2, p.y * 2.0));
  col += mix(u_color1, u_color2, 0.5) * baseMist * mistNoise * (0.35 + react * 0.5);

  fragColor = finishColor(col);
}
`,

  silk: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.36;
  float react = (u_beat * 0.25 + u_bass * 0.25) * u_reaction;

  vec3 col = vec3(0.0);
  vec2 q = p * rot2(0.28);

  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float phase = fi * 0.95 + t * (0.75 + fi * 0.08);
    float fold = sin(q.x * (2.1 + fi * 0.22) + phase) * 0.34;
    fold += cos(q.x * 1.15 - t * 0.5 + fi) * 0.18;

    float dist = abs(q.y - (fold + (fi - 2.0) * 0.18));
    float ribbon = exp(-dist * 7.5);
    float specular = exp(-dist * 34.0);

    vec3 tint = mix(u_color1, u_color2, fi / 4.0);
    col += tint * ribbon * (0.16 + react * 0.22);
    col += mix(tint, vec3(0.96, 0.95, 0.92), 0.5) * specular * (0.18 + react * 0.35);
  }

  fragColor = finishColor(col);
}
`,

  shoal: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.38;
  float react = (u_beat * 0.32 + u_bass * 0.28) * u_reaction;

  vec3 col = vec3(0.0);
  vec2 flow = p;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float angle = fbm(flow * 1.15 + vec2(t * 0.22, fi * 1.3)) * 3.14159;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 streamUv = flow * (2.4 + fi * 0.7) + dir * 0.55 - vec2(t * (0.45 + fi * 0.12), 0.0);

    float wave = sin(streamUv.y * 4.5 + sin(streamUv.x * 2.2) * 1.6);
    float filament = pow(max(0.0001, 1.0 - abs(wave)), 4.0);
    float envelope = 1.0 - smoothstep(0.15, 1.35, length(p * vec2(0.8, 1.15)));

    vec3 tint = mix(u_color1, u_color2, fi / 3.0);
    col += tint * filament * envelope * (0.24 + react * 0.35);
    flow = flow * rot2(0.35);
  }

  fragColor = finishColor(col);
}
`,

  veil: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.24;
  float react = (u_bass * 0.26 + u_beat * 0.22) * u_reaction;

  vec2 a = p * rot2(0.42);
  vec2 b = p * rot2(-0.36);

  float sheet1 = sin(a.x * 3.2 + t * 0.9 + fbm(a * 1.5) * 2.1);
  float sheet2 = sin(b.x * 2.7 - t * 0.75 + fbm(b * 1.7 + 3.0) * 1.9);

  float fold1 = exp(-abs(sheet1) * 2.6);
  float fold2 = exp(-abs(sheet2) * 2.9);
  float moire = fold1 * fold2;

  float horizonGlow = exp(-abs(p.y + 0.15) * 2.4);
  vec3 col = u_color1 * fold1 * 0.26 + u_color2 * fold2 * 0.24;
  col += mix(u_color1, vec3(0.96, 0.95, 0.92), 0.35) * moire * (0.34 + react * 0.55);
  col += mix(u_color1, u_color2, 0.5) * horizonGlow * 0.16;

  fragColor = finishColor(col);
}
`,

  lane: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 1.15;
  float react = (u_beat * 0.4 + u_bass * 0.25) * u_reaction;

  float yAbs = max(0.055, abs(p.y));
  float z = 1.0 / yAbs;
  float xProj = p.x * z;

  float railMask = exp(-abs(abs(xProj) - 1.35) * 4.5) + exp(-abs(abs(xProj) - 0.55) * 5.5) * 0.55;
  float dash = smoothstep(0.15, 0.85, sin(z * 1.45 - t * 2.4) * 0.5 + 0.5);
  float pulseWave = exp(-abs(fract(z * 0.18 - t * 0.45) - 0.5) * 8.0) * (0.4 + react * 1.4);

  float centerMask = smoothstep(0.04, 0.42, abs(p.y));
  float vanishGlow = exp(-length(p * vec2(0.85, 2.2)) * 2.1);

  vec3 rails = mix(u_color1, u_color2, clamp(abs(p.x), 0.0, 1.0)) * railMask * (0.35 + dash * 0.65 + pulseWave);
  vec3 core = mix(u_color1, vec3(0.95, 0.92, 0.86), 0.35) * vanishGlow * (0.28 + react * 0.45);

  vec3 col = rails * centerMask * 0.55 + core;
  fragColor = finishColor(col);
}
`,

  tide: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.72;
  float react = (u_beat * 0.34 + u_bass * 0.28) * u_reaction;

  vec2 e1 = vec2(cos(t * 0.31) * 0.38, sin(t * 0.27) * 0.18);
  vec2 e2 = vec2(sin(t * 0.25 + 2.0) * 0.42, cos(t * 0.34 + 1.1) * 0.22);

  float d1 = length(p - e1);
  float d2 = length(p - e2);

  float wave1 = sin(d1 * 18.0 - t * 3.1) * exp(-d1 * 1.55);
  float wave2 = sin(d2 * 16.0 - t * 2.7) * exp(-d2 * 1.55);
  float crest = pow(max(0.0001, (wave1 + wave2) * 0.5 + 0.35), 2.2);

  float ringBeat = exp(-abs(d1 - fract(t * 0.25) * 1.4) * 18.0) * (0.25 + react * 0.9);
  vec3 tint = mix(u_color1, u_color2, clamp(0.5 + (wave1 - wave2) * 0.5, 0.0, 1.0));

  vec3 col = tint * crest * (0.34 + react * 0.45) + u_color1 * ringBeat * 0.35;
  fragColor = finishColor(col);
}
`,

  city: `
float bokehLayer(vec2 uv, float scale, float seed, float timeOffset) {
  vec2 st = uv * scale + vec2(0.0, timeOffset);
  vec2 id = floor(st);
  vec2 f = fract(st) - 0.5;

  float rnd = hash21(id + seed);
  float rnd2 = hash21(id * 1.7 + seed + 9.2);
  if (rnd < 0.62) return 0.0;

  vec2 center = (vec2(rnd, rnd2) - 0.5) * 0.45;
  float dist = length(f - center);
  float radius = 0.14 + 0.18 * rnd2;
  float disc = 1.0 - smoothstep(radius * 0.35, radius, dist);
  float twinkle = 0.65 + 0.35 * sin(u_time * (1.2 + rnd2 * 1.8) + rnd * 24.0);
  return disc * twinkle;
}

void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.18;
  float react = (u_beat * 0.36 + u_bass * 0.25) * u_reaction;

  float b1 = bokehLayer(p, 3.2, 1.0, t * 0.35);
  float b2 = bokehLayer(p + vec2(0.37, 0.19), 5.6, 17.0, t * 0.55);
  float b3 = bokehLayer(p - vec2(0.21, 0.44), 8.4, 43.0, t * 0.8);

  // Subtle wet window vertical streak sheen
  float streak = noise2d(vec2(p.x * 18.0, p.y * 1.4 + t * 2.2));
  float wetSheen = smoothstep(0.68, 0.96, streak) * 0.14;

  vec3 col = u_color1 * b1 * (0.42 + react * 0.5);
  col += u_color2 * b2 * (0.34 + react * 0.4);
  col += mix(u_color1, vec3(0.95, 0.90, 0.82), 0.4) * b3 * 0.24;
  col += mix(u_color1, u_color2, 0.5) * wetSheen;

  // Warm urban horizon reflection glow
  col += mix(u_color1, u_color2, 0.5) * exp(-abs(p.y + 0.28) * 2.8) * 0.18;

  fragColor = finishColor(col);
}
`,

  wall: `
void main() {
  vec2 p = aspectUv();
  float t = u_time * 0.26;
  float react = (u_beat * 0.26 + u_bass * 0.22) * u_reaction;

  // Architectural fluted stone profile
  float flutes = 26.0;
  float phase = p.x * flutes;
  float slope = cos(phase);
  vec3 normal = normalize(vec3(slope * 0.42, 0.06, 0.9));

  // Slow raking gallery wash spotlight
  vec3 lightPos = vec3(sin(t * 0.7) * 0.75, 0.38 + cos(t * 0.45) * 0.18, 0.82);
  vec3 toLight = lightPos - vec3(p, 0.0);
  float dist = length(toLight);
  vec3 lightDir = toLight / max(dist, 0.001);

  float diff = max(dot(normal, lightDir), 0.0);
  float atten = exp(-dist * (1.55 - react * 0.35));
  float grain = noise2d(p * vec2(12.0, 28.0)) * 0.06;

  vec3 washTint = mix(u_color1, u_color2, smoothstep(-1.0, 1.0, p.x));
  vec3 col = washTint * (diff * atten * (0.72 + react * 0.55) + grain * atten);
  col += u_color1 * exp(-length(p - lightPos.xy) * 1.9) * 0.16;

  fragColor = finishColor(col);
}
`,
};

export function getLiveFragmentShader(scene: LiveSceneKind): string {
  const body = SHADER_BODIES[scene] ?? SHADER_BODIES.aurora;
  return `${FRAG_COMMON}\n${body}`;
}

export const LIVE_SCENE_IDS: LiveSceneKind[] = [
  'aurora',
  'orb',
  'sea',
  'dream',
  'fall',
  'silk',
  'shoal',
  'veil',
  'lane',
  'tide',
  'city',
  'wall',
];
