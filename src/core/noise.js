/**
 * Deterministic simplex-style value noise + fBM.
 * Used by terrain, vegetation scattering, wind and weather.
 * Self-contained so every system samples the exact same island.
 */
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  let seed = 1337;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const grad = (h, x, y) => {
  switch (h & 7) {
    case 0: return  x + y; case 1: return  x - y;
    case 2: return -x + y; case 3: return -x - y;
    case 4: return  x;     case 5: return -x;
    case 6: return  y;     default: return -y;
  }
};
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 2D gradient noise in [-1, 1]. */
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const aa = PERM[PERM[X] + Y],     ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  return lerp(
    lerp(grad(aa, x, y),     grad(ba, x - 1, y), u),
    lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u), v);
}

/** Fractal Brownian motion. */
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    freq *= lacunarity; amp *= gain;
  }
  return sum;
}

/** Hash for deterministic per-instance randomness. */
export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
