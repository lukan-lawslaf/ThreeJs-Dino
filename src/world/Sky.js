import * as THREE from 'three';

/**
 * Dynamic sky: gradient dome with drifting procedural clouds,
 * sun disc + god-ray friendly haze, driven by a day-night cycle.
 */
export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.sunAngle = 0.32; // late-morning start (0..1 of the day)

    // --- Sky dome with custom gradient + clouds shader ---
    this.uniforms = {
      uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
      uTime:     { value: 0 },
      uStorm:    { value: 0 }, // 0 clear → 1 heavy storm
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = (projectionMatrix * p).xyww; // depth = far
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 uSunDir;
        uniform float uTime, uStorm;

        // Cheap 2D value noise for cloud shapes
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          float s = 0.0, a = 0.5;
          for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; }
          return s;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float sunH = clamp(uSunDir.y, -0.2, 1.0);

          // Anime gradient: pale warm horizon → saturated cyan zenith
          vec3 zenith  = mix(vec3(0.22,0.58,0.76), vec3(0.05,0.1,0.2), 1.0-sunH);
          vec3 horizon = mix(vec3(0.88,0.95,0.93), vec3(0.95,0.62,0.4), pow(1.0-sunH, 1.6));
          zenith  = mix(zenith,  vec3(0.16,0.17,0.2), uStorm*0.8);
          horizon = mix(horizon, vec3(0.35,0.37,0.38), uStorm*0.8);
          float t = pow(max(dir.y, 0.0), 0.55);
          vec3 col = mix(horizon, zenith, t);

          // Sun disc + glow
          float sunDot = max(dot(dir, uSunDir), 0.0);
          col += vec3(1.0,0.85,0.6) * pow(sunDot, 900.0) * 8.0 * (1.0-uStorm*0.9);
          col += vec3(1.0,0.7,0.4)  * pow(sunDot, 6.0)   * 0.28 * (1.0-uStorm*0.7);

          // Clouds: two drifting fbm layers on dome projection
          if (dir.y > 0.02) {
            vec2 uv = dir.xz / (dir.y + 0.18);
            float c1 = fbm(uv*1.4 + vec2(uTime*0.008, uTime*0.002));
            float c2 = fbm(uv*3.4 - vec2(uTime*0.015, 0.0));
            float cover = mix(0.56, 0.3, uStorm);
            // Hard-edged, flat painterly clouds (anime style)
            float cloud = smoothstep(cover, cover+0.09, c1*0.72 + c2*0.38);
            float shade = mix(1.0, 0.82, smoothstep(0.5,0.8,fbm(uv*2.0+4.0)));
            vec3 cloudCol = mix(vec3(1.0), vec3(0.9,0.75,0.65), pow(1.0-sunH,1.5));
            cloudCol = mix(cloudCol, vec3(0.28,0.3,0.34), uStorm*0.85);
            // Silver lining toward sun
            cloudCol += vec3(0.5,0.4,0.25) * pow(sunDot, 3.0) * 0.4 * (1.0-uStorm);
            float fade = smoothstep(0.02, 0.18, dir.y); // fade at horizon
            col = mix(col, cloudCol*shade, cloud * fade * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // --- Lights ---
    this.sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 700;
    const S = 180;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd8e8, 0x2e3b24, 0.55);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x30402e, 0.35);
    scene.add(this.ambient);
  }

  setShadowRes(size) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /**
   * @param dt seconds  @param focus player position (shadow frustum follows)
   * @param storm 0..1
   */
  update(dt, focus, storm) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uStorm.value += (storm - this.uniforms.uStorm.value) * dt * 0.3;

    // Very slow sun drift for living light (full cycle would be ~40 min)
    this.sunAngle += dt / 2400;
    const a = this.sunAngle * Math.PI * 2;
    const elev = 0.45 + Math.sin(a) * 0.35;             // keep daytime-ish
    const azim = a * 0.5 + 0.8;
    const dir = new THREE.Vector3(
      Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev)
    ).normalize();

    this.uniforms.uSunDir.value.copy(dir);
    this.sun.position.copy(focus).addScaledVector(dir, 400);
    this.sun.target.position.copy(focus);

    const s = this.uniforms.uStorm.value;
    this.sun.intensity = (2.6 + dir.y * 1.2) * (1 - s * 0.75);
    this.sun.color.setHSL(0.09, 0.5, 0.72 + dir.y * 0.2);
    this.hemi.intensity = 0.55 * (1 - s * 0.5);
    this.ambient.intensity = 0.35 + s * 0.15;
    this.mesh.position.copy(focus);
    return dir;
  }
}
