/**
 * Keyboard + mouse input with pointer-lock handling.
 * Actions are queried per-frame; one-shot presses use consume().
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();      // cleared each frame after consumption window
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.enabled = false;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }
  lock() {
    if (this.locked) return;
    try {
      // Chrome returns a Promise (and supports raw input); Firefox returns undefined
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      p?.catch?.(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  down(code)    { return this.enabled && this.keys.has(code); }
  /** True once per physical key press. */
  consume(code) {
    if (this.enabled && this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }
  /** Mouse delta since last call. */
  takeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
  endFrame() { this.pressed.clear(); }
}
