import { useEffect, useMemo, useRef, useState } from 'react';
import { getLiveFragmentShader, LIVE_VERTEX_SHADER } from '../../engine/liveShaders';
import {
  calibrateAccentRgb,
  deriveSecondaryPalette,
  usePrefersReducedMotion,
} from '../../engine/lyricTiming';
import type { ColorPalette } from '../../types/music';
import type { LiveSceneKind } from '../../types/suite';

export interface LiveSceneCanvasProps {
  scene: LiveSceneKind;
  palette: ColorPalette;
  secondaryPalette?: ColorPalette;
  reaction?: number;
  speed?: number;
  beat?: number;
  bass?: number;
  reducedMotion?: boolean;
  paused?: boolean;
  className?: string;
}

interface UniformLocations {
  u_time: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_beat: WebGLUniformLocation | null;
  u_bass: WebGLUniformLocation | null;
  u_reaction: WebGLUniformLocation | null;
  u_speed: WebGLUniformLocation | null;
  u_color1: WebGLUniformLocation | null;
  u_color2: WebGLUniformLocation | null;
}

interface GlRuntime {
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  program: WebGLProgram | null;
  uniforms: UniformLocations | null;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    console.warn('[LiveSceneCanvas] Shader compile failed:', info);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgramForScene(
  gl: WebGL2RenderingContext,
  scene: LiveSceneKind,
): { program: WebGLProgram; uniforms: UniformLocations } | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, LIVE_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, getLiveFragmentShader(scene));
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Shaders are no longer needed once linked
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    console.warn('[LiveSceneCanvas] Program link failed:', info);
    gl.deleteProgram(program);
    return null;
  }

  const uniforms: UniformLocations = {
    u_time: gl.getUniformLocation(program, 'u_time'),
    u_resolution: gl.getUniformLocation(program, 'u_resolution'),
    u_beat: gl.getUniformLocation(program, 'u_beat'),
    u_bass: gl.getUniformLocation(program, 'u_bass'),
    u_reaction: gl.getUniformLocation(program, 'u_reaction'),
    u_speed: gl.getUniformLocation(program, 'u_speed'),
    u_color1: gl.getUniformLocation(program, 'u_color1'),
    u_color2: gl.getUniformLocation(program, 'u_color2'),
  };

  return { program, uniforms };
}

