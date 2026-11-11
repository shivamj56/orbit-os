// The opening intro (phone/SPEC.md, "The opening intro"), drawn by one fragment shader on one triangle: the Orbit mark
// as the system splash shows it, which becomes a lit glass planet; its iridescent ring, a thin filament in a tilted
// plane that passes behind the planet on the far side and in front on the near one, with a satellite running round
// it; a light that catches the planet's edge; and the night behind, which thins away at the hand-over.
//
// Lengths are in canvas pixels; y is up (gl_FragCoord). The ring is drawn in screen space as a rotated ellipse of
// constant stroke width, so frame 0 is exactly the flat mark of the splash, and depth comes from the near half being
// brighter and thicker and the far half going behind the planet.
export const INTRO_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const INTRO_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uPx;       // canvas pixels per CSS pixel
uniform vec2 uCenter;    // the planet's middle, canvas pixels
uniform float uR;        // the planet's radius, canvas pixels
uniform vec4 uRing;      // x: semi-major axis in planet radii, y: minor / major, z: roll (rad), w: stroke (CSS px)
uniform float uRingAlpha;
uniform float uSat;      // the satellite's place on the ring (rad, ellipse parameter; negative sin = near side)
uniform float uTrail;    // 0..1: the bright arc behind the satellite
uniform float uForm;     // 0 the flat mark .. 1 a lit planet
uniform float uGlint;    // -1 none, else 0..1: the light running along the edge
uniform float uBg;       // 0..1: the night behind
uniform float uFade;     // 0..1: the whole scene (the planet goes last, into the app's globe)
uniform float uTime;
out vec4 outColor;

const float PI = 3.141592653589793;

