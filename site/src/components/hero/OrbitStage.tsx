import { useEffect, useRef, useState, type RefObject } from "react";
import homeUrl from "@/assets/img/home.webp";
import ccUrl from "@/assets/img/control-center.webp";
import { chain, lookAt, mat, perspective, rotX, rotY, rotZ, roundedSlab, translate } from "./orbitMath";

/*
 * The hero's scene, drawn by hand in WebGL2: a TV (Orbit Home, the real picture) floating in the night, and an
 * iridescent orbit ring around it with real depth: the back of the ring passes behind the TV, the front crosses its
 * screen, and a satellite (the phone) runs the ring leaving a trail. Dust glitters along the orbit.
 *
 * The TV sits wherever the page's layout puts `anchor` (an empty 16:9 box), so CSS decides the composition and the
 * scene follows. It draws only while the hero is on screen, caps the pixel ratio at 2, and in "reduce motion" draws
 * one still frame. Clicking the TV pulls the Control Center down over Home, as the remote's Settings key does.
 */

const TV_W = 3.2;
const TV_H = 1.8;
const BEZEL = 0.035;
const DEPTH = 0.075;
const FOV = (28 * Math.PI) / 180;
const RING_R = 2.55;
/** The ring sits a little below the TV's centre and nearly edge-on, so its front arc crosses the lower screen. */
const RING_Y = -0.4;
const RING_TILT = -1.425;
const RING_ROLL = -0.16;
const DUST = 1500;

const TRIO = /* glsl */ `
vec3 trio(float t) {
  vec3 a = vec3(0.455, 0.820, 1.000);
  vec3 b = vec3(0.678, 0.776, 1.000);
  vec3 c = vec3(0.914, 0.702, 1.000);
  t = fract(t) * 3.0;
  if (t < 1.0) return mix(a, b, smoothstep(0.0, 1.0, t));
  if (t < 2.0) return mix(b, c, smoothstep(0.0, 1.0, t - 1.0));
  return mix(c, a, smoothstep(0.0, 1.0, t - 2.0));
}`;

const BODY_V = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNor;
uniform mat4 uProj, uView, uModel;
out vec3 vNor;
out vec3 vWorld;
out vec3 vLocal;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vLocal = aPos;
  vNor = mat3(uModel) * aNor;
  gl_Position = uProj * uView * w;
}`;

const BODY_F = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNor;
in vec3 vWorld;
in vec3 vLocal;
uniform vec3 uEye;
uniform float uTime;
uniform float uAppear;
uniform float uGlow;
out vec4 o;
${TRIO}
void main() {
  vec3 N = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.55));
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 70.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  float ang = atan(vLocal.y, vLocal.x) / 6.2831853;
  vec3 base = vec3(0.022, 0.027, 0.046);
  vec3 rim = trio(ang + uTime * 0.04) * fres * (0.55 + 0.5 * uGlow);
  // The front bezel catches a thin line of the ring's light along its edge.
  float edge = smoothstep(0.012, 0.0, abs(max(abs(vLocal.x) - ${(TV_W / 2).toFixed(3)}, abs(vLocal.y) - ${(TV_H / 2).toFixed(3)})) - 0.004) * step(0.5, N.z);
  vec3 col = base * (0.55 + 0.9 * diff) + vec3(0.75, 0.85, 1.0) * spec * 0.25 + rim + trio(ang * 2.0 + uTime * 0.05) * edge * 0.18;
  o = vec4(col * uAppear, uAppear);
}`;

const SCREEN_V = /* glsl */ `#version 300 es
in vec2 aUv;
uniform mat4 uProj, uView, uModel;
out vec2 vUv;
void main() {
  vUv = aUv;
  vec3 p = vec3((aUv.x - 0.5) * ${TV_W.toFixed(3)}, (aUv.y - 0.5) * ${TV_H.toFixed(3)}, 0.0016);
  gl_Position = uProj * uView * uModel * vec4(p, 1.0);
}`;