export function LiveSceneCanvas({
  scene,
  palette,
  secondaryPalette,
  reaction = 0.75,
  speed = 1.0,
  beat = 0,
  bass = 0,
  reducedMotion = false,
  paused = false,
  className = '',
}: LiveSceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<GlRuntime | null>(null);
  const kickFrameRef = useRef<(() => void) | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  const osReducedMotion = usePrefersReducedMotion();
  const isReduced = reducedMotion || osReducedMotion;

  const calibratedPrimary = useMemo(() => calibrateAccentRgb(palette, false), [palette]);
  const calibratedSecondary = useMemo(
    () =>
      secondaryPalette
        ? calibrateAccentRgb(secondaryPalette, false)
        : deriveSecondaryPalette(calibratedPrimary),
    [secondaryPalette, calibratedPrimary],
  );

  // Store dynamic props in refs so WebGL context & RAF loop never tear down on updates
  const targetRef = useRef({
    c1: [calibratedPrimary.r / 255, calibratedPrimary.g / 255, calibratedPrimary.b / 255],
    c2: [calibratedSecondary.r / 255, calibratedSecondary.g / 255, calibratedSecondary.b / 255],
    beat: 0,
    bass: 0,
    reaction: 0.75,
    speed: 1.0,
    reduced: false,
    paused: false,
  });

  useEffect(() => {
    targetRef.current.c1 = [
      calibratedPrimary.r / 255,
      calibratedPrimary.g / 255,
      calibratedPrimary.b / 255,
    ];
    targetRef.current.c2 = [
      calibratedSecondary.r / 255,
      calibratedSecondary.g / 255,
      calibratedSecondary.b / 255,
    ];
  }, [calibratedPrimary, calibratedSecondary]);

  useEffect(() => {
    targetRef.current.beat = Math.max(0, Math.min(1, beat));
    targetRef.current.bass = Math.max(0, Math.min(1, bass));
    targetRef.current.reaction = Math.max(0, Math.min(1.5, reaction));
    targetRef.current.speed = Math.max(0.1, Math.min(3.0, speed));
    targetRef.current.reduced = isReduced;
    targetRef.current.paused = paused;
    kickFrameRef.current?.();
  }, [beat, bass, reaction, speed, isReduced, paused, calibratedPrimary, calibratedSecondary]);

  // Initialize WebGL2 context, quad VAO/VBO, and RAF loop once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      setFallbackMode(true);
      return;
    }

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      setFallbackMode(true);
      return;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const runtime: GlRuntime = {
      gl,
      vao,
      vbo,
      program: null,
      uniforms: null,
    };
    runtimeRef.current = runtime;

    const initialCompiled = createProgramForScene(gl, scene);
    if (!initialCompiled) {
      setFallbackMode(true);
    } else {
      runtime.program = initialCompiled.program;
      runtime.uniforms = initialCompiled.uniforms;
      setFallbackMode(false);
    }

    const syncSize = () => {
      const parent = canvas.parentElement;
      const cssW = parent?.clientWidth || window.innerWidth;
      const cssH = parent?.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextW = Math.max(1, Math.round(cssW * dpr));
      const nextH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    if (ro && canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }
    window.addEventListener('resize', syncSize);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setFallbackMode(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const smooth = {
      c1: [...targetRef.current.c1],
      c2: [...targetRef.current.c2],
      beat: 0,
      bass: 0,
      simTime: 4.5,
    };

    let rafId = 0;
    let lastNow = performance.now();

    const drawFrame = (now: number) => {
      rafId = 0;
      const dt = Math.min(0.08, Math.max(0.001, (now - lastNow) * 0.001));
      lastNow = now;

      const tgt = targetRef.current;
      if (!document.hidden && runtime.program && runtime.uniforms) {
        const colorRate = tgt.reduced ? 1 : Math.min(1, dt * 3.5);
        for (let i = 0; i < 3; i++) {
          smooth.c1[i] += (tgt.c1[i] - smooth.c1[i]) * colorRate;
          smooth.c2[i] += (tgt.c2[i] - smooth.c2[i]) * colorRate;
        }

        const beatRate = tgt.beat > smooth.beat ? 0.48 : 0.16;
        const bassRate = tgt.bass > smooth.bass ? 0.4 : 0.14;
        smooth.beat += (tgt.beat - smooth.beat) * beatRate;
        smooth.bass += (tgt.bass - smooth.bass) * bassRate;

        const effectiveSpeed = tgt.reduced ? 0.03 : tgt.speed;
        if (!tgt.paused && !tgt.reduced) {
          smooth.simTime += dt * effectiveSpeed;
        }

        const u = runtime.uniforms;
        gl.useProgram(runtime.program);
        gl.bindVertexArray(runtime.vao);

        gl.uniform1f(u.u_time, smooth.simTime);
        gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
        gl.uniform1f(u.u_beat, tgt.reduced ? 0 : smooth.beat);
        gl.uniform1f(u.u_bass, tgt.reduced ? 0 : smooth.bass);
        gl.uniform1f(u.u_reaction, tgt.reduced ? 0.1 : tgt.reaction);
        gl.uniform1f(u.u_speed, effectiveSpeed);
        gl.uniform3f(u.u_color1, smooth.c1[0], smooth.c1[1], smooth.c1[2]);
        gl.uniform3f(u.u_color2, smooth.c2[0], smooth.c2[1], smooth.c2[2]);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
      }

      if (!tgt.paused && !tgt.reduced && !document.hidden) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    const kickFrame = () => {
      if (rafId !== 0 || document.hidden) return;
      lastNow = performance.now();
      rafId = requestAnimationFrame(drawFrame);
    };
    kickFrameRef.current = kickFrame;

    const onVisibility = () => {
      if (!document.hidden && !targetRef.current.paused) {
        kickFrame();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    kickFrame();

    return () => {
      kickFrameRef.current = null;
      if (rafId !== 0) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      window.removeEventListener('resize', syncSize);
      canvas.removeEventListener('webglcontextlost', onContextLost);

      if (runtime.program) gl.deleteProgram(runtime.program);
      gl.deleteBuffer(runtime.vbo);
      gl.deleteVertexArray(runtime.vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      runtimeRef.current = null;
    };
    // Initial scene compilation handled above; subsequent scene switches compile below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompile fragment shader cleanly when scene changes
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const compiled = createProgramForScene(runtime.gl, scene);
    if (!compiled) {
      setFallbackMode(true);
      return;
    }

    if (runtime.program) {
      runtime.gl.deleteProgram(runtime.program);
    }
    runtime.program = compiled.program;
    runtime.uniforms = compiled.uniforms;
    setFallbackMode(false);
    kickFrameRef.current?.();
  }, [scene]);

  if (fallbackMode) {
    return (
      <div
        className={`pointer-events-none absolute inset-0 overflow-hidden bg-[#070709] ${className}`}
        style={{
          backgroundImage: `
            radial-gradient(circle at 30% 35%, rgba(${calibratedPrimary.r}, ${calibratedPrimary.g}, ${calibratedPrimary.b}, 0.28) 0%, transparent 56%),
            radial-gradient(circle at 72% 68%, rgba(${calibratedSecondary.r}, ${calibratedSecondary.g}, ${calibratedSecondary.b}, 0.22) 0%, transparent 58%)
          `,
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden="true"
    />
  );
}
