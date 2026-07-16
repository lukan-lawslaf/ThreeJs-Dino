import * as THREE from 'three';

/**
 * Fully procedural audio engine (WebAudio) — no external files needed,
 * so the game is playable offline / without asset downloads.
 *
 * Provides: jungle ambience, wind, rain, thunder, river water, footsteps
 * per surface, dinosaur roars (positional), generator hum, fence buzz,
 * heartbeat, UI blips and a slow synth music pad.
 */
export class AudioManager {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;

    this.master = this.ctx.createGain();
    this.master.gain.value = settings.volume;
    this.master.connect(this.listener.getInput());

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = settings.music * 0.5;
    this.musicBus.connect(this.master);

    this.started = false;
    settings.onChange((k, v) => {
      if (k === 'volume') this.master.gain.value = v;
      if (k === 'music') this.musicBus.gain.value = v * 0.5;
    });
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    this.started = true;
    this.ctx.resume();
    this._noiseBuf = this._makeNoiseBuffer();
    this._startAmbience();
    this._startMusic();
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(gainNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    src.connect(gainNode); src.start();
    return src;
  }

  /* ---------------- Ambient beds ---------------- */

  _startAmbience() {
    const ctx = this.ctx;

    // Wind: filtered noise, slowly modulated
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 300; windFilter.Q.value = 0.6;
    this.windGain.connect(windFilter); windFilter.connect(this.master);
    this._noiseSource(this.windGain);
    const windLFO = ctx.createOscillator(); windLFO.frequency.value = 0.07;
    const windLFOGain = ctx.createGain(); windLFOGain.gain.value = 150;
    windLFO.connect(windLFOGain); windLFOGain.connect(windFilter.frequency); windLFO.start();

    // Rain bed (starts silent, weather system drives it)
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass'; rainFilter.frequency.value = 1200;
    this.rainGain.connect(rainFilter); rainFilter.connect(this.master);
    this._noiseSource(this.rainGain);

    // Jungle: schedule random bird / insect chirps
    this._scheduleJungle();
  }

  _scheduleJungle() {
    if (!this.started) return;
    const delay = 0.8 + Math.random() * 3.5;
    setTimeout(() => {
      if (Math.random() < 0.55) this._chirp();
      else this._insect();
      this._scheduleJungle();
    }, delay * 1000);
  }

