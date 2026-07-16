import * as THREE from 'three';

/**
 * Proximity + facing based interaction system.
 * Entries: { object, radius, label, action() → true | 'remove', once }
 * The nearest valid target inside radius that the camera roughly faces
 * gets the on-screen "[E] label" prompt.
 */
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Interact {
  constructor(camera) {
    this.camera = camera;
    this.origin = null;   // set to player.position for third person — distance
                          // is measured from the character, not the camera
    this.entries = [];
    this.current = null;
  }

  add(entry) { this.entries.push(entry); }

  update() {
    this.camera.getWorldDirection(_dir);
    const from = this.origin || this.camera.position;
    let best = null, bestScore = Infinity;
    for (const e of this.entries) {
      e.object.getWorldPosition(_pos);
      _to.copy(_pos).sub(from);
      const dist = _to.length();
      if (dist > e.radius) continue;
      _to.normalize();
      if (_to.dot(_dir) < 0.1 && dist > 1.8) continue; // roughly camera-forward (unless on top of it)
      if (dist < bestScore) { bestScore = dist; best = e; }
    }
    this.current = best;
    // Spin pickup cards for visibility
    for (const e of this.entries) {
      if (e.object.userData.spin) e.object.rotation.y += 0.03;
    }
    return best;
  }

  use() {
    if (!this.current) return false;
    const result = this.current.action();
    if (result === 'remove' || this.current.once) {
      this.entries.splice(this.entries.indexOf(this.current), 1);
      this.current = null;
    }
    return true;
  }
}
