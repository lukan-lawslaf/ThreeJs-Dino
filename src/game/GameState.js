/**
 * GameState: inventory, objectives, power-grid flags, notifications,
 * checkpoints (localStorage) and win/lose hooks. UI-agnostic — the HUD
 * subscribes via callbacks.
 */
const SAVE_KEY = 'islanublar.save.v1';

export class GameState {
  constructor() {
    this.inventory = [];   // {id, name, desc}
    this.flags = {};       // power_visitor, power_lab, power_paddock, brightLight…
    this.objective = 'Head inland and find the Visitor Center.';
    this.onNotify = () => {};
    this.onObjective = () => {};
    this.onWin = () => {};
    this.healFn = () => {};
    this.getPlayerState = () => ({});
    this.checkpointPos = null;
  }

  notify(msg) { this.onNotify(msg); }

  setObjective(text) {
    this.objective = text;
    this.onObjective(text);
    this.checkpoint();
  }

  addItem(id, name, desc = '') {
    if (this.hasItem(id)) return;
    this.inventory.push({ id, name, desc });
    this.checkpoint();
  }
  hasItem(id) { return this.inventory.some(i => i.id === id); }

  heal(n) { this.healFn(n); }
  win() { this.onWin(); localStorage.removeItem(SAVE_KEY); }

  /* ---------- Persistence ---------- */
  checkpoint() {
    const p = this.getPlayerState();
    const data = {
      inventory: this.inventory,
      flags: this.flags,
      objective: this.objective,
      player: p,
      time: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    this.checkpointPos = p.position;
  }

  static hasSave() { return !!localStorage.getItem(SAVE_KEY); }

  load() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return null;
      this.inventory = data.inventory || [];
      this.flags = data.flags || {};
      this.objective = data.objective;
      this.onObjective(this.objective);
      if (data.player?.position) this.checkpointPos = data.player.position;
      return data;
    } catch { return null; }
  }
  static clear() { localStorage.removeItem(SAVE_KEY); }
}
