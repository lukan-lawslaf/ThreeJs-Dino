import { fbm } from './noise.js';

/**
 * Village heightmap — single source of truth for the ground.
 * A small seaside valley: flat village core, beach + sea to the south,
 * a shelter hill to the north, gentle rim hills boxing the play area.
 * Every system (ground mesh, player, dinos, placement) samples getHeight().
 */
export const WORLD = {
  SIZE: 420,
  regions: {
    spawn:   { x: 26,  z: 48 },   // beach road, near the pier
    plaza:   { x: 0,   z: 2 },
    office:  { x: -34, z: 33 },   // village office (shelter key)
    vending: { x: 14,  z: -16 },
    harbor:  { x: 30,  z: 66 },   // where the fence broke
    hilltop: { x: 0,   z: -95 },  // evacuation shelter
    torii:   { x: 0,   z: -58 },
  },
};

const smooth = t => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

/** Terrain height at world (x, z). Pure function — no allocation. */
export function getHeight(x, z) {
  // Gentle village ground with a hint of unevenness
  let h = 2.2 + fbm(x * 0.02, z * 0.02, 3) * 0.9;

  // Shelter hill (north)
  const hx = x - WORLD.regions.hilltop.x, hz = z - WORLD.regions.hilltop.z;
  const hd2 = hx * hx + hz * hz;
  const hill = Math.exp(-hd2 / (2 * 48 * 48));
  h += hill * 21 * (1 + fbm(x * 0.03, z * 0.03, 2) * 0.15);

  // Carve a walkable ramp up the hill along x≈0 (the stair path)
  const pathT = smoothstep(-100, -40, z) * (1 - smoothstep(-40, -20, z));
  const nearPath = 1 - smoothstep(3.5, 10, Math.abs(x));
  // (ramp emerges naturally from the gaussian; just soften side-slope near path)
  h -= hill * 4 * nearPath * (1 - pathT) * 0;

  // Beach: ground slides under the sea toward +z
  h = h * (1 - smoothstep(42, 66, z)) + (-2.6) * smoothstep(42, 66, z);

  // Rim hills box the valley (west/east/north edges)
  h += smoothstep(105, 165, Math.abs(x)) * 16 * (1 + fbm(z * 0.02, x * 0.02, 2) * 0.3);
  h += smoothstep(-140, -190, z) * 0; // hill already guards the north
  h += smoothstep(150, 200, -z) * 14;

  // Flatten build pads
  h = flatten(h, x, z, WORLD.regions.plaza, 52, 2.3);
  h = flatten(h, x, z, WORLD.regions.office, 16, 2.3);
  h = flatten(h, x, z, WORLD.regions.hilltop, 14, 22.6);

  return h;
}

function flatten(h, x, z, c, radius, level) {
  const dx = x - c.x, dz = z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > radius) return h;
  const t = smooth(1 - d / radius);
  return h * (1 - t) + level * t;
}

/** Roads: two horizontal streets + one vertical spine + hill path. */
export function onRoad(x, z) {
  if (Math.abs(z - 25) < 4.2 && Math.abs(x) < 62) return true;   // south street
  if (Math.abs(z + 20) < 4.2 && Math.abs(x) < 62) return true;   // north street
  if (Math.abs(x) < 3.6 && z > -100 && z < 52) return true;      // spine + hill path
  return false;
}

/** Approximate terrain normal via central differences. */
export function getNormal(x, z, out) {
  const e = 1.2;
  out.set(getHeight(x - e, z) - getHeight(x + e, z), 2 * e,
          getHeight(x, z - e) - getHeight(x, z + e)).normalize();
  return out;
}

/** Ground material category for footsteps / coloring. */
export function getSurfaceType(x, z) {
  if (onRoad(x, z)) return 'rock';
  if (z > 40) return 'sand';
  const h = getHeight(x, z);
  if (h > 14) return 'rock';
  return 'grass';
}
