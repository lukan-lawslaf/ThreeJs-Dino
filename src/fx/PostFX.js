import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Post-processing chain: Render → SAO (ambient occlusion) → Bloom → Output
 * (tone mapping + sRGB). Passes are toggled live from Settings.
 */
export class PostFX {
  constructor(renderer, scene, camera, settings) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.sao = new SAOPass(scene, camera);
    this.sao.params.saoIntensity = 0.012;
    this.sao.params.saoScale = 60;
    this.sao.params.saoKernelRadius = 24;
    this.sao.params.saoBlur = true;
    this.sao.enabled = settings.ssao && settings.preset.ssao;
    this.composer.addPass(this.sao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.7, 0.85);
    this.bloom.enabled = settings.bloom && settings.preset.bloom;
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    settings.onChange((k, v) => {
      if (k === 'bloom') this.bloom.enabled = v;
      if (k === 'ssao') this.sao.enabled = v;
    });
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
