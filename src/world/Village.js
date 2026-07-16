import * as THREE from 'three';
import { getHeight, getSurfaceType, onRoad, WORLD } from '../core/heightmap.js';
import { noise2, hash2 } from '../core/noise.js';
import { toonMat, addOutline, outlineTree } from '../fx/Toon.js';

/**
 * Village — the whole playable set: toon ground, sea, streets, houses,
 * power poles with sagging wires, teal guard rails, the pier & boat,
 * the broken harbor fence (where the dinosaurs got out), the village
 * office, a vending machine, the hillside stairs, torii gate and the
 * evacuation shelter (win condition).
 *
 * Everything is flat-colored MeshToonMaterial with ink outlines to match
 * a hand-drawn anime look. Registers colliders + interactables.
 */

const PALETTE = {
  grass: 0x69b459, grassLight: 0x8fce74, sand: 0xe9dcab, roadEdge: 0x2a343a,
  road: 0xcfd6d2, cream: 0xf2ead8, white: 0xfafaf2, pink: 0xe8c9b8,
  teal: 0x35c4a0, roofRed: 0xb4574a, roofBlue: 0x5a7d8c, roofDark: 0x4a4f58,
  wood: 0xb08a5a, woodDark: 0x77572f, ink: 0x1d2a30, metal: 0x9aa4a8,
  leaf: 0x4da54b, leafLight: 0x7cc65e, trunk: 0x6b4f34,
};

export class Village {
  constructor(scene, interact, state, audio) {
    this.scene = scene;
    this.interact = interact;
    this.state = state;
    this.audio = audio;
    this.colliders = { cylinders: [], boxes: [] };
    this.time = 0;

    this._ground();
    this._sea();
    this._roads();
    this._houses();
    this._powerPoles();
    this._pier();
    this._brokenFence();
    this._hillPath();
    this._shelter();
    this._trees();
    this._props();
  }

  /* ---------- helpers ---------- */
  _mesh(geo, mat, x, y, z, ry = 0, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    this.scene.add(m);
    if (opts.collide) {
      m.updateMatrixWorld();
      this.colliders.boxes.push(new THREE.Box3().setFromObject(m));
    }
    if (opts.outline) addOutline(m, opts.outline === true ? 0.03 : opts.outline);
    return m;
  }
  _box(w, h, d, color, x, y, z, ry = 0, opts = {}) {
    return this._mesh(new THREE.BoxGeometry(w, h, d), toonMat({ color }), x, y, z, ry, opts);
  }

  /* ---------- ground & sea ---------- */
  _ground() {
    const S = WORLD.SIZE, SEG = 200;
    const geo = new THREE.PlaneGeometry(S, S, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), grass = new THREE.Color(PALETTE.grass),
      grassL = new THREE.Color(PALETTE.grassLight), sand = new THREE.Color(PALETTE.sand),
      rock = new THREE.Color(0xb9bec2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, getHeight(x, z));
      const t = getSurfaceType(x, z);
      if (t === 'sand') c.copy(sand);
      else if (t === 'rock' && !onRoad(x, z)) c.copy(rock);
      else if (onRoad(x, z)) c.set(PALETTE.road);
      else c.copy(grass).lerp(grassL, noise2(x * 0.06, z * 0.06) * 0.5 + 0.5 > 0.55 ? 0.8 : 0.15);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toonMat({ vertexColors: true }));
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _sea() {
    this.seaUniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      transparent: true,
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec3 vW;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          // Flat anime sea: mint base with drifting pale bands + sparkle dashes
          vec3 base = vec3(0.36,0.72,0.66);
          float band = sin(vW.x*0.14 + uTime*0.5) + sin(vW.z*0.22 - uTime*0.35) + sin((vW.x+vW.z)*0.07 + uTime*0.2);
          vec3 col = mix(base, vec3(0.55,0.85,0.78), step(1.15, band)*0.9);
          // Sparkle dashes
          vec2 cell = floor(vW.xz * 0.8 + vec2(uTime*0.4, 0.0));
          if (hash(cell) > 0.985) col = vec3(0.95);
          gl_FragColor = vec4(col, 0.96);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.05;
    this.scene.add(sea);
  }