// Sky, ice, lilac: the ring's own colours, round and round.
vec3 iris(float t) {
  t = fract(t);
  vec3 a = vec3(0.455, 0.820, 1.000);
  vec3 b = vec3(0.678, 0.776, 1.000);
  vec3 c = vec3(0.914, 0.702, 1.000);
  float k = t * 3.0;
  if (k < 1.0) return mix(a, b, smoothstep(0.0, 1.0, k));
  if (k < 2.0) return mix(b, c, smoothstep(0.0, 1.0, k - 1.0));
  return mix(c, a, smoothstep(0.0, 1.0, k - 2.0));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = frag - uCenter;
  float aa = 0.9;

  // ---- the night: #05070D, a low glow behind the planet, a few far stars ----
  vec3 night = vec3(0.0196, 0.0275, 0.0510);
  float glowR = length(p / (uR * 4.2));
  night += vec3(0.20, 0.32, 0.55) * 0.10 * exp(-glowR * glowR * 2.2) * uForm;
  night += vec3(0.55, 0.40, 0.75) * 0.05 * exp(-pow(length((p - vec2(uR * 1.6, -uR * 1.2)) / (uR * 3.0)), 2.0)) * uForm;
  vec2 cell = floor(frag / (14.0 * uPx));
  float star = hash(cell);
  if (star > 0.985) {
    vec2 at = (cell + 0.5 + (vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5) * 0.7) * 14.0 * uPx;
    float d = length(frag - at) / uPx;
    float tw = 0.55 + 0.45 * sin(uTime * (2.0 + star * 9.0) + star * 40.0);
    night += vec3(0.75, 0.85, 1.0) * (1.0 - smoothstep(0.2, 1.1, d)) * tw * 0.55 * uForm;
  }
  vec3 col = night * uBg;
  float alpha = uBg;

  // ---- the ring, in its own frame (rolled), as an ellipse ----
  float roll = uRing.z;
  vec2 rp = vec2(p.x * cos(roll) + p.y * sin(roll), -p.x * sin(roll) + p.y * cos(roll));
  float a = uRing.x * uR;
  float b = a * uRing.y;
  vec2 e = rp / vec2(a, b);
  float f = dot(e, e) - 1.0;
  vec2 grad = 2.0 * rp / vec2(a * a, b * b);
  float dist = abs(f) / max(length(grad), 1e-4);
  float theta = atan(e.y, e.x);
  float near = smoothstep(0.12, -0.12, sin(theta));        // 1 on the near half (below, in the ring's frame)
  float width = uRing.w * uPx * mix(0.8, 1.22, near);
  float line = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, dist);
  // The glow round the filament comes with the planet (the splash's mark has none). Away from the curve the first-order
  // distance above runs short (most beyond the ring's ends), so the glow takes the larger of it and the distance to the
  // ring's point at the same angle, and stays a glow instead of a beam.
  vec2 onRing = vec2(a * cos(theta), b * sin(theta));
  float far = max(dist, length(rp - onRing) * 0.9);
  float halo = exp(-far / (width * 1.5 + 1.5 * uPx)) * 0.5 * uForm;
  // The bright arc: brightest at the satellite, fading back along the ring the way it came.
  float behind = mod(uSat - theta, 2.0 * PI);
  float trail = exp(-behind * 2.4) * uTrail;
  // The far half at 45%, as the mark draws it; the arc lifts both.
  float vis = mix(0.45, 1.0, near);
  // Across the ring at first (the splash's straight gradient), then round it, moving.
  float across = clamp(rp.x / (2.0 * a) + 0.5, 0.0, 1.0);
  vec3 straight = across < 0.5 ? mix(vec3(0.455, 0.820, 1.0), vec3(0.678, 0.776, 1.0), across * 2.0)
                               : mix(vec3(0.678, 0.776, 1.0), vec3(0.914, 0.702, 1.0), across * 2.0 - 1.0);
  vec3 ringCol = mix(straight, iris(theta / (2.0 * PI) + 0.08 * uTime + 0.15), uForm);
  ringCol = min(mix(ringCol, vec3(1.0), trail * 0.45) * (1.0 + trail * 0.5), 1.0);
  float ringA = clamp((line * (1.0 + trail * 0.8) + halo * (0.3 + trail * 0.7)) * vis * uRingAlpha, 0.0, 1.0);

  // The satellite: a white core in a cold glow.
  vec2 satLocal = vec2(a * cos(uSat), b * sin(uSat));
  vec2 satP = vec2(satLocal.x * cos(roll) - satLocal.y * sin(roll), satLocal.x * sin(roll) + satLocal.y * cos(roll));
  float sd = length(p - satP) / uPx;
  float satNear = smoothstep(0.12, -0.12, sin(uSat));
  float sat = ((1.0 - smoothstep(2.4, 3.6, sd)) + exp(-sd * sd / 30.0) * 0.8) * uRingAlpha;
  vec3 satCol = mix(vec3(0.455, 0.820, 1.0), vec3(1.0), 1.0 - smoothstep(0.0, 3.6, sd));

  // ---- the planet ----
  vec2 q = p / uR;
  float r = length(q);
  float px = 1.0 / uR;
  float inside = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
  // The far half of the ring and a satellite on it go behind the planet.
  float hidden = inside * (1.0 - near);
  float satHidden = inside * (1.0 - satNear) * step(length(satP / uR), 1.0);

  // Far ring first, then the planet over it, then the near ring over the planet ("over", premultiplied).
  float backA = ringA * (1.0 - near) * (1.0 - hidden);
  col = ringCol * backA + col * (1.0 - backA);
  alpha = backA + alpha * (1.0 - backA);

  if (r < 1.0 + px) {
    float z = sqrt(max(1.0 - r * r, 0.0));
    vec3 n = vec3(q, z);

    // The mark: a flat disc, lit from the upper left (the splash's radial gradient), and a thin ice rim.
    vec3 markCol = mix(vec3(0.114, 0.165, 0.337), vec3(0.039, 0.059, 0.133), clamp(length(q - vec2(-0.24, 0.36)) / 1.6, 0.0, 1.0));
    float rimW = 1.5 * uPx * px;
    float rim = 1.0 - smoothstep(rimW * 0.5, rimW * 0.5 + px, abs(r - 1.0 + rimW * 0.5));
    markCol = mix(markCol, vec3(0.678, 0.776, 1.0), rim * 0.55);

    // The planet: the app's own globe, smoked glass, before its grid is drawn.
    vec3 g = mix(vec3(0.010, 0.013, 0.028), vec3(0.046, 0.064, 0.128), smoothstep(-1.0, 1.0, q.y * 0.8 + 0.25));
    g += vec3(0.10, 0.16, 0.32) * pow(z, 3.0) * 0.16;
    vec3 L = normalize(vec3(-0.50, 0.66, 0.56));
    g *= 0.70 + 0.48 * max(dot(n, L), 0.0);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float nh = max(dot(n, H), 0.0);
    g += vec3(1.0) * pow(nh, 110.0) * 0.60 + vec3(0.85, 0.92, 1.0) * pow(nh, 10.0) * 0.05;
    // Its edge lit in the ring's colours, and the equator: a faint line of the same light.
    float ang = atan(q.y, q.x);
    g += iris(ang / (2.0 * PI) + 0.1 * uTime) * pow(1.0 - z, 2.7) * 0.42;
    float lat = asin(clamp(q.y * cos(0.42) - z * sin(0.42), -1.0, 1.0));
    g += iris(q.x * 0.3 + 0.05 * uTime) * exp(-pow(lat / 0.035, 2.0)) * 0.22 * smoothstep(0.0, 0.6, z);

    // The light catching the edge: a crescent that runs along the limb, and a glint where it is brightest.
    if (uGlint >= 0.0) {
      float run = mix(2.55, -0.35, uGlint);
      vec2 dir = vec2(cos(run), sin(run));
      float along = max(dot(normalize(q + 1e-5), dir), 0.0);
      float crescent = pow(along, 18.0) * smoothstep(0.80, 1.0, r) * sin(uGlint * PI);
      g += vec3(0.92, 0.96, 1.0) * crescent * 1.25;
    }

    vec3 planet = mix(markCol, g, uForm);
    col = mix(col, planet, inside);
    alpha = mix(alpha, 1.0, inside);
  }

  // The glint's star on the limb: a soft flare with two thin rays.
  if (uGlint >= 0.0) {
    float run = mix(2.55, -0.35, uGlint);
    vec2 at = vec2(cos(run), sin(run)) * uR;
    vec2 d = (p - at) / uPx;
    float s = sin(uGlint * PI);
    float flare = exp(-dot(d, d) / 90.0) * 0.9 + exp(-abs(d.y) * 1.4) * exp(-abs(d.x) / 46.0) * 0.55
                + exp(-abs(d.x) * 1.4) * exp(-abs(d.y) / 30.0) * 0.30;
    float fa = clamp(flare * s * uForm, 0.0, 1.0);
    col = vec3(0.85, 0.93, 1.0) * fa + col * (1.0 - fa * 0.35);
    alpha = fa + alpha * (1.0 - fa);
  }

  // The near half of the ring and the satellite, over the planet.
  float frontA = ringA * near;
  col = ringCol * frontA + col * (1.0 - frontA);
  alpha = frontA + alpha * (1.0 - frontA);
  float satA = clamp(sat * (1.0 - satHidden), 0.0, 1.0);
  col = satCol * satA + col * (1.0 - satA);
  alpha = satA + alpha * (1.0 - satA);

  // Premultiplied, as the canvas is.
  col = clamp(col, 0.0, alpha);
  outColor = vec4(col * uFade, alpha * uFade);
}
`;
