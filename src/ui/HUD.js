/**
 * HUD binding layer — pure DOM, no Three.js.
 * Health/stamina bars, compass strip, objective banner, interaction
 * prompt, notifications, inventory panel, damage vignette.
 */
export class HUD {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.hud = this.$('hud');
    this.healthEl = document.querySelector('#healthbar > div');
    this.staminaEl = document.querySelector('#staminabar > div');
    this.prompt = this.$('prompt');
    this.objText = this.$('objectiveText');
    this.notices = this.$('notices');
    this.damageEl = this.$('damage');
    this.compass = this.$('compass');
    this.invPanel = this.$('inventory');
    this.invList = this.$('invlist');
    this._buildCompass();
    this._lastHealth = 100;
  }

  _buildCompass() {
    // Repeating cardinal strip: 3 copies for wraparound scrolling
    const seq = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];
    let html = '';
    for (let r = 0; r < 3; r++)
      for (const s of seq) html += `<span class="${s === '·' ? 'min' : ''}">${s}</span>`;
    this.compass.innerHTML = html;
    this.segW = 60; this.seqLen = seq.length;
  }

  show() { this.hud.classList.remove('hidden'); }
  hide() { this.hud.classList.add('hidden'); }
  cinema(on) { this.hud.classList.toggle('cinema', on); }

  update(player) {
    this.healthEl.style.transform = `scaleX(${player.health / 100})`;
    this.staminaEl.style.transform = `scaleX(${player.stamina / 100})`;

    // Damage flash on health drop
    if (player.health < this._lastHealth - 0.5) {
      this.damageEl.style.opacity = 0.85;
      clearTimeout(this._dmgT);
      this._dmgT = setTimeout(() => this.damageEl.style.opacity = 0, 300);
    }
    // Low-health persistent vignette
    if (player.health < 30) this.damageEl.style.opacity = 0.35 * (1 - player.health / 30);
    this._lastHealth = player.health;

    // Compass: yaw → strip offset (yaw 0 = north = -Z)
    const stripLen = this.segW * this.seqLen;
    let frac = (-player.yaw / (Math.PI * 2)) % 1; if (frac < 0) frac += 1;
    const x = -stripLen - frac * stripLen + 170 - this.segW / 2;
    this.compass.style.transform = `translateX(${x}px)`;
  }

  setPrompt(text) {
    if (text) {
      this.prompt.innerHTML = `<b>E</b> — ${text}`;
      this.prompt.style.opacity = 1;
    } else this.prompt.style.opacity = 0;
  }

  setObjective(text) {
    this.objText.textContent = text;
    const el = this.$('objective');
    el.style.opacity = 0;
    setTimeout(() => el.style.opacity = 1, 400);
  }

  notify(msg) {
    const div = document.createElement('div');
    div.className = 'notice';
    div.textContent = msg;
    this.notices.appendChild(div);
    setTimeout(() => div.remove(), 5200);
  }

  toggleInventory(items) {
    const open = this.invPanel.classList.toggle('hidden');
    if (!open) { // just opened
      this.invList.innerHTML = items.length
        ? items.map(i => `<li>▸ ${i.name}<span class="desc">${i.desc}</span></li>`).join('')
        : '<li class="empty">Nothing but jungle air…</li>';
    }
    return !open;
  }
  closeInventory() { this.invPanel.classList.add('hidden'); }
}
