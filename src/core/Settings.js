/**
 * Persistent user settings + quality presets.
 * Presets drive vegetation density, shadow resolution, pixel ratio and FX.
 */
const KEY = 'islanublar.settings.v1';

export const PRESETS = {
  low:    { pixelRatio: 0.75, shadow: 1024, shadows: true,  trees: 800,  grass: 20000, ferns: 2000, bloom: false, ssao: false, far: 900  },
  medium: { pixelRatio: 1.0,  shadow: 2048, shadows: true,  trees: 1400, grass: 40000, ferns: 4000, bloom: true,  ssao: false, far: 1200 },
  high:   { pixelRatio: 1.0,  shadow: 2048, shadows: true,  trees: 2000, grass: 60000, ferns: 6000, bloom: true,  ssao: true,  far: 1500 },
  ultra:  { pixelRatio: Math.min(devicePixelRatio, 2), shadow: 4096, shadows: true, trees: 2800, grass: 100000, ferns: 9000, bloom: true, ssao: true, far: 1800 },
};

export class Settings {
  constructor() {
    Object.assign(this, {
      quality: 'high', bloom: true, ssao: true,
      fov: 75, volume: 0.8, music: 0.5,
    });
    try { Object.assign(this, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
    this.listeners = new Set();
  }
  get preset() { return PRESETS[this.quality] || PRESETS.high; }
  set(key, value) {
    this[key] = value;
    localStorage.setItem(KEY, JSON.stringify({
      quality: this.quality, bloom: this.bloom, ssao: this.ssao,
      fov: this.fov, volume: this.volume, music: this.music,
    }));
    this.listeners.forEach(fn => fn(key, value));
  }
  onChange(fn) { this.listeners.add(fn); }
}
