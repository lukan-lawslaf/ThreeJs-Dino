import * as THREE from 'three';
import { getHeight, getNormal } from '../core/heightmap.js';
import { buildDino } from './DinoFactory.js';

/**
 * Dinosaur entity: AI state machine + locomotion + animation.
 *
 * States: IDLE → ROAM/PATROL → (carnivore) STALK → CHASE → ATTACK
 *                            → (herbivore) FLEE
 * Detection uses distance, player noise (sprint > walk > crouch) and a
 * forward vision cone. Carnivores lose interest beyond leash range.
 *
 * Works with both GLB AnimationMixer clips and the procedural rig.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Tuned for the compact village: the T-rex is barely faster than a
// sprinting player (7.4), so escapes are possible but tense.
export const BEHAVIOR = {
  trex:            { diet: 'carnivore', walk: 2.3, run: 7.8, detect: 24, vision: 38, attackRange: 4.2, damage: 45, roarEvery: [10, 22], leash: 70, stepShake: true },
  velociraptor:    { diet: 'carnivore', walk: 2.0, run: 8.4, detect: 20, vision: 30, attackRange: 2.2, damage: 16, roarEvery: [9, 20],  leash: 75 },
  utahraptor:      { diet: 'carnivore', walk: 1.9, run: 7.9, detect: 18, vision: 28, attackRange: 2.4, damage: 20, roarEvery: [11, 24], leash: 60 },
  stegosaurus:     { diet: 'herbivore', walk: 1.3, run: 4.5, detect: 12, attackRange: 0, damage: 0, roarEvery: [22, 48], leash: 45 },
  dilophosaurus:   { diet: 'carnivore', walk: 1.8, run: 6.5, detect: 16, vision: 24, attackRange: 2.2, damage: 12, roarEvery: [12, 26], leash: 55 },
  triceratops:     { diet: 'herbivore', walk: 1.6, run: 6.5, detect: 14, attackRange: 0, damage: 0, roarEvery: [20, 45], leash: 60 },
  parasaurolophus: { diet: 'herbivore', walk: 1.8, run: 7.0, detect: 18, attackRange: 0, damage: 0, roarEvery: [18, 40], leash: 70 },
  gallimimus:      { diet: 'herbivore', walk: 2.2, run: 9.0, detect: 22, attackRange: 0, damage: 0, roarEvery: [25, 50], leash: 90 },
  brachiosaurus:   { diet: 'herbivore', walk: 1.2, run: 1.2, detect: 0,  attackRange: 0, damage: 0, roarEvery: [25, 55], leash: 120, fearless: true },
};

export class Dinosaur {
  /**
   * @param {string} species  @param {THREE.Vector3} home spawn/anchor point
   * @param {object} ctx { scene, audio, getPlayer, onAttackPlayer }
   */
  constructor(species, home, ctx) {
    this.species = species;
    this.b = BEHAVIOR[species];
    this.home = home.clone();
    this.ctx = ctx;

    this.group = new THREE.Group();
    this.group.position.copy(home);
    this.state = 'idle';
    this.stateTime = 0;
    this.target = home.clone();
    this.speed = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.animTime = Math.random() * 10;
    this.roarTimer = this._nextRoar();
    this.attackCooldown = 0;
    this.alive = true;
    this.ready = false;
    this.homeOrig = home.clone();
    this.distractTimer = 0;

    buildDino(species).then(built => {
      this.built = built;
      this.group.add(built.group);
      this.ready = true;
      if (built.mixer && built.actions.idle) built.actions.idle.play();
    });
    ctx.scene.add(this.group);
  }

  _nextRoar() { const [a, b] = this.b.roarEvery; return a + Math.random() * (b - a); }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    // GLB clip crossfade
    const A = this.built?.actions;
    if (A && this.built.mixer) {
      const map = { idle: A.idle, roam: A.walk, patrol: A.walk, stalk: A.walk, chase: A.run, flee: A.run, attack: A.attack, roar: A.roar };
      const next = map[s] || A.idle;
      if (next && next !== this._activeAction) {
        next.reset().fadeIn(0.25).play();
        this._activeAction?.fadeOut(0.25);
        this._activeAction = next;
      }
    }
  }

  /** Pick a wander target near home. */
  _newRoamTarget() {
    const r = this.b.leash * (0.3 + Math.random() * 0.6);
    const a = Math.random() * Math.PI * 2;
    this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
  }

  /** Pull the dino to a point (harbor siren) and ignore the player for a while. */
  distract(pos, seconds) {
    this.home.copy(pos);
    this.distractTimer = seconds;
    this._newRoamTarget();
    this._setState('roam');
  }

  update(dt, player, distToPlayer) {
    if (!this.ready || !this.alive) return;
    this.stateTime += dt;
    this.attackCooldown -= dt;
    const b = this.b;
    const pos = this.group.position;

    if (this.distractTimer > 0) {
      this.distractTimer -= dt;
      if (this.distractTimer <= 0) this.home.copy(this.homeOrig);
    }

    // ---------- Perception ----------
    const noise = player.crouching ? 0.45 : player.sprinting ? 1.6 : 1.0;
    const detectR = b.detect * noise;
    const seesPlayer = this.distractTimer <= 0 && (distToPlayer < detectR ||
      (distToPlayer < (b.vision || 0) && this._inVisionCone(player.position)));

    // ---------- State transitions ----------
    if (b.diet === 'carnivore') {
      if (seesPlayer && !['chase', 'attack'].includes(this.state) && player.alive) {
        this._setState('chase');
        this.ctx.audio.roar(pos, this._size());
      }
      if (this.state === 'chase') {
        if (!player.alive || distToPlayer > (b.vision || b.detect) * 2.2) this._setState('roam');
        else if (distToPlayer < b.attackRange) this._setState('attack');
      }
      if (this.state === 'attack' && this.stateTime > 1.1) {
        // Damage lands mid-swing
        if (distToPlayer < b.attackRange * 1.15 && this.attackCooldown <= 0) {
          this.ctx.onAttackPlayer(b.damage, this.species);
          this.attackCooldown = 1.6;
        }
        this._setState(distToPlayer < b.attackRange ? 'attack' : 'chase');
        if (this.state === 'attack') this.stateTime = 0;
      }
    } else if (!b.fearless) {
      if (seesPlayer && this.state !== 'flee') {
        this._setState('flee');
      }
      if (this.state === 'flee' && (this.stateTime > 7 || distToPlayer > detectR * 3)) this._setState('roam');
    }

    if (this.state === 'idle' && this.stateTime > 3 + Math.random() * 5) {
      this._newRoamTarget();
      this._setState('roam');
    }
    if (this.state === 'roam') {
      _v1.set(this.target.x - pos.x, 0, this.target.z - pos.z);
      if (_v1.length() < 3 || this.stateTime > 25) this._setState('idle');
    }

    // ---------- Steering ----------
    let desiredSpeed = 0;
    let targetYaw = this.yaw;
    if (this.state === 'roam') {
      desiredSpeed = b.walk;
      targetYaw = Math.atan2(this.target.x - pos.x, this.target.z - pos.z);
    } else if (this.state === 'chase') {
      desiredSpeed = b.run;
      targetYaw = Math.atan2(player.position.x - pos.x, player.position.z - pos.z);
    } else if (this.state === 'flee') {
      desiredSpeed = b.run;
      targetYaw = Math.atan2(pos.x - player.position.x, pos.z - player.position.z);
    } else if (this.state === 'attack') {
      desiredSpeed = 0;
      targetYaw = Math.atan2(player.position.x - pos.x, player.position.z - pos.z);
    }

    // Leash: drift home if too far
    _v1.set(this.home.x - pos.x, 0, this.home.z - pos.z);
    if (_v1.length() > b.leash && this.state !== 'chase' && this.state !== 'flee') {
      targetYaw = Math.atan2(_v1.x, _v1.z);
      desiredSpeed = b.walk;
    }

    // Smooth turn (big dinos turn slower)
    let dyaw = targetYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turnRate = this.state === 'chase' ? 2.2 : 1.4;
    this.yaw += THREE.MathUtils.clamp(dyaw, -turnRate * dt, turnRate * dt);
    this.speed += (desiredSpeed - this.speed) * Math.min(1, dt * 3);

    // Move & stick to terrain; avoid deep water
    const nx = pos.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = pos.z + Math.cos(this.yaw) * this.speed * dt;
    const h = getHeight(nx, nz);
    if (h > 1.0) { pos.x = nx; pos.z = nz; }
    else { this.yaw += 2.5 * dt; } // water ahead → turn away
    pos.y += (getHeight(pos.x, pos.z) - pos.y) * Math.min(1, dt * 8);
    this.group.rotation.y = this.yaw;

    // ---------- Roars ----------
    this.roarTimer -= dt;
    if (this.roarTimer <= 0 && distToPlayer < 180) {
      this.roarTimer = this._nextRoar();
      this.ctx.audio.roar(pos, this._size());
      if (this.built.parts) this._roarPose = 1.2; // procedural roar pose timer
    }

    // T-rex footstep thumps you can feel
    if (b.stepShake && this.speed > 0.5 && distToPlayer < 90) {
      this._stepAcc = (this._stepAcc || 0) + dt * this.speed * 0.55;
      if (this._stepAcc > 1) {
        this._stepAcc = 0;
        this.ctx.audio.footstep('mud', true);
        this.ctx.onThump?.(1 - distToPlayer / 90);
      }
    }

    // ---------- Animate ----------
    if (this.built.mixer) {
      // Match playback speed to actual locomotion so feet don't slide
      if (this._activeAction && (this._activeAction === this.built.actions.walk || this._activeAction === this.built.actions.run)) {
        const ref = this.state === 'chase' || this.state === 'flee' ? b.run : b.walk;
        this._activeAction.timeScale = THREE.MathUtils.clamp(this.speed / Math.max(ref, 0.1), 0.5, 1.6);
      }
      this.built.mixer.update(dt);
    } else if (this.built.parts) {
      this._animateProcedural(dt);
    } else {
      // Static GLB (no clips): gentle life-like sway + walk bob
      this._swayT = (this._swayT || 0) + dt;
      const inner = this.built.group;
      inner.rotation.z = Math.sin(this._swayT * 1.1) * 0.02;
      inner.position.y = Math.abs(Math.sin(this._swayT * (1 + this.speed))) * 0.08 * Math.min(1, this.speed);
    }
  }

  _size() { return this.species === 'trex' || this.species === 'brachiosaurus' ? 1.6 : this.species === 'triceratops' ? 1.1 : 0.6; }

  _inVisionCone(target) {
    _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _v2.copy(target).sub(this.group.position).setY(0).normalize();
    return _v1.dot(_v2) > 0.5;
  }

  /** Code-driven walk cycle for the procedural rig. */
  _animateProcedural(dt) {
    const P = this.built.parts;
    const moving = this.speed > 0.2;
    this.animTime += dt * (1 + this.speed * 0.9);
    const t = this.animTime;
    const gait = Math.min(1, this.speed / this.b.run);

    // Legs: alternate swing; quadrupeds trot diagonally
    P.legs.forEach((leg, i) => {
      const phase = t * 4.5 + (P.legs.length === 2 ? i * Math.PI : (i % 2) * Math.PI + Math.floor(i / 2) * Math.PI * 0.5);
      const swing = moving ? Math.sin(phase) * (0.5 + gait * 0.4) : 0;
      leg.hip.rotation.z = swing;
      leg.knee.rotation.z = moving ? Math.max(0, -Math.sin(phase - 0.7)) * 0.8 : 0.05;
    });

    // Body bob & breathing (root base height stored once)
    if (this._rootBaseY === undefined) this._rootBaseY = P.root.position.y;
    const bob = moving ? Math.abs(Math.sin(t * 4.5)) * 0.06 * this.b.walk : Math.sin(t * 1.2) * 0.04;
    P.root.position.y = this._rootBaseY + bob;
    P.body.scale.y = 1 + Math.sin(t * 1.4) * 0.02;

    // Tail whip: sinuous wave down the chain
    P.tailSegs.forEach((seg, i) => {
      seg.rotation.y = Math.sin(t * 2 + i * 0.9) * (0.12 + gait * 0.15);
      seg.rotation.z = Math.sin(t * 1.3 + i * 0.5) * 0.04;
    });

    // Head/neck: scan when idle, lock forward when chasing
    const scan = this.state === 'idle' || this.state === 'roam' ? Math.sin(t * 0.6) * 0.4 : 0;
    P.neck.rotation.y += (scan - P.neck.rotation.y) * dt * 2;

    // Roar / attack pose: rear head back, open jaw
    if (this._roarPose > 0 || this.state === 'attack') {
      this._roarPose = Math.max(0, (this._roarPose || 0) - dt);
      const k = this.state === 'attack'
        ? Math.max(0, Math.sin(this.stateTime * 5))
        : Math.min(1, this._roarPose * 2);
      P.jaw.rotation.z = k * 0.55;
      P.neck.rotation.z = k * 0.28;
    } else {
      P.jaw.rotation.z *= 1 - dt * 4;
      P.neck.rotation.z *= 1 - dt * 4;
    }
  }
}
