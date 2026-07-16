import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeight, getSurfaceType } from '../core/heightmap.js';
import { toonify, toonMat, addOutline } from '../fx/Toon.js';

/**
 * Third-person player:
 *  - Orbit follow camera (pointer lock), character turns toward movement
 *  - WASD relative to camera, Shift sprint w/ stamina, Space jump, C sneak
 *  - Animated GLB character (./assets/models/character.glb — auto-detected;
 *    clips containing idle/walk/run are mapped). Toon-shaded to match the
 *    world. Procedural capsule fallback if the model is missing.
 *  - Cylinder + AABB collision, terrain-aware footsteps, health/stamina.
 */
export class ThirdPerson {
  constructor(scene, camera, input, audio, colliders, spawn) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.audio = audio;
    this.colliders = colliders;

    this.position = new THREE.Vector3(spawn.x, getHeight(spawn.x, spawn.z) + 0.5, spawn.z);
    this.velocity = new THREE.Vector3();
    this.heading = Math.PI;        // character facing
    this.yaw = Math.PI;            // camera yaw (HUD compass reads this)
    this.pitch = 0.35;             // camera elevation
    this.camDist = 7.0;
    this.controlCamera = true;     // main.js disables in ?debug

    this.health = 100; this.stamina = 100;
    this.alive = true; this.crouching = false; this.sprinting = false;
    this.onGround = true;
    this.timeSinceDamage = 99;
    this.RADIUS = 0.45;
    this.shake = 0;
    this.stepAcc = 0;
    this.runCycle = 0;

    // Character root
    this.rig = new THREE.Group();
    this.rig.position.copy(this.position);
    scene.add(this.rig);

    // Small torch light (F)
    this.torch = new THREE.PointLight(0xffe2b0, 0, 14, 1.4);
    this.torch.position.set(0, 2.4, 0);
    this.rig.add(this.torch);
    this.torchOn = false;

