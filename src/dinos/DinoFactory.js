import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonify, outlineTree } from '../fx/Toon.js';

/**
 * DinoFactory — builds dinosaur visuals.
 *
 * Two pipelines:
 *  1. GLB pipeline (preferred): put animated models in ./assets/models/
 *     named  trex.glb, velociraptor.glb, triceratops.glb, brachiosaurus.glb,
 *     dilophosaurus.glb, parasaurolophus.glb, gallimimus.glb
 *     — e.g. properly licensed downloads from
 *     https://sketchfab.com/tags/jurassic-park (download requires login) or
 *     CC0 packs like Quaternius' Animated Dinosaurs. Animation clips whose
 *     names contain idle/walk/run/attack/roar are auto-mapped to AI states.
 *  2. Procedural fallback (always available): articulated low-poly dinosaurs
 *     assembled from primitives with a code-driven walk/idle/attack cycle,
 *     so the game runs with zero downloads.
 */

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
loader.setDRACOLoader(draco);

const glbCache = new Map(); // species → gltf | null (null = tried & missing)

async function tryLoadGLB(species) {
  if (glbCache.has(species)) return glbCache.get(species);
  try {
    const gltf = await loader.loadAsync(`./assets/models/${species}.glb`);
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    glbCache.set(species, gltf);
    console.info(`[DinoFactory] Using GLB model for ${species}`);
    return gltf;
  } catch {
    glbCache.set(species, null);
    return null;
  }
}

/** Species visual definitions for the procedural builder. */
export const SPECIES = {
  trex: {
    color: 0x5a4a35, belly: 0x8a7a5f, scale: 1.35, biped: true,
    bodyLen: 4.2, bodyR: 1.5, neckLen: 1.6, headLen: 2.4, headR: 0.85,
    tailLen: 5.5, legLen: 3.4, armLen: 0.7, eyeColor: 0xffcc22,
  },
  velociraptor: {
    color: 0x7a5f38, belly: 0xa8905f, scale: 1.0, biped: true,
    bodyLen: 1.6, bodyR: 0.45, neckLen: 0.7, headLen: 0.9, headR: 0.28,
    tailLen: 2.4, legLen: 1.25, armLen: 0.55, eyeColor: 0xffee44, stripes: true,
  },
  dilophosaurus: {
    color: 0x4a6b3a, belly: 0x8fa060, scale: 1.3, biped: true,
    bodyLen: 1.9, bodyR: 0.55, neckLen: 0.9, headLen: 1.0, headR: 0.32,
    tailLen: 2.6, legLen: 1.5, armLen: 0.5, eyeColor: 0xff5533, crest: true,
  },
  gallimimus: {
    color: 0xb09a6a, belly: 0xd8c9a0, scale: 1.25, biped: true,
    bodyLen: 1.7, bodyR: 0.5, neckLen: 1.6, headLen: 0.7, headR: 0.2,
    tailLen: 2.2, legLen: 1.9, armLen: 0.5, eyeColor: 0x332211,
  },
  utahraptor: {
    color: 0x8a6a45, belly: 0xb8a075, scale: 1.15, biped: true,
    bodyLen: 1.8, bodyR: 0.5, neckLen: 0.8, headLen: 1.0, headR: 0.3,
    tailLen: 2.6, legLen: 1.4, armLen: 0.6, eyeColor: 0xffdd33, stripes: true,
  },
  stegosaurus: {
    color: 0x7a8a55, belly: 0xa8a878, scale: 1.6, biped: false,
    bodyLen: 3.8, bodyR: 1.2, neckLen: 0.7, headLen: 1.0, headR: 0.4,
    tailLen: 3.2, legLen: 1.5, eyeColor: 0x221100,
  },
  triceratops: {
    color: 0x6b7a4a, belly: 0x9aa070, scale: 2.2, biped: false,
    bodyLen: 4.4, bodyR: 1.5, neckLen: 0.6, headLen: 2.0, headR: 0.9,
    tailLen: 3.0, legLen: 2.0, eyeColor: 0x221100, frill: true, horns: true,
  },
  parasaurolophus: {
    color: 0x8a7a45, belly: 0xbfae7a, scale: 1.9, biped: false,
    bodyLen: 3.4, bodyR: 1.1, neckLen: 1.4, headLen: 1.3, headR: 0.45,
    tailLen: 3.4, legLen: 1.9, eyeColor: 0x221100, headCrest: true,
  },
  brachiosaurus: {
    color: 0x7a8a72, belly: 0xa8b098, scale: 4.2, biped: false,
    bodyLen: 6.0, bodyR: 2.2, neckLen: 8.0, headLen: 1.4, headR: 0.6,
    tailLen: 7.0, legLen: 4.2, eyeColor: 0x221100, longNeck: true,
  },
};

