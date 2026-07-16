import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeight, WORLD } from '../core/heightmap.js';
import { toonify, toonMat } from '../fx/Toon.js';

/**
 * SetDressing — places the static Sketchfab models as scenery & pickups:
 *  - T-rex skeleton  → plaza museum display ("Komori Dino Museum" — the
 *    reason this village had dinosaurs at all)
 *  - Mosquito in amber → collectible on the museum pedestal
 *  - Scooter          → parked by a house
 *  - Pteranodon       → circles the village sky on a code-driven flight path
 * Models load lazily and independently; a missing file just skips that prop.
 */
export class SetDressing {
  constructor(scene, interact, state, audio) {
    this.scene = scene;
    this.flyers = [];
    this.loader = new GLTFLoader();

    // --- Museum display: T-rex skeleton on a pedestal at the plaza ---
    this._load('./assets/models/trex_skeleton.glb', 4.2).then(model => {
      if (!model) return;
      const x = -14, z = 2;
      const y = getHeight(x, z);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(7, 0.7, 3.4), toonMat({ color: 0xc9cfc9 }));
      plinth.position.set(x, y + 0.35, z);
      plinth.receiveShadow = plinth.castShadow = true;
      scene.add(plinth);
      model.position.set(x, y + 0.7, z);
      model.rotation.y = 0.5;
      scene.add(model);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.1), toonMat({ color: 0x35c4a0 }));
      sign.position.set(x, y + 1.1, z + 2.4);
      scene.add(sign);
      interact.add({
        object: sign, radius: 3, label: 'Read museum plaque',
        action: () => {
          state.notify('"Komori Dino Park — where the past lives again." …That explains a lot.');
          return true;
        },
      });
    });

    // --- Amber collectible on the pier (a classic) ---
    this._load('./assets/models/amber.glb', 0.5).then(model => {
      if (!model) return;
      const x = 30, z = 76;
      model.position.set(x, 2.2, z);
      model.userData.spin = true;
      scene.add(model);
      const glow = new THREE.PointLight(0xffb347, 3, 6, 1.5);
      glow.position.set(x, 2.6, z);
      scene.add(glow);
      interact.add({
        object: model, radius: 2.6, label: 'Take the amber (mosquito inside…)',
        action: () => {
          state.addItem('amber', 'Mosquito in Amber', 'Life, uh, finds a way.');
          state.notify('Collected: Mosquito in Amber');
          audio.pickup();
          scene.remove(model, glow);
          return 'remove';
        },
      });
      this._amber = model;
    });

    // --- Scooter parked by the south street ---
    this._load('./assets/models/scooter.glb', 1.1, './models/cyberpunk_scooter.glb').then(model => {
      if (!model) return;
      const x = -10, z = 30;
      model.position.set(x, getHeight(x, z), z);
      model.rotation.y = 1.2;
      scene.add(model);
    });

    // --- Pteranodon circling overhead ---
    this._load('./assets/models/pteranodon.glb', 1.6).then(model => {
      if (!model) return;
      const pivot = new THREE.Group();
      pivot.add(model);
      scene.add(pivot);
      this.flyers.push({ pivot, model, angle: Math.random() * Math.PI * 2, radius: 55, height: 38, speed: 0.14 });
      // Second one, wider and higher
      const clone = model.clone();
      const pivot2 = new THREE.Group();
      pivot2.add(clone);
      scene.add(pivot2);
      this.flyers.push({ pivot: pivot2, model: clone, angle: Math.PI, radius: 80, height: 52, speed: -0.1 });
    });
  }

  async _load(path, targetHeight, fallbackPath) {
    for (const p of [path, fallbackPath].filter(Boolean)) {
      try {
        const gltf = await this.loader.loadAsync(p);
        const model = gltf.scene;
        toonify(model);
        model.traverse(o => { if (o.isMesh) o.castShadow = true; });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const s = targetHeight / Math.max(size.y, 0.001);
        model.scale.setScalar(s);
        box.setFromObject(model);
        model.position.y -= box.min.y;
        // Wrap so position.set() places the visual base predictably
        const wrap = new THREE.Group();
        wrap.add(model);
        return wrap;
      } catch { /* try next path */ }
    }
    console.info(`[SetDressing] optional model missing: ${path}`);
    return null;
  }

  update(dt) {
    for (const f of this.flyers) {
      f.angle += f.speed * dt;
      const x = Math.cos(f.angle) * f.radius;
      const z = Math.sin(f.angle) * f.radius - 10;
      f.pivot.position.set(x, f.height + Math.sin(f.angle * 3) * 3, z);
      // Face along the flight direction, bank into the turn
      f.pivot.rotation.y = -f.angle - (f.speed > 0 ? 0 : Math.PI);
      f.pivot.rotation.z = 0.25 * Math.sign(f.speed);
    }
    if (this._amber) this._amber.rotation.y += dt * 1.5;
  }
}
