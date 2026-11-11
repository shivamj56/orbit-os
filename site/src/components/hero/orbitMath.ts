// Just enough 4x4 matrix maths for the hero scene (column-major, as WebGL wants it).
export type M4 = Float32Array;

export const mat = () => new Float32Array(16);

export function identity(o: M4): M4 {
  o.fill(0);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}

/** o = a * b. `o` may not be `a` or `b`. */
export function mul(a: M4, b: M4, o: M4): M4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** A perspective projection whose centre is moved to (ox, oy) in clip space, so the subject can sit anywhere. */
export function perspective(o: M4, fovy: number, aspect: number, near: number, far: number, ox = 0, oy = 0): M4 {
  const f = 1 / Math.tan(fovy / 2);
  o.fill(0);
  o[0] = f / aspect;
  o[5] = f;
  o[8] = -ox;
  o[9] = -oy;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function lookAt(o: M4, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): M4 {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  // x = up × z, with up = (0, 1, 0)
  let xx = zz, xy = 0, xz = -zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez);
  o[13] = -(yx * ex + yy * ey + yz * ez);
  o[14] = -(zx * ex + zy * ey + zz * ez);
  o[15] = 1;
  return o;
}

export function translate(o: M4, x: number, y: number, z: number): M4 {
  identity(o);
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}

export function rotX(o: M4, a: number): M4 {
  identity(o);
  const c = Math.cos(a), s = Math.sin(a);
  o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
  return o;
}

export function rotY(o: M4, a: number): M4 {
  identity(o);
  const c = Math.cos(a), s = Math.sin(a);
  o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
  return o;
}

export function rotZ(o: M4, a: number): M4 {
  identity(o);
  const c = Math.cos(a), s = Math.sin(a);
  o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
  return o;
}

/** Multiplies a chain left to right: chain(o, A, B, C) = A * B * C. */
export function chain(o: M4, ...ms: M4[]): M4 {
  const t1 = mat(), t2 = mat();
  t1.set(ms[0]);
  for (let i = 1; i < ms.length; i++) {
    mul(t1, ms[i], t2);
    t1.set(t2);
  }
  o.set(t1);
  return o;
}

/** A TV body: a rounded rectangle pushed out to a depth, with normals (x, y, z, nx, ny, nz per vertex). */
export function roundedSlab(w: number, h: number, r: number, depth: number, seg = 8): Float32Array {
  const ring: [number, number, number, number][] = []; // x, y, nx, ny
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const nx = Math.cos(a), ny = Math.sin(a);
      ring.push([cx + nx * r, cy + ny * r, nx, ny]);
    }
  }
  const out: number[] = [];
  const zf = 0, zb = -depth;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    // front cap (fan around the centre)
    out.push(0, 0, zf, 0, 0, 1, a[0], a[1], zf, 0, 0, 1, b[0], b[1], zf, 0, 0, 1);
    // back cap
    out.push(0, 0, zb, 0, 0, -1, b[0], b[1], zb, 0, 0, -1, a[0], a[1], zb, 0, 0, -1);
    // side wall
    out.push(a[0], a[1], zf, a[2], a[3], 0, a[0], a[1], zb, a[2], a[3], 0, b[0], b[1], zf, b[2], b[3], 0);
    out.push(b[0], b[1], zf, b[2], b[3], 0, a[0], a[1], zb, a[2], a[3], 0, b[0], b[1], zb, b[2], b[3], 0);
  }
  return new Float32Array(out);
}
