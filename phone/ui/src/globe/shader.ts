// The globe is drawn by one fragment shader on one triangle: a ray against a sphere, lat/long from the trackball's
// rotation, then glass, grid, the halo's ribbon on the equator, light, and the ripple of a tap.
export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform mat3 uInv;
uniform vec4 uRipple;   // xyz: where the tap landed (view space, unit); w: its age in seconds, < 0 for none
uniform float uPulse;   // 0..1: a detent of the trackball, flaring the equator
uniform float uCursor;  // 0 Focus .. 1 Cursor
uniform float uDim;     // 0 awake .. 1 asleep (still looking for the TV)
uniform float uHold;    // 0..1: a finger is on the globe
uniform float uReveal;  // 0..1: the first appearance, the grid drawn out from the equator
out vec4 outColor;

const float PI = 3.141592653589793;

vec3 ribbon(float t) {
  t = fract(t);
  vec3 c = vec3(0.455, 0.820, 1.000);
  vec3 p = vec3(1.000, 0.455, 0.820);
  vec3 g = vec3(1.000, 0.914, 0.702);
  float k = t * 3.0;
  if (k < 1.0) return mix(c, p, smoothstep(0.0, 1.0, k));
  if (k < 2.0) return mix(p, g, smoothstep(0.0, 1.0, k - 1.0));
  return mix(g, c, smoothstep(0.0, 1.0, k - 2.0));
}

// An antialiased line every 'step' (in the units of v), 'px' pixels wide.
float grid(float v, float step, float px) {
  float d = abs(fract(v / step + 0.5) - 0.5) * step;
  float w = max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(px * w * 0.5, px * w * 0.5 + w, d);
}

void main() {
  float scale = 0.5 * min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / scale;
  const float R = 0.80;
  vec2 q = p / R;
  float r = length(q);
  float px = 1.0 / (scale * R);
  float ang = atan(q.y, q.x);
  float spin = uTime * 0.025;
  float wake = 1.0 - 0.62 * uDim;

  // The atmosphere just outside the rim, in the ribbon's colours. It must be gone before the canvas ends (the edge is
  // at r = 1.25 straight out from the middle), or the canvas shows as a square.
  float outside = max(r - 1.0, 0.0);
  float atmo = exp(-outside * (10.0 - 3.0 * uHold)) * smoothstep(1.0 - px, 1.0 + px, r) * smoothstep(1.24, 1.06, r)
             * (0.42 + 0.30 * uHold + 0.45 * uPulse) * uReveal * wake;
  vec3 col = ribbon(ang / (2.0 * PI) + spin) * atmo;
  float alpha = atmo;

  if (r < 1.0 + px) {
    float z = sqrt(max(1.0 - r * r, 0.0));
    vec3 n = vec3(q, z);
    vec3 w = uInv * n;
    float lat = degrees(asin(clamp(w.y, -1.0, 1.0)));
    float lon = degrees(atan(w.x, w.z));

    // Smoked glass, deeper at the bottom, a faint cold light inside.
    vec3 c = mix(vec3(0.010, 0.013, 0.028), vec3(0.046, 0.064, 0.128), smoothstep(-1.0, 1.0, q.y * 0.8 + 0.25));
    c += vec3(0.10, 0.16, 0.32) * pow(z, 3.0) * 0.16;

    float facing = smoothstep(0.02, 0.78, z);
    float poles = smoothstep(84.0, 64.0, abs(lat));
    float drawn = smoothstep(uReveal * 96.0, uReveal * 96.0 - 8.0, abs(lat));
    float coarse = max(grid(lat, 15.0, 1.15), grid(lon, 15.0, 1.15) * poles);
    float fine = max(grid(lat, 7.5, 0.75), grid(lon, 7.5, 0.75) * poles);
    float lines = mix(coarse, max(coarse, fine * 0.5), uCursor) * drawn;
    vec3 lineCol = mix(ribbon(lon / 360.0 + 0.5 + spin), vec3(0.72, 0.89, 1.0), uCursor * 0.6);
    c += lineCol * lines * (0.16 + 0.50 * facing);

    // Where the lines cross: small lights, like a city seen from above at night.
    vec2 cell = abs(fract(vec2(lat, lon) / 15.0 + 0.5) - 0.5) * 15.0;
    float dots = (1.0 - smoothstep(0.35, 0.35 + 1.6 * max(fwidth(lat), 1e-3), length(cell))) * poles * facing * drawn;
    c += vec3(1.0) * dots * (0.30 + 0.25 * (1.0 - uCursor));

    // The equator is the halo's ribbon: the brightest line, flaring on every step.
    float eq = exp(-pow(lat / (1.25 + 1.8 * uPulse), 2.0)) * smoothstep(0.0, 0.25, uReveal);
    c += ribbon(lon / 360.0 + spin * 2.0) * eq * (0.55 + 1.7 * uPulse) * (0.30 + 0.70 * facing);

    // Light: a key light high on the left, a glint, and the rim lit in the ribbon's colours.
    vec3 L = normalize(vec3(-0.50, 0.66, 0.56));
    c *= 0.70 + 0.48 * max(dot(n, L), 0.0);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float nh = max(dot(n, H), 0.0);
    c += vec3(1.0) * pow(nh, 110.0) * 0.60 + vec3(0.85, 0.92, 1.0) * pow(nh, 10.0) * 0.05;
    c += ribbon(ang / (2.0 * PI) + spin) * pow(1.0 - z, 2.7) * (0.50 + 0.40 * uHold) * uReveal;

    // A tap: a ring of light running out over the surface from the finger, and a flash where it was.
    if (uRipple.w >= 0.0) {
      float d = acos(clamp(dot(n, normalize(uRipple.xyz)), -1.0, 1.0));
      float front = uRipple.w * 2.7;
      float ring = exp(-pow((d - front) / 0.075, 2.0)) * exp(-uRipple.w * 2.3);
      float flash = exp(-d * 8.0) * exp(-uRipple.w * 8.0);
      c += vec3(0.82, 0.94, 1.0) * (ring * 0.95 + flash * 0.55);
    }

    c *= wake;
    float inside = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
    col = mix(col, c, inside);
    alpha = mix(alpha, 1.0, inside);
  }
  outColor = vec4(col, alpha);
}
`;