/**
 * Build a dinosaur. Returns:
 * { group, parts | mixer, actions, usesGLB }
 * parts = named pivots the procedural animator drives.
 */
export async function buildDino(species) {
  const gltf = await tryLoadGLB(species);
  if (gltf) return buildFromGLB(gltf, species);
  return buildProcedural(species);
}

/**
 * Per-model tuning for the Sketchfab downloads in ./assets/models/.
 * height   — desired world height in meters (normalizes wildly varying units)
 * rotY     — yaw correction so the model faces the AI's +Z travel direction
 * clips    — priority substrings per AI action (first match wins). GMod rigs
 *            ship dozens of directional clips (a_walkE, b_runNW…), so prefer
 *            the forward/neutral ones explicitly.
 */
const MODEL_TUNE = {
  trex: {
    height: 5.4, rotY: 0,
    clips: {
      idle: ['|idle'], walk: ['a_walk1', 'walkn'], run: ['|run1', 'uprun'],
      attack: ['biteattack'], roar: ['roar1', 'roar2'],
    },
  },
  velociraptor: {
    height: 1.8, rotY: 0,
    clips: {
      idle: ['a_idle', 'idle'], walk: ['a_walkn', 'walk'], run: ['a_runn', 'b_runn', 'run'],
      attack: ['attack_automatic', 'attack'], roar: ['taunt', 'cheer'],
    },
  },
  utahraptor: { height: 2.1, rotY: 0, clips: {} }, // generic 'Action' clips → mapped below
  stegosaurus: { height: 3.2, rotY: 0, clips: {} },
  brachiosaurus: { height: 11, rotY: 0, clips: {} },
};

function pickClip(anims, prefs) {
  for (const p of prefs) {
    const hit = anims.find(c => c.name.toLowerCase().includes(p));
    if (hit) return hit;
  }
  return null;
}

/**
 * Measure a model's true world bounds. Skinned GMod-style rigs often have
 * geometry authored at a tiny scale that only becomes correct through bone
 * transforms, so Box3.setFromObject on raw geometry lies badly. We pose the
 * rig first (mixer.update(0)) and then take the union of bone positions and
 * static-mesh bounds — accurate enough for uniform rescaling.
 */
function measureBounds(scene) {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let hasBones = false;
  scene.traverse(o => {
    if (o.isBone) { hasBones = true; box.expandByPoint(o.getWorldPosition(v)); }
    else if (o.isMesh && !o.isSkinnedMesh) box.expandByObject(o);
  });
  if (!hasBones || box.isEmpty()) box.setFromObject(scene);
  return box;
}

function buildFromGLB(gltf, species) {
  const scene = SkeletonUtils.clone(gltf.scene);
  toonify(scene); // match the village's cel-shaded look
  const group = new THREE.Group();
  const tune = MODEL_TUNE[species] || {};

  // Map animation clips to AI actions (before measuring, so we can pose)
  const actions = {};
  let mixer = null;
  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(scene);
    const prefs = tune.clips || {};
    for (const key of ['idle', 'walk', 'run', 'attack', 'roar']) {
      const clip = pickClip(gltf.animations, prefs[key] || [key]);
      if (clip) actions[key] = mixer.clipAction(clip);
    }
    // Nothing matched (generic 'Action' names): loop the longest clip for all
    if (!Object.keys(actions).length) {
      const longest = [...gltf.animations].sort((a, b) => b.duration - a.duration)[0];
      const act = mixer.clipAction(longest);
      actions.idle = actions.walk = actions.run = act;
    }
    if (!actions.roar && actions.attack) actions.roar = actions.attack;
    if (!actions.run && actions.walk) actions.run = actions.walk;
    if (!actions.walk && actions.run) actions.walk = actions.run;
    // Settle into idle pose so the measurement below sees real proportions
    (actions.idle || Object.values(actions)[0])?.play();
    mixer.update(0);
  }

  // Normalize size: scale so total height matches tune.height (or species def)
  const box = measureBounds(scene);
  const size = box.getSize(new THREE.Vector3());
  const def = SPECIES[species];
  const targetH = tune.height ?? (def ? (def.legLen + def.bodyR * 2) * def.scale : 2);
  const s = targetH / Math.max(size.y, 0.001);
  scene.scale.setScalar(s);
  const box2 = measureBounds(scene);
  scene.position.y -= box2.min.y;        // feet on the ground
  const center = box2.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;          // center on origin
  scene.position.z -= center.z;
  scene.rotation.y = tune.rotY || 0;
  group.add(scene);

  return { group, mixer, actions, usesGLB: true, simple: !mixer };
}

