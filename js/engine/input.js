// Ввод: клавиатура, мышь, колесо + реестр клавиш с проверкой конфликтов.
// Модули НЕ слушают keydown сами: они регистрируют действие и опрашивают его:
//   game.input.registerKey('build:menu', 'KeyB', 'build', { label: 'input.build_menu' })
//   if (game.input.pressed('build:menu')) ...
// Клавиши — KeyboardEvent.code ('KeyE', 'Space', 'F1', 'Digit1', 'Equal'), можно с модификатором 'Shift+F5',
// кнопки мыши — 'Mouse0' (ЛКМ), 'Mouse1' (СКМ), 'Mouse2' (ПКМ). Без DOM (headless) работает как виртуальный ввод.

const PREVENT = new Set(['Tab', 'Space', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

function parseKey(k) {
  const parts = k.split('+');
  const code = parts.pop();
  const mods = { shift: parts.includes('Shift'), ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt') };
  return { code, mods, hasMods: parts.length > 0 };
}

export class Input {
  constructor(game) {
    this.game = game;
    /** action → {action, keys: string[], defaultKeys, owner, label, allowShared} */
    this.bindings = new Map();
    this.conflicts = [];
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.consumed = new Set();
    this.mods = { shift: false, ctrl: false, alt: false };
    this.mouse = { sx: 0, sy: 0, wx: 0, wy: 0, tx: 0, ty: 0, inside: false, wheel: 0, moved: false };
    this.attached = false;
    this.lastInputTime = 0;
    /** Текст, введённый в этом кадре (для полей ввода UI). */
    this.typed = '';
  }

  // ---------- Реестр клавиш ----------
  /**
   * Зарегистрировать действие.
   * @param {string} action — 'модуль:действие'
   * @param {string|string[]} defaultKey
   * @param {string} owner — модуль
   * @param {{label?: string, allowShared?: boolean}} [opts] — allowShared: сознательно делим клавишу (контекстно)
   * @returns {object} binding
   */
  registerKey(action, defaultKey, owner = 'core', opts = {}) {
    if (this.bindings.has(action)) {
      const b = this.bindings.get(action);
      if (b.owner !== owner) console.warn(`[input] действие ${action} уже зарегистрировано модулем ${b.owner}`);
      return b;
    }
    const defaults = Array.isArray(defaultKey) ? defaultKey : [defaultKey];
    const custom = this.game.settings?.get('keybinds')?.[action];
    const keys = custom ? (Array.isArray(custom) ? custom : [custom]) : defaults.slice();
    const b = { action, keys, defaultKeys: defaults, owner, label: opts.label || action, allowShared: !!opts.allowShared };
    for (const k of keys) {
      for (const other of this.bindings.values()) {
        if (other.keys.includes(k) && !(b.allowShared && other.allowShared)) {
          const c = { key: k, a: other.action, b: action, owners: [other.owner, owner] };
          this.conflicts.push(c);
          console.warn(`[input] конфликт клавиши ${k}: ${other.action} (${other.owner}) и ${action} (${owner})`);
        }
      }
    }
    this.bindings.set(action, b);
    return b;
  }

  /** Переназначить (UI настроек). Сохраняется в settings.keybinds. */
  rebind(action, keys) {
    const b = this.bindings.get(action);
    if (!b) return false;
    b.keys = Array.isArray(keys) ? keys : [keys];
    const kb = { ...(this.game.settings.get('keybinds') || {}) };
    kb[action] = b.keys;
    this.game.settings.set('keybinds', kb);
    return true;
  }

  keyOf(action) {
    return this.bindings.get(action)?.keys[0] || '';
  }

  /** Человекочитаемое имя клавиши: 'KeyE' → 'E'. */
  static keyLabel(k) {
    if (!k) return '';
    return k.replace(/^Key/, '').replace(/^Digit/, '').replace('Mouse0', 'ЛКМ').replace('Mouse2', 'ПКМ').replace('Mouse1', 'СКМ').replace('Equal', '+').replace('Minus', '−').replace('Backquote', '`').replace('Escape', 'Esc');
  }

  labelOf(action) {
    return Input.keyLabel(this.keyOf(action));
  }

  _match(k, set) {
    const p = parseKey(k);
    if (!set.has(p.code)) return false;
    if (p.hasMods) return p.mods.shift === this.mods.shift && p.mods.ctrl === this.mods.ctrl && p.mods.alt === this.mods.alt;
    // голая клавиша не срабатывает с Ctrl/Alt (оставляем браузерные сочетания)
    return !this.mods.ctrl && !this.mods.alt;
  }

  /** Удерживается ли действие. */
  isDown(action) {
    const b = this.bindings.get(action);
    if (!b) return false;
    return b.keys.some((k) => this._match(k, this.down));
  }

  /** Нажато в этом кадре (и не поглощено). */
  pressed(action) {
    if (this.consumed.has(action)) return false;
    const b = this.bindings.get(action);
    if (!b) return false;
    return b.keys.some((k) => this._match(k, this.pressedSet));
  }

  released(action) {
    const b = this.bindings.get(action);
    if (!b) return false;
    return b.keys.some((k) => this._match(k, this.releasedSet));
  }

  /** Поглотить нажатие, чтобы другие обработчики его не видели (например, UI перехватил клик). */
  consume(action) {
    this.consumed.add(action);
  }

  /** Сырые коды. */
  keyDown(code) {
    return this.down.has(code);
  }

  keyPressed(code) {
    return this.pressedSet.has(code);
  }

  /** Поглотить сырой код (клик мыши по UI): 'Mouse0'. */
  consumeCode(code) {
    this.pressedSet.delete(code);
  }

  // ---------- Виртуальный ввод (headless-бот, тесты) ----------
  setKey(code, isDown) {
    if (isDown) {
      if (!this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    } else {
      if (this.down.has(code)) this.releasedSet.add(code);
      this.down.delete(code);
    }
    if (code.startsWith('Shift')) this.mods.shift = isDown;
  }

  tap(code) {
    this.setKey(code, true);
    this.down.delete(code);
    this.releasedSet.add(code);
  }

  /** Виртуальная мышь в координатах мира (клетки). */
  setMouseWorld(wx, wy) {
    this.mouse.wx = wx;
    this.mouse.wy = wy;
    this.mouse.tx = Math.floor(wx);
    this.mouse.ty = Math.floor(wy);
  }

  // ---------- DOM ----------
  attach(canvas) {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    this.canvas = canvas;
    const onKey = (e, isDown) => {
      this.mods.shift = e.shiftKey;
      this.mods.ctrl = e.ctrlKey || e.metaKey;
      this.mods.alt = e.altKey;
      if (isDown) {
        if (!e.repeat) this.pressedSet.add(e.code);
        this.down.add(e.code);
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.typed += e.key;
        if (e.key === 'Backspace') this.typed += '\b';
      } else {
        this.down.delete(e.code);
        this.releasedSet.add(e.code);
      }
      this.lastInputTime = performance.now();
      if (PREVENT.has(e.code) || (isDown && this._isBound(e.code) && !e.ctrlKey && !e.metaKey)) e.preventDefault();
      this.game.audio?.resume?.();
    };
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => {
      for (const c of this.down) this.releasedSet.add(c);
      this.down.clear();
      this.mods = { shift: false, ctrl: false, alt: false };
    });
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.sx = e.clientX - r.left;
      this.mouse.sy = e.clientY - r.top;
      this.mouse.moved = true;
    };
    canvas.addEventListener('mousemove', (e) => {
      pos(e);
      this.mouse.inside = true;
    });
    canvas.addEventListener('mouseenter', () => (this.mouse.inside = true));
    canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    canvas.addEventListener('mousedown', (e) => {
      pos(e);
      const c = `Mouse${e.button}`;
      this.down.add(c);
      this.pressedSet.add(c);
      this.lastInputTime = performance.now();
      this.game.audio?.resume?.();
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      const c = `Mouse${e.button}`;
      this.down.delete(c);
      this.releasedSet.add(c);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.mouse.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  _isBound(code) {
    for (const b of this.bindings.values()) if (b.keys.some((k) => parseKey(k).code === code)) return true;
    return false;
  }

  /** Обновить мировые координаты мыши через камеру (вызывается в начале кадра). */
  updateMouseWorld(camera) {
    if (!camera || !this.attached) return;
    const w = camera.screenToWorld(this.mouse.sx, this.mouse.sy);
    this.setMouseWorld(w.x, w.y);
  }

  /** Конец кадра: сбросить «нажато/отпущено в этом кадре». */
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.consumed.clear();
    this.mouse.wheel = 0;
    this.mouse.moved = false;
    this.typed = '';
  }
}
