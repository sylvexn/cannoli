/**
 * ShaderField — a performance-safe animated WebGL mesh-gradient background.
 *
 * Renders the canvas + rAF loop ONLY when the GPU is accelerated AND the user
 * hasn't requested reduced motion. Otherwise it renders a pure-CSS static
 * gradient built from the same colors (zero GPU/CPU cost). The loop pauses when
 * the element is offscreen (IntersectionObserver) or the tab is hidden
 * (visibilitychange), caps DPR at 1.5, and falls back to the static gradient on
 * WebGL context loss. Teardown is idempotent (React 19 StrictMode-safe).
 *
 * The CSS gradient also paints underneath the canvas as a first-frame / context-
 * loss backstop. Callers should pass a `className` that positions + sizes the
 * field (e.g. "absolute inset-0"); the canvas fills the wrapper.
 *
 * Lazy-load this via components/shader-field-lazy.tsx so the GLSL never ships on
 * the initial route bundle.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGpuTier } from '@/lib/use-gpu-capability';
import { useMediaQuery } from '@/lib/use-media-query';
import { buildGradientCss } from '@/lib/shader-gradient';

export interface ShaderFieldProps {
  /** Up to 4 hex stops (deep → light). Fewer are padded from the brand palette. */
  colors: string[];
  /** Animation speed multiplier (1 = default cadence). */
  speed?: number;
  /** Domain-warp amount; higher = more turbulent blobs. */
  distortion?: number;
  className?: string;
  style?: CSSProperties;
}

const VERT = `attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Domain-warped fbm value noise → flowing blend of 4 colors, with grain + vignette.
const FRAG = `precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_speed;
uniform float u_distort;
uniform vec3 u_c0, u_c1, u_c2, u_c3;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.02; a *= 0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.4;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(fbm(p + u_distort * q + vec2(1.7, 9.2) + t * 0.4), fbm(p + u_distort * q + vec2(8.3, 2.8) - t * 0.3));
  float n1 = fbm(p + u_distort * r);
  float n2 = fbm(p * 1.25 + u_distort * q + 3.0);
  vec3 col = mix(u_c0, u_c1, smoothstep(0.12, 0.88, n1));
  col = mix(col, u_c2, smoothstep(0.18, 0.92, n2));
  col = mix(col, u_c3, smoothstep(0.30, 1.0, n1 * n2 * 1.7));
  col += 0.05 * pow(max(0.0, 1.0 - length(uv - 0.5)), 3.0) * vec3(0.8, 0.9, 1.0);
  float vig = smoothstep(1.25, 0.25, length((uv - 0.5) * vec2(1.55, 1.0)));
  col = mix(vec3(0.025, 0.025, 0.045), col, vig);
  col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.05;
  gl_FragColor = vec4(col, 1.0);
}`;

const FALLBACK = ['#0a1830', '#1d4ed8', '#22d3ee', '#e879f9'];

function padTo4(c: string[]): string[] {
  return [0, 1, 2, 3].map(i => c[i] ?? FALLBACK[i]);
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function ShaderField({ colors, speed = 1, distortion = 1.15, className, style }: ShaderFieldProps) {
  const tier = useGpuTier();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const enabled = tier === 'accelerated' && !reduced;
  const [failed, setFailed] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const colorsKey = colors.join('|');
  const gradient = buildGradientCss(colors);
  const showCanvas = enabled && !failed;

  useEffect(() => {
    if (!enabled || failed) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl = canvas.getContext('webgl', {
      failIfMajorPerformanceCaveat: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      alpha: true,
      powerPreference: 'low-power',
    }) as WebGLRenderingContext | null;
    if (!gl) { setFailed(true); return; }

    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { setFailed(true); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    gl.uniform1f(gl.getUniformLocation(prog, 'u_speed'), speed * 0.22);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_distort'), distortion);
    const stops = padTo4(colorsKey.split('|')).map(hexToRgb);
    (['u_c0', 'u_c1', 'u_c2', 'u_c3'] as const).forEach((u, i) => {
      gl.uniform3fv(gl.getUniformLocation(prog, u), stops[i]);
    });

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
      }
    };
    resize();

    let raf = 0;
    let start = 0;
    let running = false;
    let onscreen = true;
    let visible = !document.hidden;

    const frame = (ts: number) => {
      if (!start) start = ts;
      gl.uniform1f(uTime, (ts - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (running || !onscreen || !visible) return;
      running = true;
      start = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      onscreen = entries[0]?.isIntersecting ?? true;
      if (onscreen) run(); else stop();
    }, { threshold: 0 });
    io.observe(wrap);
    const onVis = () => {
      visible = !document.hidden;
      if (visible) run(); else stop();
    };
    document.addEventListener('visibilitychange', onVis);
    const onLost = (e: Event) => { e.preventDefault(); stop(); setFailed(true); };
    canvas.addEventListener('webglcontextlost', onLost);

    run();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    };
  }, [enabled, failed, colorsKey, speed, distortion]);

  return (
    <div ref={wrapRef} className={className} style={{ ...style, background: gradient }} aria-hidden>
      {showCanvas && (
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </div>
  );
}
