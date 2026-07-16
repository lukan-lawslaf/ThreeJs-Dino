import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Settings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { AudioManager } from './core/AudioManager.js';
import { getHeight, WORLD } from './core/heightmap.js';
import { Sky } from './world/Sky.js';
import { Village } from './world/Village.js';
import { SetDressing } from './world/SetDressing.js';
import { Dinosaur } from './dinos/Dinosaur.js';
import { ThirdPerson } from './player/ThirdPerson.js';
import { Interact } from './game/Interact.js';
import { GameState } from './game/GameState.js';
import { PostFX } from './fx/PostFX.js';
import { HUD } from './ui/HUD.js';

/**
 * KOMORI VILLAGE — Dino Breakout. Main orchestrator.
 *
 * A compact seaside village, cel-shaded like a hand-drawn anime.
 * Dinosaurs broke through the harbor fence; get the shelter key from the
 * village office and escape to the hilltop evacuation shelter.
 * Third-person controls, tension-tuned T-rex chase, optional siren lure.
 */

const DEBUG = new URLSearchParams(location.search).has('debug');

class Game {
  async boot() {
    const canvas = document.getElementById('game');
    this.settings = new Settings();
    const preset = this.settings.preset;

    // ---------- Renderer: flat, punchy colors (no filmic curve) ----------
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(preset.pixelRatio, devicePixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xcfe8e2, 0.0038); // gentle pastel haze
    if (DEBUG) window.game = this;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov * 0.75, innerWidth / innerHeight, 0.1, 800);
    this.scene.add(this.camera);
    this.settings.onChange(k => {
      if (k === 'fov') { this.camera.fov = this.settings.fov * 0.75; this.camera.updateProjectionMatrix(); }
    });

    const load = (pct, msg) => new Promise(r => {
      document.querySelector('#loadbar > div').style.width = pct + '%';
      document.getElementById('loadmsg').textContent = msg;
      requestAnimationFrame(() => requestAnimationFrame(r));
    });

    await load(10, 'Painting the sky…');
    this.sky = new Sky(this.scene);
    this.sky.setShadowRes(preset.shadow);
    // Tighter shadow frustum for the small map = crisp toon shadows
    const S = 90;
    Object.assign(this.sky.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.sky.sun.shadow.camera.updateProjectionMatrix();

    await load(35, 'Building the village…');
    this.input = new Input(canvas);
    this.audio = new AudioManager(this.camera, this.settings);
    this.hud = new HUD();
    this.state = new GameState();
    this.interact = new Interact(this.camera);
    this.village = new Village(this.scene, this.interact, this.state, this.audio);
    this.dressing = new SetDressing(this.scene, this.interact, this.state, this.audio);

    await load(65, 'Something stirs at the harbor…');
    this._wireState();
    this.player = new ThirdPerson(this.scene, this.camera, this.input, this.audio,
      this.village.colliders, WORLD.regions.spawn);
    this.interact.origin = this.player.position;
    this._spawnDinos();

    await load(85, 'Inking outlines…');
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.settings);