  _chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f = 1400 + Math.random() * 2600;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    const hops = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < hops; i++) {
      o.frequency.exponentialRampToValueAtTime(f * (0.8 + Math.random() * 0.5), t + 0.06 * (i + 1));
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025 + Math.random() * 0.02, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 * hops + 0.1);
    // Random stereo placement
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    o.connect(g); g.connect(pan); pan.connect(this.master);
    o.start(t); o.stop(t + 0.8);
  }

  _insect() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 4000 + Math.random() * 2000;
    const am = ctx.createOscillator(); am.frequency.value = 25 + Math.random() * 30;
    const amG = ctx.createGain(); amG.gain.value = 0.008;
    g.gain.value = 0;
    am.connect(amG); amG.connect(g.gain);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    o.connect(g); g.connect(pan); pan.connect(this.master);
    o.start(t); am.start(t);
    const dur = 1 + Math.random() * 2;
    o.stop(t + dur); am.stop(t + dur);
  }

  /* ---------------- Music: slow evolving pad ---------------- */

  _startMusic() {
    const ctx = this.ctx;
    // Minor-key chord progression, very slow, cinematic
    const chords = [
      [110.00, 130.81, 164.81], // Am
      [87.31, 110.00, 130.81],  // F
      [98.00, 123.47, 146.83],  // G
      [82.41, 103.83, 123.47],  // Em
    ];
    let step = 0;
    const playChord = () => {
      if (!this.started) return;
      const t = ctx.currentTime;
      for (const f of chords[step % chords.length]) {
        for (const det of [-2, 2]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det * 3;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.012, t + 4);
          g.gain.linearRampToValueAtTime(0, t + 11.5);
          o.connect(lp); lp.connect(g); g.connect(this.musicBus);
          o.start(t); o.stop(t + 12);
        }
      }
      step++;
      setTimeout(playChord, 11000);
    };
    playChord();
  }

  /* ---------------- Weather hooks ---------------- */

  setRain(intensity) { // 0..1
    if (!this.started) return;
    this.rainGain.gain.linearRampToValueAtTime(intensity * 0.14, this.ctx.currentTime + 2);
    this.windGain.gain.linearRampToValueAtTime(0.05 + intensity * 0.06, this.ctx.currentTime + 2);
  }

  thunder() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 1.5;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 + Math.random() * 2);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 6);
  }

  /* ---------------- SFX ---------------- */

  footstep(surface, running) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    const cfg = {
      grass: { type: 'lowpass', freq: 900,  vol: 0.06, dur: 0.09 },
      mud:   { type: 'lowpass', freq: 350,  vol: 0.09, dur: 0.16 },
      sand:  { type: 'lowpass', freq: 650,  vol: 0.05, dur: 0.12 },
      rock:  { type: 'highpass', freq: 500, vol: 0.07, dur: 0.06 },
      metal: { type: 'bandpass', freq: 1200, vol: 0.09, dur: 0.08 },
    }[surface] || { type: 'lowpass', freq: 800, vol: 0.06, dur: 0.1 };
    f.type = cfg.type; f.frequency.value = cfg.freq * (0.9 + Math.random() * 0.2);
    const vol = cfg.vol * (running ? 1.5 : 1);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + cfg.dur + 0.05);
  }

  /** Big layered roar, positional. Returns quickly; sound plays async. */
  roar(position, size = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._positional(position, 30 + 60 * size);

    // Layer 1: low growl (detuned saws through lowpass)
    for (const det of [0, 7, -5]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      const base = (55 - size * 18) * (1 + det / 100);
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 1.6, t + 0.5);
      o.frequency.linearRampToValueAtTime(base * 0.7, t + 1.8);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.linearRampToValueAtTime(1200, t + 0.4);
      lp.frequency.linearRampToValueAtTime(200, t + 2);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(t); o.stop(t + 2.5);
    }
    // Layer 2: breath noise
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.8;
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.25, t + 0.2);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.connect(nf); nf.connect(ng); ng.connect(out);
    src.start(t); src.stop(t + 2);
  }

  /** Small positional utility: pans/attenuates by camera-relative offset. */
  _positional(position, radius) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const cam = this.camera;
    const local = position.clone().applyMatrix4(cam.matrixWorldInverse);
    const dist = local.length();
    g.gain.value = Math.min(1, radius / Math.max(radius * 0.2, dist));
    pan.pan.value = Math.max(-1, Math.min(1, local.x / (Math.abs(local.z) + 8)));
    g.connect(pan); pan.connect(this.master);
    return g;
  }

  hum(position) { // generator hum — returns stop()
    if (!this.started) return () => {};
    const ctx = this.ctx;
    const out = this._positional(position, 18);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 52;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 104;
    const g = ctx.createGain(); g.gain.value = 0.12;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
    o.start(); o2.start();
    return () => { o.stop(); o2.stop(); };
  }

  zap() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.3);
  }

  pickup() { this._blip(880, 1320); }
  unlock() { this._blip(440, 660); }
  denied() { this._blip(220, 180); }

  _blip(f1, f2) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f1, t);
    o.frequency.linearRampToValueAtTime(f2, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  heartbeat(rate) { // rate 0..1 danger level
    if (!this.started || rate <= 0.01) return;
    const now = performance.now();
    const interval = 1100 - rate * 600;
    if (now - (this._lastBeat || 0) < interval) return;
    this._lastBeat = now;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, vol] of [[0, 0.14], [0.18, 0.09]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(55, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.1);
      g.gain.setValueAtTime(vol * rate, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.14);
      o.connect(g); g.connect(this.master);
      o.start(t + dt); o.stop(t + dt + 0.2);
    }
  }
}
