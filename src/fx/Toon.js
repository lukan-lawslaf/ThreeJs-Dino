import * as THREE from 'three';

/**
 * Toon rendering kit — gives the whole game its anime / ink-illustration
 * look (flat banded lighting + dark inverted-hull outlines).
 */

let gradientMap = null;
/** 3-step lighting ramp shared by every toon material. */
export function getGradientMap() {
  if (!gradientMap) {
    const data = new Uint8Array([110, 190, 255]);
    gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

/** Convenience constructor for cel-shaded materials. */
export function toonMat(opts = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), ...opts });
}

/** Replace PBR materials on an imported model with toon equivalents. */
export function toonify(root) {
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const apply = m => {
      if (m.isMeshToonMaterial || m.isShaderMaterial) return m;
      return new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        gradientMap: getGradientMap(),
        transparent: m.transparent, opacity: m.opacity,
        side: m.side,
        emissive: m.emissive ? m.emissive.clone() : undefined,
        emissiveIntensity: m.emissiveIntensity,
      });
    };
    o.material = Array.isArray(o.material) ? o.material.map(apply) : apply(o.material);
  });
}

export const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: 0x1d2a30, side: THREE.BackSide, toneMapped: false,
});

/**
 * Ink outline via inverted hull. Works for meshes whose geometry is roughly
 * centered on its local origin (all our primitives). Skip skinned meshes.
 */
export function addOutline(mesh, thickness = 0.035) {
  if (mesh.isSkinnedMesh) return;
  const shell = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  shell.scale.setScalar(1 + thickness);
  shell.castShadow = false;
  mesh.add(shell);
  return shell;
}

/** Outline every mesh in a subtree (procedural dinos, props). */
export function outlineTree(root, thickness = 0.045) {
  const targets = [];
  root.traverse(o => { if (o.isMesh && o.material !== OUTLINE_MAT && !o.isSkinnedMesh) targets.push(o); });
  targets.forEach(m => addOutline(m, thickness));
}