    if (DEBUG) {
      this.orbit = new OrbitControls(this.camera, canvas);
      this.orbit.target.set(0, 3, 0);
      this.camera.position.set(60, 70, 90);
      this.player.controlCamera = false;
    }

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.postfx.setSize(innerWidth, innerHeight);
    });

    await load(100, 'Welcome to Komori Village');
    this._menu();
    this.clock = new THREE.Clock();
    this.playing = false;
    this.renderer.setAnimationLoop(() => this._frame());
  }

  /* ================== Wiring ================== */

  _wireState() {
    this.state.onNotify = msg => this.hud.notify(msg);
    this.state.onObjective = text => this.hud.setObjective(text);
    this.state.healFn = n => { this.player.health = Math.min(100, this.player.health + n); };
    this.state.getPlayerState = () => ({
      position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
      yaw: this.player.yaw,
    });
    this.state.onWin = () => {
      this.playing = false;
      this.input.enabled = false;
      this.input.unlock();
      document.getElementById('win').classList.remove('hidden');
    };
  }

  _spawnDinos() {
    const R = WORLD.regions;
    const at = (x, z) => new THREE.Vector3(x, getHeight(x, z), z);
    const ctx = {
      scene: this.scene,
      audio: this.audio,
      onAttackPlayer: (dmg, species) => {
        this.player.damage(dmg, species);
        if (!this.player.alive) this._die(species);
      },
      onThump: k => { this.player.shake = Math.min(1, this.player.shake + k * 0.5); },
    };
    this.dinos = [];
    // The escaped T-rex prowls the village center (Sketchfab GMod rig)
    this.trex = new Dinosaur('trex', at(R.plaza.x - 10, R.plaza.z - 6), ctx);
    this.dinos.push(this.trex);
    // Raptors lurk near the broken fence / back alleys
    this.dinos.push(new Dinosaur('velociraptor', at(40, 30), ctx));
    this.dinos.push(new Dinosaur('velociraptor', at(-40, -14), ctx));
    this.dinos.push(new Dinosaur('utahraptor', at(48, 42), ctx));
    // Calm herbivores: a stegosaurus grazing the west meadow,
    // a brachiosaurus towering by the eastern rim
    this.dinos.push(new Dinosaur('stegosaurus', at(-70, -40), ctx));
    this.dinos.push(new Dinosaur('brachiosaurus', at(85, -50), ctx));
    // Spawn grace: predators ignore the player for the opening seconds so
    // the intro crane shot can't end in an instant mauling.
    for (const d of this.dinos) d.distractTimer = 14;
  }

  _die(species) {
    this.playing = false;
    this.input.enabled = false;
    this.input.unlock();
    const names = {
      trex: 'The Tyrannosaurus caught you in the open street.',
      velociraptor: 'Clever girl. A raptor cut you off in the alley.',
      utahraptor: 'The utahraptor was faster than it looked.',
    };
    document.getElementById('deathCause').textContent = names[species] || 'The dinosaurs got you.';
    document.getElementById('death').classList.remove('hidden');
  }

  /* ================== Menus ================== */

  _menu() {
    const $ = id => document.getElementById(id);
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('btnContinue').disabled = !GameState.hasSave();

    const startGame = (fresh) => {
      $('menu').classList.add('hidden');
      if (fresh) {
        GameState.clear();
        this.state.setObjective('Dinosaurs broke through the harbor fence! Find the shelter key at the VILLAGE OFFICE (teal sign, south street).');
        this._intro = DEBUG ? 0 : 5;
        this.hud.cinema(!DEBUG);
      } else {
        const data = this.state.load();
        if (data?.player?.position) {
          const p = data.player.position;
          this.player.respawn(p);
          this.player.yaw = data.player.yaw ?? Math.PI;
        }
        this._intro = 0;
      }
      this.audio.start();
      this.hud.show();
      this.hud.setObjective(this.state.objective);
      this.playing = true;
      this.input.enabled = true;
      if (!DEBUG) this.input.lock();
    };

    $('btnNew').onclick = () => startGame(true);
    $('btnContinue').onclick = () => startGame(false);
    $('btnSettings').onclick = () => this._settingsMenu($('menu'));
    $('btnPauseSettings').onclick = () => this._settingsMenu($('pause'));

    $('btnResume').onclick = () => { $('pause').classList.add('hidden'); this.playing = true; this.input.enabled = true; this.input.lock(); };
    $('btnQuit').onclick = () => location.reload();
    $('btnRespawn').onclick = () => {
      $('death').classList.add('hidden');
      const cp = this.state.checkpointPos || WORLD.regions.spawn;
      this.player.respawn(cp);
      this.playing = true; this.input.enabled = true; this.input.lock();
    };
    $('btnWinMenu').onclick = () => location.reload();

    this.input.onLockChange = locked => {
      if (!locked && this.playing && !DEBUG) {
        this.playing = false;
        this.input.enabled = false;
        this.hud.closeInventory();
        $('pause').classList.remove('hidden');
      }
    };
  }

  _settingsMenu(returnTo) {
    const $ = id => document.getElementById(id);
    returnTo.classList.add('hidden');
    $('settings').classList.remove('hidden');
    const s = this.settings;
    $('setQuality').value = s.quality;
    $('setBloom').checked = s.bloom;
    $('setSSAO').checked = s.ssao;
    $('setFov').value = s.fov;
    $('setVolume').value = s.volume;
    $('setMusic').value = s.music;
    $('setQuality').onchange = e => s.set('quality', e.target.value);
    $('setBloom').onchange = e => s.set('bloom', e.target.checked);
    $('setSSAO').onchange = e => s.set('ssao', e.target.checked);
    $('setFov').oninput = e => s.set('fov', +e.target.value);
    $('setVolume').oninput = e => s.set('volume', +e.target.value);
    $('setMusic').oninput = e => s.set('music', +e.target.value);
    $('btnSettingsBack').onclick = () => {
      $('settings').classList.add('hidden');
      returnTo.classList.remove('hidden');
    };
  }

  /* ================== Frame loop ================== */

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this.playing) {
      // Intro: crane down from above the harbor to the character
      if (this._intro > 0) {
        this._intro -= dt;
        const k = Math.max(0, this._intro / 5), e = k * k;
        this.player.update(0);
        const p = this.player.position;
        this.camera.position.set(p.x + e * 30, p.y + 2 + e * 55, p.z + 8 + e * 60);
        this.camera.lookAt(p.x, p.y + 6 + e * 10, p.z - 20);
        if (this._intro <= 0) this.hud.cinema(false);
      } else if (!DEBUG) {
        this.player.update(dt);
      } else {
        this.player.controlCamera = false;
        this.player.update(dt);
      }

      // Hotkeys
      if (this.input.consume('KeyF')) this.player.toggleTorch();
      if (this.input.consume('KeyE')) this.interact.use();
      if (this.input.consume('Tab')) this.hud.toggleInventory(this.state.inventory);

      const target = this.interact.update();
      this.hud.setPrompt(target?.label);

      // Siren lure: pull the T-rex to the harbor for 25 s
      if (this.state.flags.siren_on && !this._sirenDone) {
        this._sirenDone = true;
        this.trex.distract(new THREE.Vector3(WORLD.regions.harbor.x, 0, WORLD.regions.harbor.z), 25);
      }

      // Dinosaurs + danger heartbeat
      let danger = 0;
      for (const d of this.dinos) {
        const dist = d.group.position.distanceTo(this.player.position);
        d.update(dt, this.player, dist);
        if (d.b.diet === 'carnivore' && ['chase', 'attack'].includes(d.state)) {
          danger = Math.max(danger, 1 - dist / 40);
        }
      }
      this.audio.heartbeat(danger);

      // Win: step inside the open shelter
      const sh = this.village.shelter;
      if (sh.open && this.player.position.distanceTo(sh.insidePos) < 2.4) {
        this.state.win();
      }

      // First checkpoint the moment you grab the key is handled by GameState;
      // also checkpoint on reaching the torii gate
      if (!this._toriiCP && this.player.position.z < WORLD.regions.torii.z + 2) {
        this._toriiCP = true;
        this.state.checkpoint();
        this.state.notify('Checkpoint — the hill path');
      }

      this.hud.update(this.player);
    }

    const focus = DEBUG && this.orbit ? this.orbit.target : this.player?.position || new THREE.Vector3();
    this.sky.update(dt, focus, 0);
    this.village.update(dt);
    this.dressing.update(dt);

    if (DEBUG && this.orbit) this.orbit.update();
    this.input.endFrame();
    this.postfx.render(dt);
  }
}

new Game().boot().catch(err => {
  console.error(err);
  document.getElementById('loadmsg').textContent = 'Failed to start: ' + err.message;
});