    this._loadModel();
    this._camPos = new THREE.Vector3();
  }

  async _loadModel() {
    try {
      const gltf = await new GLTFLoader().loadAsync('./assets/models/character.glb');
      const model = gltf.scene;
      // Skinned rigs report useless geometry bounds — measure via bone
      // positions after settling into the first pose.
      this.mixer = new THREE.AnimationMixer(model);
      this.actions = {};
      for (const clip of gltf.animations) {
        const n = clip.name.toLowerCase();
        for (const key of ['idle', 'walk', 'run']) {
          if (n.includes(key) && !this.actions[key]) this.actions[key] = this.mixer.clipAction(clip);
        }
      }
      (this.actions.idle || Object.values(this.actions)[0])?.play();
      this._active = this.actions.idle;
      this.mixer.update(0);

      const measure = () => {
        model.updateWorldMatrix(true, true);
        const box = new THREE.Box3(), v = new THREE.Vector3();
        let bones = false;
        model.traverse(o => {
          if (o.isBone) { bones = true; box.expandByPoint(o.getWorldPosition(v)); }
          else if (o.isMesh && !o.isSkinnedMesh) box.expandByObject(o);
        });
        if (!bones || box.isEmpty()) box.setFromObject(model);
        return box;
      };
      // Normalize to ~1.72 m tall, feet at origin
      let box = measure();
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(1.72 / Math.max(size.y, 0.001));
      box = measure();
      model.position.y -= box.min.y;
      toonify(model);
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      this.rig.add(model);
      this.model = model;
      console.info('[Player] character.glb loaded', Object.keys(this.actions));
    } catch (e) {
      console.warn('[Player] no character.glb — using capsule fallback');
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 10),
        toonMat({ color: 0xd0493a }));
      body.position.y = 1.0; body.castShadow = true; addOutline(body, 0.05);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), toonMat({ color: 0xf0c8a8 }));
      head.position.y = 1.75; head.castShadow = true; addOutline(head, 0.07);
      g.add(body, head);
      this.rig.add(g);
      this.model = g;
    }
  }

  _fade(name) {
    if (!this.actions) return;
    const next = this.actions[name] || this.actions.idle;
    if (!next || next === this._active) return;
    next.reset().fadeIn(0.22).play();
    this._active?.fadeOut(0.22);
    this._active = next;
  }

  damage(amount, cause) {
    if (!this.alive) return;
    this.health -= amount;
    this.timeSinceDamage = 0;
    this.shake = Math.min(1, this.shake + 0.7);
    if (this.health <= 0) { this.health = 0; this.alive = false; this.deathCause = cause; }
  }

  respawn(pos) {
    this.position.set(pos.x, (pos.y ?? getHeight(pos.x, pos.z)) + 0.5, pos.z);
    this.velocity.set(0, 0, 0);
    this.health = 100; this.stamina = 100; this.alive = true;
  }

  toggleTorch() { this.torchOn = !this.torchOn; this.torch.intensity = this.torchOn ? 18 : 0; }

  update(dt) {
    const inp = this.input;

    // ---------- Camera orbit ----------
    const m = inp.takeMouse();
    if (this.controlCamera) {
      this.yaw -= m.x * 0.0024;
      this.pitch = THREE.MathUtils.clamp(this.pitch + m.y * 0.002, -0.15, 1.15);
    }

    // ---------- Move intent (camera-relative) ----------
    const fwd = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const strafe = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    if (inp.consume('KeyC')) this.crouching = !this.crouching;
    this.sprinting = inp.down('ShiftLeft') && fwd > 0 && this.stamina > 4 && !this.crouching;

    const speed = this.crouching ? 2.2 : this.sprinting ? 7.4 : 4.2;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera looks toward -Z rotated by yaw; W walks away from camera
    const mx = (-sin * fwd + cos * strafe);
    const mz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(mx, mz);

    const accel = this.onGround ? 16 : 4;
    this.velocity.x += ((len ? mx / len : 0) * speed - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += ((len ? mz / len : 0) * speed - this.velocity.z) * Math.min(1, accel * dt);

    // Character turns toward movement
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar > 0.4) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 10);
    }

    // ---------- Stamina ----------
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - 14 * dt);
    else this.stamina = Math.min(100, this.stamina + 10 * dt);

    // ---------- Jump / gravity ----------
    if (inp.consume('Space') && this.onGround && this.stamina > 6) {
      this.velocity.y = 6.8; this.stamina -= 6; this.onGround = false;
    }
    this.velocity.y -= 20 * dt;

    // ---------- Integrate + collide ----------
    const p = this.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    p.y += this.velocity.y * dt;

    for (const c of this.colliders.cylinders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const rr = c.r + this.RADIUS, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
      }
    }
    for (const b of this.colliders.boxes) {
      if (b.isEmpty()) continue;
      if (p.x > b.min.x - this.RADIUS && p.x < b.max.x + this.RADIUS &&
          p.z > b.min.z - this.RADIUS && p.z < b.max.z + this.RADIUS &&
          p.y > b.min.y - 1.8 && p.y < b.max.y + 0.4) {
        const push = [
          p.x - (b.min.x - this.RADIUS), (b.max.x + this.RADIUS) - p.x,
          p.z - (b.min.z - this.RADIUS), (b.max.z + this.RADIUS) - p.z];
        const min = Math.min(...push);
        if (min === push[0]) p.x = b.min.x - this.RADIUS;
        else if (min === push[1]) p.x = b.max.x + this.RADIUS;
        else if (min === push[2]) p.z = b.min.z - this.RADIUS;
        else p.z = b.max.z + this.RADIUS;
      }
    }

    const ground = Math.max(getHeight(p.x, p.z), 0.3);
    if (p.y <= ground) {
      if (!this.onGround && this.velocity.y < -9) this.audio.footstep('rock', true);
      p.y = ground; this.velocity.y = 0; this.onGround = true;
    } else this.onGround = p.y - ground < 0.05;

    const inWater = p.y < 0.6;
    if (inWater) { this.velocity.x *= 0.93; this.velocity.z *= 0.93; }

    // ---------- Footsteps ----------
    if (this.onGround && planar > 0.6) {
      this.stepAcc += planar * dt;
      if (this.stepAcc > (this.sprinting ? 2.6 : 1.9)) {
        this.stepAcc = 0;
        this.audio.footstep(inWater ? 'mud' : getSurfaceType(p.x, p.z), this.sprinting);
      }
    }

    // ---------- Health regen ----------
    this.timeSinceDamage += dt;
    if (this.alive && this.timeSinceDamage > 7) this.health = Math.min(100, this.health + 3 * dt);

    // ---------- Animation ----------
    if (this.mixer) {
      const rel = planar / 7.4;
      this._fade(rel < 0.04 ? 'idle' : rel < 0.62 ? 'walk' : 'run');
      // Sync playback rate to actual speed so feet don't slide
      if (this._active === this.actions.walk) this._active.timeScale = Math.max(0.6, planar / 4.2);
      if (this._active === this.actions.run) this._active.timeScale = Math.max(0.7, planar / 7.4);
      this.mixer.update(dt);
    }
    this.rig.position.copy(p);
    this.rig.rotation.y = this.heading + Math.PI; // model forward correction
    const targetScaleY = this.crouching ? 0.8 : 1;
    this.rig.scale.y += (targetScaleY - this.rig.scale.y) * Math.min(1, dt * 8);

    // ---------- Follow camera ----------
    if (this.controlCamera) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const cp = this._camPos;
      cp.set(
        p.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.camDist,
        p.y + 1.6 + Math.sin(this.pitch) * this.camDist,
        p.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.camDist);
      // Keep camera above terrain
      cp.y = Math.max(cp.y, getHeight(cp.x, cp.z) + 0.5);
      this.camera.position.lerp(cp, Math.min(1, dt * 9));
      const sx = (Math.random() - 0.5) * this.shake * 0.2;
      this.camera.lookAt(p.x + sx, p.y + 1.5 + sx, p.z);
    }
  }
}