const SCREEN_F = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHome;
uniform sampler2D uCc;
uniform float uPower;
uniform float uAppear;
uniform float uPanel;
uniform float uGlare;
uniform float uTime;
out vec4 o;
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = (vUv - 0.5) * vec2(${(TV_W / TV_H).toFixed(4)}, 1.0);
  float d = roundBox(p, vec2(${(TV_W / TV_H / 2).toFixed(4)}, 0.5), 0.018);
  float mask = 1.0 - smoothstep(-fwidth(d), 0.0, d);
  if (mask < 0.01) discard;
  vec3 home = texture(uHome, uv).rgb;
  // The Control Center slides down from the top edge over a dimmed Home.
  float edge = 1.0 - uPanel * 1.02;
  float panel = smoothstep(edge - 0.004, edge + 0.004, 1.0 - uv.y);
  vec2 ccUv = vec2(uv.x, uv.y + (1.0 - uPanel));
  vec3 cc = texture(uCc, vec2(ccUv.x, clamp(ccUv.y, 0.0, 1.0))).rgb;
  vec3 col = mix(home * (1.0 - 0.55 * uPanel), cc, panel * step(ccUv.y, 1.0));
  // Power on: a line of light opens into the picture.
  float r = length(p * vec2(0.62, 1.0));
  float reveal = smoothstep(uPower * 1.3 - 0.12, uPower * 1.3, r);
  col *= 1.0 - reveal;
  float line = exp(-pow((vUv.y - 0.5) * 70.0, 2.0)) * exp(-pow(p.x * 1.4, 2.0)) * smoothstep(0.0, 0.06, uPower) * (1.0 - smoothstep(0.12, 0.42, uPower));
  col += vec3(0.75, 0.9, 1.0) * line * 1.4;
  // Glass: a soft diagonal sheen that moves as the TV turns, and a little falloff at the edges.
  float g = exp(-pow((vUv.x * 0.8 + vUv.y * 0.55 - uGlare) * 3.2, 2.0));
  col += vec3(0.9, 0.95, 1.0) * g * 0.045;
  col *= 0.9 + 0.1 * smoothstep(0.95, 0.25, length(p * vec2(0.55, 1.0)));
  o = vec4(col * uAppear * mask, uAppear * mask);
}`;

const RING_V = /* glsl */ `#version 300 es
in float aT;
in float aSide;
uniform mat4 uProj, uMV;
uniform vec2 uRes;
uniform float uRadius;
uniform float uHalf;
uniform float uRef;
uniform float uCenterZ;
out float vSide;
out float vT;
out float vNear;
out float vHalf;
vec3 ringAt(float t) { return vec3(cos(t) * uRadius, sin(t) * uRadius, 0.0); }
void main() {
  vec4 v = uMV * vec4(ringAt(aT), 1.0);
  vec4 c = uProj * v;
  vec4 c2 = uProj * (uMV * vec4(ringAt(aT + 0.003), 1.0));
  vec2 dir = normalize((c2.xy / c2.w - c.xy / c.w) * uRes + 1e-6);
  vec2 nor = vec2(-dir.y, dir.x);
  float persp = uRef / max(-v.z, 0.05);
  float halfPx = uHalf * persp;
  vec2 off = nor * aSide * halfPx * 2.0 / uRes;
  gl_Position = vec4(c.xy + off * c.w, c.z, c.w);
  vSide = aSide;
  vT = aT;
  vNear = clamp((v.z - uCenterZ) / uRadius, -1.0, 1.0);
  vHalf = halfPx;
}`;

const RING_F = /* glsl */ `#version 300 es
precision highp float;
in float vSide;
in float vT;
in float vNear;
in float vHalf;
uniform float uTime;
uniform float uDraw;
uniform float uSat;
uniform float uGain;
uniform float uDpr;
out vec4 o;
${TRIO}
void main() {
  float dpx = abs(vSide) * vHalf;
  float core = exp(-pow(dpx / (1.15 * uDpr), 2.0));
  float halo = exp(-pow(dpx / (6.5 * uDpr), 2.0));
  float far = exp(-pow(dpx / (17.0 * uDpr), 2.0));
  float t = vT / 6.2831853;
  float drawn = 1.0 - smoothstep(uDraw - 0.004, uDraw + 0.004, t);
  float d = mod(vT - uSat + 3.14159265, 6.2831853) - 3.14159265;
  float trail = d < 0.0 ? exp(d * 1.35) : exp(-d * 26.0);
  float depthGain = mix(0.42, 1.0, smoothstep(-0.9, 0.5, vNear));
  vec3 hue = trio(t * 2.0 - uTime * 0.035 + vNear * 0.06);
  float i = (core * 1.1 + halo * 0.34 + far * 0.11) * depthGain * (1.0 + trail * 1.9 * step(0.999, uDraw)) * uGain;
  vec3 c = mix(hue, vec3(1.0), clamp(core * 0.5 + trail * 0.3, 0.0, 0.85)) * i * drawn;
  float head = exp(-pow((t - uDraw) * 90.0, 2.0)) * (1.0 - step(0.999, uDraw));
  c += vec3(0.85, 0.95, 1.0) * head * (core * 2.0 + halo * 0.9);
  o = vec4(c, clamp(max(c.r, max(c.g, c.b)) * 0.55, 0.0, 1.0));
}`;

const DUST_V = /* glsl */ `#version 300 es
in vec4 aP;
uniform mat4 uProj, uMV;
uniform float uRadius;
uniform float uSpin;
uniform float uTime;
uniform float uDpr;
uniform float uRef;
uniform float uShow;
uniform float uCenterZ;
out float vA;
out vec3 vC;
${TRIO}
void main() {
  float speed = 0.55 + 0.45 * fract(aP.w * 7.31);
  float th = aP.x + uSpin * speed;
  float r = uRadius + aP.y;
  vec4 v = uMV * vec4(cos(th) * r, sin(th) * r, aP.z, 1.0);
  gl_Position = uProj * v;
  float persp = uRef / max(-v.z, 0.05);
  gl_PointSize = (0.9 + 2.3 * pow(fract(aP.w * 13.7), 3.0)) * uDpr * persp;
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + 2.8 * fract(aP.w * 3.1)) + aP.w * 40.0);
  float nearSide = smoothstep(-1.0, 0.6, clamp((v.z - uCenterZ) / uRadius, -1.0, 1.0));
  vA = tw * (0.3 + 0.7 * fract(aP.w * 5.3)) * uShow * mix(0.45, 1.0, nearSide);
  vC = mix(trio(th / 6.2831853 * 2.0 + aP.w * 0.25), vec3(1.0), 0.25);
}`;

const DUST_F = /* glsl */ `#version 300 es
precision highp float;
in float vA;
in vec3 vC;
out vec4 o;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  o = vec4(vC * a * vA, a * vA * 0.5);
}`;

const SAT_V = /* glsl */ `#version 300 es
uniform mat4 uProj, uMV;
uniform float uRadius;
uniform float uSat;
uniform float uDpr;
uniform float uRef;
uniform float uSize;
void main() {
  vec4 v = uMV * vec4(cos(uSat) * uRadius, sin(uSat) * uRadius, 0.0, 1.0);
  gl_Position = uProj * v;
  gl_PointSize = uSize * uDpr * (uRef / max(-v.z, 0.05));
}`;

const SAT_F = /* glsl */ `#version 300 es
precision highp float;
uniform float uShow;
uniform float uPulse;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r2 = dot(p, p);
  float core = exp(-r2 * 1400.0);
  float glow = exp(-r2 * 70.0) * 0.38;
  float rays = exp(-abs(p.y) * 170.0) * exp(-abs(p.x) * 8.0) + exp(-abs(p.x) * 170.0) * exp(-abs(p.y) * 8.0);
  vec3 c = vec3(1.0) * core * 1.4 + vec3(0.55, 0.84, 1.0) * (glow + rays * 0.42) * (1.0 + uPulse);
  o = vec4(c * uShow, clamp(max(c.r, c.b) * 0.6, 0.0, 1.0) * uShow);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const u: Uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function loadTexture(gl: WebGL2RenderingContext, url: string, onReady: () => void) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    onReady();
  };
  img.src = url;
  return tex;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export interface StageControl {
  toggle: () => void;
}

