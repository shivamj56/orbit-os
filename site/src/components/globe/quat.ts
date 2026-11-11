// From phone/ui/src/globe: Orbit's own globe, unchanged.
// Just enough quaternion for a trackball: compose small rotations, keep it unit length, hand GL a matrix.
export type Quat = [number, number, number, number]; // x, y, z, w

export const identity = (): Quat => [0, 0, 0, 1];

export function axisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const len = Math.hypot(ax, ay, az) || 1;
  const s = Math.sin(angle / 2) / len;
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The inverse rotation (view to globe) as a column-major mat3, what the shader needs to find lat/long under a pixel. */
export function inverseMat3(q: Quat, out: Float32Array): Float32Array {
  const [x, y, z, w] = [-q[0], -q[1], -q[2], q[3]];
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[3] = 2 * (x * y - z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z + x * w);
  out[6] = 2 * (x * z + y * w);
  out[7] = 2 * (y * z - x * w);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}