  /* ---------- streets with ink edge lines ---------- */
  _roads() {
    // Roads are painted into ground vertex colors; add ink edge strips + crossing
    const edge = toonMat({ color: PALETTE.roadEdge });
    const strip = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const g = new THREE.BoxGeometry(len, 0.06, 0.22);
      const m = new THREE.Mesh(g, edge);
      m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      // Drape over terrain midpoint
      m.position.y = getHeight((x1 + x2) / 2, (z1 + z2) / 2) + 0.06;
      this.scene.add(m);
    };
    for (const rz of [25, -20]) {
      for (const side of [-4.4, 4.4]) {
        for (let x = -60; x < 60; x += 12) strip(x, rz + side, x + 9, rz + side);
      }
    }
    for (const side of [-3.8, 3.8]) {
      for (let z = -36; z < 48; z += 12) strip(side, z, side, z + 9);
    }
  }

  /* ---------- houses ---------- */
  _house(x, z, ry, w, d, floors, wallColor, roofColor) {
    const y = getHeight(x, z);
    const h = floors * 3.1;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.scene.add(g);

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat({ color: wallColor }));
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    addOutline(body, 0.02);
    g.add(body);
    body.updateWorldMatrix(true, false);
    this.colliders.boxes.push(new THREE.Box3().setFromObject(body));

    // Pitched roof: extruded triangle
    const shape = new THREE.Shape();
    const hw = w / 2 + 0.55;
    shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(0, w * 0.34); shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 1.1, bevelEnabled: false });
    roofGeo.translate(0, 0, -(d + 1.1) / 2);
    const roof = new THREE.Mesh(roofGeo, toonMat({ color: roofColor }));
    roof.position.y = h;
    roof.castShadow = true;
    addOutline(roof, 0.02);
    g.add(roof);

    // Windows (front + back), door (front)
    const winMat = toonMat({ color: 0x274451 });
    const frameMat = toonMat({ color: PALETTE.white });
    for (let f = 0; f < floors; f++) {
      for (const sx of [-w / 4, w / 4]) {
        for (const face of [1, -1]) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.12), frameMat);
          frame.position.set(sx, f * 3.1 + 1.9, face * (d / 2 + 0.05));
          g.add(frame);
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.95, 0.16), winMat);
          win.position.copy(frame.position);
          g.add(win);
        }
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.14), toonMat({ color: PALETTE.woodDark }));
    door.position.set(0, 1.1, d / 2 + 0.05);
    g.add(door);
    // AC unit — the little detail that sells "lived-in"
    const ac = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.5), toonMat({ color: PALETTE.metal }));
    ac.position.set(w / 2 - 0.8, h - 0.9, d / 2 + 0.3);
    addOutline(ac, 0.06);
    g.add(ac);
    return g;
  }

  _houses() {
    const rows = [
      // [x, z, ry(face road), w, d, floors, wall, roof]
      [-46, 33, Math.PI, 8, 7, 2, PALETTE.cream, PALETTE.roofRed],
      [-34, 34, Math.PI, 9, 8, 1, PALETTE.white, PALETTE.roofBlue],   // office (sign added below)
      [-16, 35, Math.PI, 7, 6, 2, PALETTE.pink, PALETTE.roofDark],
      [14, 34, Math.PI, 8, 7, 2, PALETTE.cream, PALETTE.roofBlue],
      [30, 35, Math.PI, 7, 6, 1, PALETTE.white, PALETTE.roofRed],
      [46, 33, Math.PI, 9, 8, 2, PALETTE.pink, PALETTE.roofBlue],
      [-44, 14, 0, 8, 7, 1, PALETTE.white, PALETTE.roofBlue],
      [-24, 13, 0, 9, 7, 2, PALETTE.cream, PALETTE.roofRed],
      [20, 13, 0, 8, 6, 2, PALETTE.white, PALETTE.roofDark],
      [42, 14, 0, 7, 7, 1, PALETTE.cream, PALETTE.roofRed],
      [-44, -31, 0, 8, 7, 2, PALETTE.pink, PALETTE.roofBlue],
      [-20, -32, 0, 9, 8, 1, PALETTE.cream, PALETTE.roofRed],
      [16, -32, 0, 8, 7, 2, PALETTE.white, PALETTE.roofBlue],
      [40, -31, 0, 7, 6, 1, PALETTE.pink, PALETTE.roofDark],
      [-30, -8, Math.PI, 7, 6, 1, PALETTE.white, PALETTE.roofRed],
      [32, -7, Math.PI, 8, 7, 2, PALETTE.cream, PALETTE.roofBlue],
    ];
    for (const r of rows) this._house(...r);

    // Village office: sign + the shelter key inside reach
    const o = WORLD.regions.office;
    const oy = getHeight(o.x, o.z);
    const sign = this._box(3.2, 1.0, 0.18, PALETTE.teal, o.x, oy + 3.4, o.z - 4.2, 0, { outline: 0.05 });
    this._box(0.14, 3, 0.14, PALETTE.ink, o.x - 1.4, oy + 1.5, o.z - 4.2, 0, { shadow: false });
    this._box(0.14, 3, 0.14, PALETTE.ink, o.x + 1.4, oy + 1.5, o.z - 4.2, 0, { shadow: false });
    const desk = this._box(2.2, 1, 1, PALETTE.wood, o.x, oy + 0.5, o.z - 5.8, 0, { outline: 0.05 });
    this.interact.add({
      object: desk, radius: 3.2, label: 'Search the village office desk', once: true,
      action: () => {
        this.state.addItem('shelter_key', 'Shelter Key', 'Opens the hillside evacuation shelter.');
        this.state.notify('Found the SHELTER KEY');
        this.state.setObjective('Head north, up the hill stairs, and unlock the evacuation shelter.');
        this.audio.pickup();
        return true;
      },
    });
  }

  /* ---------- power poles with sagging wires ---------- */
  _powerPoles() {
    const poleMat = toonMat({ color: 0x5c554c });
    const wireMat = new THREE.MeshBasicMaterial({ color: PALETTE.ink });
    const poles = [];
    for (const rz of [29.5, -24.5]) {
      for (let x = -55; x <= 55; x += 22) poles.push([x, rz]);
    }
    let prev = null;
    for (const [x, z] of poles) {
      const y = getHeight(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9, 6), poleMat);
      pole.position.set(x, y + 4.5, z);
      pole.castShadow = true;
      addOutline(pole, 0.15);
      this.scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), poleMat);
      arm.position.set(x, y + 8.2, z);
      this.scene.add(arm);
      this.colliders.cylinders.push({ x, z, r: 0.35 });

      if (prev && Math.abs(prev[1] - z) < 1) { // same street → sag a wire
        for (const dz of [-0.7, 0.7]) {
          const a = new THREE.Vector3(prev[0], getHeight(prev[0], prev[1]) + 8.1, prev[1] + dz);
          const b = new THREE.Vector3(x, y + 8.1, z + dz);
          const mid = a.clone().lerp(b, 0.5); mid.y -= 1.1;
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.03, 4), wireMat);
          this.scene.add(wire);
        }
      }
      prev = [x, z];
      if (x >= 55) prev = null;
    }
  }

  /* ---------- pier, boat, harbor ---------- */
  _pier() {
    const px = 30;
    for (let i = 0; i < 12; i++) {
      this._box(3.4, 0.25, 2.3, PALETTE.wood, px, 1.5, 50 + i * 2.4, 0, { shadow: false });
    }
    for (let i = 0; i < 6; i++) {
      for (const dx of [-1.5, 1.5]) {
        const pile = this._mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.4, 6),
          toonMat({ color: PALETTE.woodDark }), px + dx, 0.2, 51 + i * 4.9);
        addOutline(pile, 0.12);
      }
    }
    // Teal guard rail along the pier (the reference image's railings)
    this._rail(px - 1.7, 50, px - 1.7, 78);
    this._rail(px + 1.7, 50, px + 1.7, 78);

    // Little fishing boat
    const bx = 38, bz = 72;
    const hull = this._box(3, 1.4, 7.5, PALETTE.white, bx, 0.7, bz, 0.25, { outline: 0.03 });
    const trim = this._box(3.05, 0.4, 7.55, 0x3b6f8a, bx, 1.5, bz, 0.25, { shadow: false });
    const cabin = this._box(2.2, 1.5, 2.4, PALETTE.cream, bx - 0.3, 2.4, bz + 1.6, 0.25, { outline: 0.04 });
  }

  _rail(x1, z1, x2, z2) {
    const mat = toonMat({ color: PALETTE.teal });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 2.2));
    const ry = -Math.atan2(z2 - z1, x2 - x1) + Math.PI / 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const y = Math.max(getHeight(x, z), 1.4);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), mat);
      post.position.set(x, y + 0.55, z);
      this.scene.add(post);
    }
    const midX = (x1 + x2) / 2, midZ = (z1 + z2) / 2;
    const y = Math.max(getHeight(midX, midZ), 1.4);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, len), mat);
    top.position.set(midX, y + 1.1, midZ);
    top.rotation.y = ry;
    addOutline(top, 0.03);
    this.scene.add(top);
  }

  /* ---------- broken harbor fence: how they got out ---------- */
  _brokenFence() {
    const z = 46;
    const postMat = toonMat({ color: 0x6a7076 });
    for (let x = 8; x <= 56; x += 4) {
      const broken = x > 24 && x < 40; // the hole
      const y = getHeight(x, z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, broken ? 1.2 : 3.4, 0.3), postMat);
      post.position.set(x, y + (broken ? 0.4 : 1.7), z);
      if (broken) post.rotation.z = (hash2(x, 1) - 0.5) * 1.6;
      post.castShadow = true;
      addOutline(post, 0.08);
      this.scene.add(post);
      if (!broken) this.colliders.cylinders.push({ x, z, r: 1.9 });
    }
    // Warning sign knocked flat + scattered crates
    const sy = getHeight(32, 43);
    const sign = this._box(2.6, 1.5, 0.14, 0xe8c33a, 32, sy + 0.35, 43, 0.8, { outline: 0.05 });
    sign.rotation.x = -1.35;
    for (const [cx, cz, r] of [[22, 42, 0.5], [26, 40, 0.9], [43, 41, 0.2]]) {
      this._box(1.3, 1.3, 1.3, PALETTE.wood, cx, getHeight(cx, cz) + 0.65, cz, r, { outline: 0.04, collide: true });
    }
    // Siren generator: lure the T-rex back to the harbor once
    const gy = getHeight(50, 40);
    const gen = this._box(1.8, 1.5, 1.2, 0xc45c3a, 50, gy + 0.75, 40, 0.2, { outline: 0.05, collide: true });
    this.sirenLamp = new THREE.PointLight(0xff5533, 0, 26, 1.2);
    this.sirenLamp.position.set(50, gy + 3, 40);
    this.scene.add(this.sirenLamp);
    this.interact.add({
      object: gen, radius: 3.4, label: 'Start the harbor siren (lures the T-rex)', once: true,
      action: () => {
        this.state.flags.siren_on = true;
        this.state.notify('Siren wailing — the T-rex is heading for the harbor!');
        this.audio.hum(gen.position);
        this.sirenOn = true;
        return true;
      },
    });
  }

  /* ---------- hill path: stairs, rails, torii ---------- */
  _hillPath() {
    const stepMat = toonMat({ color: 0xc9cfc9 });
    for (let z = -42; z > -86; z -= 2.2) {
      const y = getHeight(0, z);
      const step = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 2.0), stepMat);
      step.position.set(0, y + 0.1, z);
      step.receiveShadow = true;
      this.scene.add(step);
    }
    this._rail(-2.6, -42, -2.6, -85);
    this._rail(2.6, -42, 2.6, -85);

    // Torii gate
    const t = WORLD.regions.torii;
    const ty = getHeight(t.x, t.z);
    const red = toonMat({ color: 0xd0493a });
    for (const dx of [-2.6, 2.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 5.6, 8), red);
      leg.position.set(dx, ty + 2.8, t.z);
      leg.castShadow = true;
      addOutline(leg, 0.08);
      this.scene.add(leg);
      this.colliders.cylinders.push({ x: dx, z: t.z, r: 0.5 });
    }
    const beam = this._box(7.6, 0.55, 0.7, 0xd0493a, 0, ty + 5.6, t.z, 0, { outline: 0.06 });
    beam.rotation.z = 0.0;
    this._box(6.2, 0.35, 0.5, PALETTE.ink, 0, ty + 4.7, t.z, 0, { shadow: false });
  }

  /* ---------- evacuation shelter (win) ---------- */
  _shelter() {
    const s = WORLD.regions.hilltop;
    const y = getHeight(s.x, s.z);
    // Concrete bunker with heavy door
    this._box(11, 4.6, 8, 0xb9c0bd, s.x, y + 2.3, s.z, 0, { outline: 0.02, collide: true });
    const roofL = this._box(12, 0.5, 9, 0x8e9794, s.x, y + 4.85, s.z, 0, { shadow: false });
    // Green "safe" sign
    this._box(2.6, 0.9, 0.16, 0x2fa05a, s.x, y + 4.0, s.z + 4.1, 0, { outline: 0.06 });
    // Door (south face) — needs shelter key
    const door = this._box(2.4, 3.2, 0.35, 0x51616b, s.x, y + 1.6, s.z + 4.15, 0, { outline: 0.04, collide: true });
    const doorBox = this.colliders.boxes[this.colliders.boxes.length - 1];
    this.shelter = { insidePos: new THREE.Vector3(s.x, y, s.z + 2.2), open: false };
    this.interact.add({
      object: door, radius: 4, label: 'Evacuation shelter — requires SHELTER KEY',
      action: () => {
        if (this.state.hasItem('shelter_key')) {
          door.position.x -= 2.5; // slide aside
          doorBox.makeEmpty();
          this.shelter.open = true;
          this.state.notify('Shelter unlocked — get inside!');
          this.state.setObjective('Get inside the shelter!');
          this.audio.unlock();
          return 'remove';
        }
        this.state.notify('Locked. The key is at the village office.');
        this.audio.denied();
        return true;
      },
    });
    // Beacon
    this.beacon = new THREE.PointLight(0x77ffbb, 4, 30, 1.1);
    this.beacon.position.set(s.x, y + 7, s.z);
    this.scene.add(this.beacon);
  }

  /* ---------- trees & bushes (instanced, toon) ---------- */
  _trees() {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
    trunkGeo.translate(0, 1.6, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.1, 1);
    crownGeo.scale(1, 0.85, 1);
    crownGeo.translate(0, 4.2, 0);

    const N = 70;
    const trunks = new THREE.InstancedMesh(trunkGeo, toonMat({ color: PALETTE.trunk }), N);
    const crowns = new THREE.InstancedMesh(crownGeo, toonMat({ color: PALETTE.leaf }), N);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < N && tries++ < 4000) {
      const x = (hash2(tries, 3) - 0.5) * 300;
      const z = (hash2(tries, 7) - 0.5) * 300 - 20;
      if (this._blockedForPlanting(x, z)) continue;
      const s = 0.8 + hash2(tries, 11) * 1.3;
      q.setFromAxisAngle(v.set(0, 1, 0), hash2(tries, 13) * Math.PI * 2);
      sc.setScalar(s);
      m.compose(v.set(x, getHeight(x, z) - 0.1, z), q, sc);
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      col.set(hash2(tries, 17) > 0.5 ? PALETTE.leaf : PALETTE.leafLight);
      crowns.setColorAt(placed, col);
      this.colliders.cylinders.push({ x, z, r: 0.5 * s });
      placed++;
    }
    trunks.count = crowns.count = placed;
    this.scene.add(trunks, crowns);

    // Bushes
    const bushGeo = new THREE.IcosahedronGeometry(0.9, 1);
    bushGeo.scale(1.3, 0.75, 1);
    const B = 110;
    const bushes = new THREE.InstancedMesh(bushGeo, toonMat({ color: PALETTE.leafLight }), B);
    bushes.castShadow = true;
    let bp = 0; tries = 0;
    while (bp < B && tries++ < 5000) {
      const x = (hash2(tries, 23) - 0.5) * 310;
      const z = (hash2(tries, 29) - 0.5) * 310 - 15;
      if (this._blockedForPlanting(x, z)) continue;
      const s = 0.5 + hash2(tries, 31) * 1.1;
      q.setFromAxisAngle(v.set(0, 1, 0), hash2(tries, 37) * Math.PI * 2);
      m.compose(v.set(x, getHeight(x, z) + 0.25 * s, z), q, sc.setScalar(s));
      bushes.setMatrixAt(bp, m);
      col.set(hash2(tries, 41) > 0.5 ? PALETTE.leafLight : PALETTE.leaf);
      bushes.setColorAt(bp, col);
      bp++;
    }
    bushes.count = bp;
    this.scene.add(bushes);
  }

  _blockedForPlanting(x, z) {
    const h = getHeight(x, z);
    if (h < 1.5 || h > 26) return false || h < 1.5 || h > 26; // beach/sea & extreme rims out
    if (onRoad(x, z)) return true;
    if (Math.abs(x) < 5 && z < -35) return true;                  // hill stairs
    // House rows
    if (Math.abs(z - 34) < 7 && Math.abs(x) < 55) return true;
    if (Math.abs(z - 13.5) < 6 && Math.abs(x) < 50) return true;
    if (Math.abs(z + 31.5) < 7 && Math.abs(x) < 50) return true;
    if (Math.abs(z + 7.5) < 5 && Math.abs(x) < 40) return true;
    const s = WORLD.regions.hilltop;
    if ((x - s.x) ** 2 + (z - s.z) ** 2 < 12 * 12) return true;   // shelter pad
    if (z > 40) return true;                                      // beach
    return false;
  }

  /* ---------- props: vending machine, cones, planters ---------- */
  _props() {
    // Vending machine (glows, heals)
    const v = WORLD.regions.vending;
    const vy = getHeight(v.x, v.z);
    const vend = this._box(1.3, 2.2, 1, 0xd0403a, v.x, vy + 1.1, v.z, -0.3, { outline: 0.04, collide: true });
    const glow = this._box(0.9, 1.2, 0.08, 0xfff2cc, v.x - 0.03, vy + 1.35, v.z + 0.5, -0.3, { shadow: false });
    glow.material = toonMat({ color: 0xfff2cc, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
    this.interact.add({
      object: vend, radius: 2.8, label: 'Grab a drink (+35 health)', once: true,
      action: () => { this.state.heal(35); this.state.notify('You feel better (+35)'); this.audio.pickup(); return true; },
    });

    // Traffic cones + planters along streets
    const coneMat = toonMat({ color: 0xe8763a });
    for (const [x, z] of [[6, 21], [-12, 28], [22, -17], [-6, -23], [36, 22], [3, 44]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 8), coneMat);
      cone.position.set(x, getHeight(x, z) + 0.4, z);
      cone.castShadow = true;
      addOutline(cone, 0.07);
      this.scene.add(cone);
    }
    const potMat = toonMat({ color: 0xb98a68 });
    for (const [x, z] of [[-8, 29.5], [10, 29.5], [-28, -24.5], [26, -24.5], [-50, 29.5]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.6, 8), potMat);
      pot.position.set(x, getHeight(x, z) + 0.3, z);
      addOutline(pot, 0.06);
      this.scene.add(pot);
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), toonMat({ color: PALETTE.leaf }));
      plant.position.set(x, getHeight(x, z) + 0.85, z);
      this.scene.add(plant);
    }
  }

  update(dt) {
    this.time += dt;
    this.seaUniforms.uTime.value = this.time;
    if (this.sirenOn) this.sirenLamp.intensity = 8 + Math.sin(this.time * 9) * 7;
    if (this.beacon) this.beacon.intensity = 3.4 + Math.sin(this.time * 2.4) * 1.4;
  }
}