/* ======================= PROCEDURAL BUILDER ======================= */

function buildProcedural(species) {
  const d = SPECIES[species];
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.85, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: d.belly, roughness: 0.9, flatShading: true });
  // Cel-shade + ink outlines applied after assembly (see end of function)

  const parts = {};
  const S = d.scale;

  // --- Body (capsule-ish: sphere-scaled) hung on a root pivot at hip height
  const root = new THREE.Group();
  root.position.y = d.legLen * S;
  group.add(root);
  parts.root = root;

  const bodyGeo = new THREE.SphereGeometry(d.bodyR * S, 10, 8);
  bodyGeo.scale(d.bodyLen / (d.bodyR * 2), 1, 1);
  const body = new THREE.Mesh(bodyGeo, skin);
  body.castShadow = true;
  if (d.biped) body.rotation.z = 0.35; // tilted posture: hips high, chest forward-down
  root.add(body);
  parts.body = body;

  // Belly plate
  const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(d.bodyR * S * 0.82, 8, 6), belly);
  bellyMesh.scale.set(d.bodyLen / (d.bodyR * 2) * 0.9, 0.9, 0.9);
  bellyMesh.position.y = -d.bodyR * S * 0.25;
  body.add(bellyMesh);

  // --- Neck & head on a pivot at body front
  const neckPivot = new THREE.Group();
  neckPivot.position.set(d.bodyLen * S * 0.42, d.bodyR * S * (d.biped ? 0.5 : 0.3), 0);
  root.add(neckPivot);
  parts.neck = neckPivot;

  const neckGeo = new THREE.CylinderGeometry(d.headR * S * 0.8, d.bodyR * S * 0.6, d.neckLen * S, 7);
  const neck = new THREE.Mesh(neckGeo, skin);
  neck.castShadow = true;
  const neckAngle = d.longNeck ? 1.15 : d.biped ? 0.5 : 0.35;
  neck.rotation.z = -Math.PI / 2 + neckAngle;
  neck.position.set(Math.cos(neckAngle) * d.neckLen * S * 0.5, Math.sin(neckAngle) * d.neckLen * S * 0.5, 0);
  neckPivot.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.set(Math.cos(neckAngle) * d.neckLen * S, Math.sin(neckAngle) * d.neckLen * S, 0);
  neckPivot.add(headPivot);
  parts.head = headPivot;

  const headGeo = new THREE.SphereGeometry(d.headR * S, 8, 6);
  headGeo.scale(d.headLen / (d.headR * 2), 0.85, 0.75);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.x = d.headLen * S * 0.3;
  head.castShadow = true;
  headPivot.add(head);

  // Jaw (animates on roar/attack)
  const jawGeo = new THREE.SphereGeometry(d.headR * S * 0.75, 7, 5);
  jawGeo.scale(d.headLen / (d.headR * 2) * 0.85, 0.45, 0.65);
  const jaw = new THREE.Mesh(jawGeo, belly);
  jaw.position.set(d.headLen * S * 0.32, -d.headR * S * 0.4, 0);
  headPivot.add(jaw);
  parts.jaw = jaw;

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: d.eyeColor, emissive: d.eyeColor, emissiveIntensity: 0.5, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(d.headR * S * 0.16, 6, 5), eyeMat);
    eye.position.set(d.headLen * S * 0.28, d.headR * S * 0.25, side * d.headR * S * 0.62);
    headPivot.add(eye);
  }

  // Species flourishes
  if (d.crest) { // dilophosaurus double crest
    const crestMat = new THREE.MeshStandardMaterial({ color: 0xcc4422, roughness: 0.7, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(d.headR * S * 0.7, 8, 0, Math.PI), crestMat);
      c.position.set(d.headLen * S * 0.15, d.headR * S * 0.5, side * d.headR * S * 0.3);
      c.rotation.y = side * 0.15;
      headPivot.add(c);
    }
  }
  if (d.frill) { // triceratops frill + horns
    const frill = new THREE.Mesh(
      new THREE.CircleGeometry(d.headR * S * 1.7, 10),
      new THREE.MeshStandardMaterial({ color: 0x55663a, roughness: 0.8, side: THREE.DoubleSide }));
    frill.position.set(-d.headLen * S * 0.25, d.headR * S * 0.6, 0);
    frill.rotation.y = Math.PI / 2;
    frill.rotation.x = -0.3;
    headPivot.add(frill);
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(d.headR * S * 0.14, d.headR * S * 1.6, 6), hornMat);
      horn.position.set(d.headLen * S * 0.2, d.headR * S * 0.55, side * d.headR * S * 0.45);
      horn.rotation.z = -1.2;
      headPivot.add(horn);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(d.headR * S * 0.12, d.headR * S * 0.7, 6), hornMat);
    nose.position.set(d.headLen * S * 0.45, d.headR * S * 0.15, 0);
    nose.rotation.z = -1.2;
    headPivot.add(nose);
  }
  if (d.headCrest) { // parasaurolophus tube crest
    const crest = new THREE.Mesh(new THREE.CylinderGeometry(d.headR * S * 0.2, d.headR * S * 0.3, d.headLen * S * 1.4, 6), skin);
    crest.position.set(-d.headLen * S * 0.3, d.headR * S * 0.7, 0);
    crest.rotation.z = 0.9;
    headPivot.add(crest);
  }

  // --- Tail: chain of shrinking segments for whip animation
  parts.tailSegs = [];
  let tailParent = root;
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const pivot = new THREE.Group();
    const segLen = (d.tailLen / segs) * S;
    pivot.position.x = i === 0 ? -d.bodyLen * S * 0.42 : -segLen;
    tailParent.add(pivot);
    const r = d.bodyR * S * 0.55 * (1 - i / segs);
    const segGeo = new THREE.CylinderGeometry(r * 0.7, r, segLen, 6);
    segGeo.rotateZ(Math.PI / 2);
    const seg = new THREE.Mesh(segGeo, skin);
    seg.position.x = -segLen / 2;
    seg.castShadow = true;
    pivot.add(seg);
    parts.tailSegs.push(pivot);
    tailParent = pivot;
  }

  // --- Legs
  parts.legs = [];
  const legR = d.bodyR * S * (d.biped ? 0.3 : 0.26);
  const mkLeg = (px, pz, len) => {
    const hip = new THREE.Group();
    hip.position.set(px, -d.bodyR * S * 0.2, pz);
    root.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR * 0.75, len * 0.55, 6), skin);
    thigh.position.y = -len * 0.27;
    thigh.castShadow = true;
    hip.add(thigh);
    const kneePivot = new THREE.Group();
    kneePivot.position.y = -len * 0.55;
    hip.add(kneePivot);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(legR * 0.7, legR * 0.5, len * 0.5, 6), skin);
    shin.position.y = -len * 0.25;
    shin.castShadow = true;
    kneePivot.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(legR * 4, legR * 0.9, legR * 2.4), skin);
    foot.position.set(legR * 0.9, -len * 0.5, 0);
    kneePivot.add(foot);
    parts.legs.push({ hip, knee: kneePivot });
    return hip;
  };
  const legLen = d.legLen * S;
  if (d.biped) {
    mkLeg(-d.bodyLen * S * 0.1, -d.bodyR * S * 0.7, legLen);
    mkLeg(-d.bodyLen * S * 0.1, d.bodyR * S * 0.7, legLen);
    // Tiny arms
    if (d.armLen) {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(
          new THREE.CylinderGeometry(legR * 0.35, legR * 0.25, d.armLen * S, 5), skin);
        arm.position.set(d.bodyLen * S * 0.28, 0, side * d.bodyR * S * 0.75);
        arm.rotation.x = side * 0.4;
        arm.rotation.z = 1.1;
        root.add(arm);
      }
    }
  } else {
    mkLeg(d.bodyLen * S * 0.32, -d.bodyR * S * 0.72, legLen);
    mkLeg(d.bodyLen * S * 0.32, d.bodyR * S * 0.72, legLen);
    mkLeg(-d.bodyLen * S * 0.32, -d.bodyR * S * 0.72, legLen);
    mkLeg(-d.bodyLen * S * 0.32, d.bodyR * S * 0.72, legLen);
  }

  // Raptor stripes via simple darker bands
  if (d.stripes) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x3a2c18, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(d.bodyR * S * 0.95, d.bodyR * S * 0.06, 4, 10), stripeMat);
      band.position.x = (-0.3 + i * 0.22) * d.bodyLen * S;
      band.rotation.y = Math.PI / 2;
      body.add(band);
    }
  }

  toonify(group);
  outlineTree(group, 0.06);
  return { group, parts, usesGLB: false };
}