interface Props {
  container: RefObject<HTMLElement | null>;
  anchor: RefObject<HTMLElement | null>;
  control?: RefObject<StageControl | null>;
  reduce: boolean;
  onFallback: () => void;
  onPanel?: (open: boolean) => void;
}

export function OrbitStage({ container, anchor, control, reduce, onFallback, onPanel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const panelRef = useRef(onPanel);
  panelRef.current = onPanel;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = container.current;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true, powerPreference: "high-performance" });
    if (!gl) {
      onFallback();
      return;
    }

    let progs: ReturnType<typeof setup>;
    function setup(g: WebGL2RenderingContext) {
      const body = program(g, BODY_V, BODY_F);
      const screen = program(g, SCREEN_V, SCREEN_F);
      const ring = program(g, RING_V, RING_F);
      const dust = program(g, DUST_V, DUST_F);
      const sat = program(g, SAT_V, SAT_F);

      const bodyVao = g.createVertexArray()!;
      g.bindVertexArray(bodyVao);
      const slab = roundedSlab(TV_W + BEZEL * 2, TV_H + BEZEL * 2, 0.06, DEPTH, 10);
      const b1 = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, b1);
      g.bufferData(g.ARRAY_BUFFER, slab, g.STATIC_DRAW);
      const aPos = g.getAttribLocation(body.p, "aPos");
      const aNor = g.getAttribLocation(body.p, "aNor");
      g.enableVertexAttribArray(aPos);
      g.vertexAttribPointer(aPos, 3, g.FLOAT, false, 24, 0);
      g.enableVertexAttribArray(aNor);
      g.vertexAttribPointer(aNor, 3, g.FLOAT, false, 24, 12);

      const screenVao = g.createVertexArray()!;
      g.bindVertexArray(screenVao);
      const b2 = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, b2);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), g.STATIC_DRAW);
      const aUv = g.getAttribLocation(screen.p, "aUv");
      g.enableVertexAttribArray(aUv);
      g.vertexAttribPointer(aUv, 2, g.FLOAT, false, 0, 0);

      const SEG = 720;
      const ringData = new Float32Array((SEG + 1) * 4);
      for (let i = 0; i <= SEG; i++) {
        const t = (i / SEG) * Math.PI * 2;
        ringData.set([t, -1, t, 1], i * 4);
      }
      const ringVao = g.createVertexArray()!;
      g.bindVertexArray(ringVao);
      const b3 = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, b3);
      g.bufferData(g.ARRAY_BUFFER, ringData, g.STATIC_DRAW);
      const aT = g.getAttribLocation(ring.p, "aT");
      const aSide = g.getAttribLocation(ring.p, "aSide");
      g.enableVertexAttribArray(aT);
      g.vertexAttribPointer(aT, 1, g.FLOAT, false, 8, 0);
      g.enableVertexAttribArray(aSide);
      g.vertexAttribPointer(aSide, 1, g.FLOAT, false, 8, 4);

      // Dust: a seeded scatter, thicker near the ring, a few strays further out.
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const gauss = () => {
        const u = Math.max(1e-6, rand());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
      };
      const dustData = new Float32Array(DUST * 4);
      for (let i = 0; i < DUST; i++) {
        const stray = rand() < 0.12;
        dustData.set([rand() * Math.PI * 2, gauss() * (stray ? 0.38 : 0.085), gauss() * (stray ? 0.12 : 0.018), rand()], i * 4);
      }
      const dustVao = g.createVertexArray()!;
      g.bindVertexArray(dustVao);
      const b4 = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, b4);
      g.bufferData(g.ARRAY_BUFFER, dustData, g.STATIC_DRAW);
      const aP = g.getAttribLocation(dust.p, "aP");
      g.enableVertexAttribArray(aP);
      g.vertexAttribPointer(aP, 4, g.FLOAT, false, 0, 0);

      const satVao = g.createVertexArray()!;
      g.bindVertexArray(null);
      return { body, screen, ring, dust, sat, bodyVao, screenVao, ringVao, dustVao, satVao, slabCount: slab.length / 6, ringCount: (SEG + 1) * 2, buffers: [b1, b2, b3, b4] };
    }

    try {
      progs = setup(gl);
    } catch (e) {
      console.error(e);
      onFallback();
      return;
    }

    let loaded = 0;
    const onTex = () => {
      loaded++;
      if (loaded >= 2) {
        setReady(true);
        wake();
      }
    };
    const homeTex = loadTexture(gl, homeUrl, onTex);
    const ccTex = loadTexture(gl, ccUrl, onTex);

    // ---- state ----
    const P = mat(), V = mat(), M = mat(), RM = mat(), MV = mat();
    const tA = mat(), tB = mat(), tC = mat(), tD = mat(), tE = mat();
    let W = 1, H = 1, dpr = 1;
    let box = { cx: 0.5, cy: 0.7, w: 600 };
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, over: 0, overT: 0 };
    let start = -1;
    let last = 0;
    let raf = 0;
    let visible = true;
    let sat = 0.6;
    let spin = 0;
    let pulse = 0;
    let panel = 0;
    let panelTarget = 0;
    let scrollP = 0;

    const measure = () => {
      const hr = host.getBoundingClientRect();
      const ar = anchor.current?.getBoundingClientRect();
      W = Math.max(1, hr.width);
      H = Math.max(1, hr.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (ar) box = { cx: (ar.left - hr.left + ar.width / 2) / W, cy: (ar.top - hr.top + ar.height / 2) / H, w: ar.width };
      draw(performance.now());
    };

    const draw = (now: number) => {
      if (loaded < 2) return;
      if (start < 0) start = now;
      const t = reduce ? 8 : (now - start) / 1000;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;

      // springs toward the pointer
      const k = 1 - Math.exp(-dt * 3.2);
      pointer.x += (pointer.tx - pointer.x) * k;
      pointer.y += (pointer.ty - pointer.y) * k;
      pointer.over += (pointer.overT - pointer.over) * (1 - Math.exp(-dt * 5));
      pulse *= Math.exp(-dt * 2.2);
      panel += (panelTarget - panel) * (1 - Math.exp(-dt * 6.5));

      const draw01 = reduce ? 1 : easeInOut((t - 0.15) / 1.7);
      const appear = reduce ? 1 : ease((t - 0.3) / 1.0);
      const power = reduce ? 1 : ease((t - 1.0) / 1.3);
      const dustShow = reduce ? 1 : ease((t - 1.1) / 1.4);
      const satShow = reduce ? 1 : ease((t - 1.8) / 0.6);
      if (!reduce) {
        sat += dt * (0.42 + 0.5 * pointer.over + 2.6 * pulse);
        spin += dt * (0.06 + 0.05 * pointer.over + 0.5 * pulse);
      }

      const aspect = W / H;
      const tvPx = box.w * (1 + scrollP * 0.12);
      const dist = (TV_W * H) / (2 * Math.tan(FOV / 2) * tvPx);
      const camY = dist * 0.035;
      perspective(P, FOV, aspect, 0.1, 100, box.cx * 2 - 1, 1 - box.cy * 2);
      lookAt(V, 0, camY, dist, 0, 0, 0);
      const eye = [0, camY, dist];

      const bob = reduce ? 0 : Math.sin(t * 0.7) * 0.03;
      const yaw = -0.16 + pointer.x * 0.2 - scrollP * 0.1;
      const pitch = 0.035 - pointer.y * 0.07 + scrollP * 0.05;
      const rise = reduce ? 0 : (1 - appear) * -0.25;
      chain(M, translate(tA, 0, bob + rise, 0), rotY(tB, yaw), rotX(tC, pitch), rotZ(tD, reduce ? 0 : Math.sin(t * 0.5) * 0.008));
      chain(RM, translate(tA, 0, RING_Y + bob * 0.6, 0), rotY(tB, yaw * 0.45), rotZ(tC, RING_ROLL + pointer.x * 0.035), rotX(tD, RING_TILT - pointer.y * 0.04 + scrollP * 0.12), rotZ(tE, 0));
      chain(MV, V, RM);
      // The TV's centre in view space, for "is this part of the ring in front of it or behind".
      const centerZ = -Math.hypot(0, camY, dist);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);

      // TV body and screen: opaque once in, blended while appearing.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      const { body, screen, ring, dust, sat: satP } = progs;
      gl.useProgram(body.p);
      gl.bindVertexArray(progs.bodyVao);
      gl.uniformMatrix4fv(body.u.uProj, false, P);
      gl.uniformMatrix4fv(body.u.uView, false, V);
      gl.uniformMatrix4fv(body.u.uModel, false, M);
      gl.uniform3f(body.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform1f(body.u.uTime, t);
      gl.uniform1f(body.u.uAppear, appear);
      gl.uniform1f(body.u.uGlow, pointer.over + pulse);
      gl.drawArrays(gl.TRIANGLES, 0, progs.slabCount);

      gl.useProgram(screen.p);
      gl.bindVertexArray(progs.screenVao);
      gl.uniformMatrix4fv(screen.u.uProj, false, P);
      gl.uniformMatrix4fv(screen.u.uView, false, V);
      gl.uniformMatrix4fv(screen.u.uModel, false, M);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, homeTex);
      gl.uniform1i(screen.u.uHome, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ccTex);
      gl.uniform1i(screen.u.uCc, 1);
      gl.uniform1f(screen.u.uPower, power);
      gl.uniform1f(screen.u.uAppear, appear);
      gl.uniform1f(screen.u.uPanel, panel);
      gl.uniform1f(screen.u.uGlare, 0.62 + pointer.x * 0.25 + yaw * 0.6);
      gl.uniform1f(screen.u.uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Light: added, depth-tested against the TV, never writing depth.
      gl.depthMask(false);
      gl.blendFunc(gl.ONE, gl.ONE);
      const ref = dist;
      gl.useProgram(ring.p);
      gl.bindVertexArray(progs.ringVao);
      gl.uniformMatrix4fv(ring.u.uProj, false, P);
      gl.uniformMatrix4fv(ring.u.uMV, false, MV);
      gl.uniform2f(ring.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(ring.u.uRadius, RING_R);
      gl.uniform1f(ring.u.uHalf, 30 * dpr);
      gl.uniform1f(ring.u.uRef, ref);
      gl.uniform1f(ring.u.uCenterZ, centerZ);
      gl.uniform1f(ring.u.uTime, t);
      gl.uniform1f(ring.u.uDraw, draw01);
      gl.uniform1f(ring.u.uSat, ((sat % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      gl.uniform1f(ring.u.uGain, 1.0 + 0.35 * pointer.over + 0.9 * pulse);
      gl.uniform1f(ring.u.uDpr, dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, progs.ringCount);

      gl.useProgram(dust.p);
      gl.bindVertexArray(progs.dustVao);
      gl.uniformMatrix4fv(dust.u.uProj, false, P);
      gl.uniformMatrix4fv(dust.u.uMV, false, MV);
      gl.uniform1f(dust.u.uRadius, RING_R);
      gl.uniform1f(dust.u.uSpin, spin);
      gl.uniform1f(dust.u.uTime, t);
      gl.uniform1f(dust.u.uDpr, dpr);
      gl.uniform1f(dust.u.uRef, ref);
      gl.uniform1f(dust.u.uShow, dustShow * (1 + 0.6 * pulse));
      gl.uniform1f(dust.u.uCenterZ, centerZ);
      gl.drawArrays(gl.POINTS, 0, DUST);

      gl.useProgram(satP.p);
      gl.bindVertexArray(progs.satVao);
      gl.uniformMatrix4fv(satP.u.uProj, false, P);
      gl.uniformMatrix4fv(satP.u.uMV, false, MV);
      gl.uniform1f(satP.u.uRadius, RING_R);
      gl.uniform1f(satP.u.uSat, sat);
      gl.uniform1f(satP.u.uDpr, dpr);
      gl.uniform1f(satP.u.uRef, ref);
      gl.uniform1f(satP.u.uSize, 92);
      gl.uniform1f(satP.u.uShow, satShow);
      gl.uniform1f(satP.u.uPulse, pulse);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.bindVertexArray(null);
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(now);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    function wake() {
      if (!raf && visible && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }

    const onMove = (e: PointerEvent) => {
      if (reduce) return;
      const r = host.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      const a = anchor.current?.getBoundingClientRect();
      pointer.overT = a && e.clientX > a.left && e.clientX < a.right && e.clientY > a.top - 40 && e.clientY < a.bottom + 40 ? 1 : 0;
    };
    const onLeave = () => {
      pointer.tx = pointer.ty = 0;
      pointer.overT = 0;
    };
    const onClick = (e: MouseEvent) => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a || e.clientX < a.left || e.clientX > a.right || e.clientY < a.top || e.clientY > a.bottom) return;
      pulse = 1;
      panelTarget = panelTarget > 0.5 ? 0 : 1;
      panelRef.current?.(panelTarget > 0.5);
      if (reduce) {
        panel = panelTarget;
        draw(performance.now());
      }
    };
    const onScroll = () => {
      const r = host.getBoundingClientRect();
      scrollP = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
      if (reduce) draw(performance.now());
    };
    const toggle = () => {
      panelTarget = panelTarget > 0.5 ? 0 : 1;
      pulse = 1;
      panelRef.current?.(panelTarget > 0.5);
      if (reduce) {
        panel = panelTarget;
        draw(performance.now());
      }
    };
    if (control) (control as { current: StageControl | null }).current = { toggle };

    const ro = new ResizeObserver(measure);
    ro.observe(host);
    if (anchor.current) ro.observe(anchor.current);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      wake();
    });
    io.observe(host);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("click", onClick);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", wake);
    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
      onFallback();
    };
    canvas.addEventListener("webglcontextlost", lost);
    measure();
    wake();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", wake);
      canvas.removeEventListener("webglcontextlost", lost);
      progs.buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteTexture(homeTex);
      gl.deleteTexture(ccTex);
      if (control) (control as { current: StageControl | null }).current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}
