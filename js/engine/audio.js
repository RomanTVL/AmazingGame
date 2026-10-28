// Звук: процедурный синтез на Web Audio (без файлов).
//   game.audio.registerSfx('chop', { layers: [...], cooldown: 0.05 })  (= game.defs.sfx)
//   game.audio.play('chop', { x, y, vol, pitch })
// Слой (layer): {type: 'osc'|'noise', wave?: 'sine'|'square'|'sawtooth'|'triangle', freq, freqEnd?, dur,
//                attack?, vol?, delay?, filter?: {type, freq, freqEnd?, q?}}
// Контекст создаётся при первом вводе (политика автоплея). В headless — тишина (no-op).

export const CORE_SFX = [
  { id: 'chop', cooldown: 0.04, jitter: 0.12, layers: [
    { type: 'noise', dur: 0.09, vol: 0.5, filter: { type: 'bandpass', freq: 1400, q: 1.4 } },
    { type: 'osc', wave: 'triangle', freq: 180, freqEnd: 70, dur: 0.12, vol: 0.5 },
  ] },
  { id: 'mine', cooldown: 0.04, jitter: 0.1, layers: [
    { type: 'osc', wave: 'square', freq: 1300, freqEnd: 900, dur: 0.05, vol: 0.18, filter: { type: 'highpass', freq: 600 } },
    { type: 'noise', dur: 0.06, vol: 0.35, filter: { type: 'highpass', freq: 2500 } },
    { type: 'osc', wave: 'sine', freq: 2600, dur: 0.18, vol: 0.06, delay: 0.01 },
  ] },
  { id: 'harvest', cooldown: 0.08, jitter: 0.2, layers: [
    { type: 'noise', dur: 0.16, vol: 0.25, attack: 0.03, filter: { type: 'bandpass', freq: 3200, q: 0.8 } },
  ] },
  { id: 'eat', cooldown: 0.15, jitter: 0.2, layers: [
    { type: 'noise', dur: 0.07, vol: 0.18, filter: { type: 'lowpass', freq: 900 } },
  ] },
  { id: 'tree_fall', cooldown: 0.2, layers: [
    { type: 'noise', dur: 0.6, vol: 0.45, attack: 0.05, filter: { type: 'lowpass', freq: 900, freqEnd: 200 } },
    { type: 'osc', wave: 'sine', freq: 90, freqEnd: 40, dur: 0.5, vol: 0.5, delay: 0.25 },
  ] },
  { id: 'rock_break', cooldown: 0.2, layers: [
    { type: 'noise', dur: 0.4, vol: 0.5, filter: { type: 'lowpass', freq: 1400, freqEnd: 300 } },
    { type: 'osc', wave: 'triangle', freq: 120, freqEnd: 50, dur: 0.3, vol: 0.4 },
  ] },
  { id: 'pickup', cooldown: 0.05, layers: [
    { type: 'osc', wave: 'sine', freq: 520, freqEnd: 780, dur: 0.08, vol: 0.18 },
  ] },
  { id: 'drop', cooldown: 0.05, layers: [
    { type: 'osc', wave: 'sine', freq: 420, freqEnd: 260, dur: 0.09, vol: 0.18 },
    { type: 'noise', dur: 0.05, vol: 0.12, filter: { type: 'lowpass', freq: 700 } },
  ] },
  { id: 'designate', cooldown: 0.06, layers: [
    { type: 'osc', wave: 'triangle', freq: 880, freqEnd: 1320, dur: 0.06, vol: 0.08 },
  ] },
  { id: 'ui_click', cooldown: 0.03, layers: [
    { type: 'osc', wave: 'square', freq: 1200, freqEnd: 800, dur: 0.03, vol: 0.06, filter: { type: 'lowpass', freq: 3000 } },
  ] },
  { id: 'ui_open', cooldown: 0.05, layers: [
    { type: 'osc', wave: 'sine', freq: 440, freqEnd: 880, dur: 0.12, vol: 0.1 },
    { type: 'osc', wave: 'sine', freq: 660, freqEnd: 1320, dur: 0.12, vol: 0.06, delay: 0.03 },
  ] },
  { id: 'ui_close', cooldown: 0.05, layers: [
    { type: 'osc', wave: 'sine', freq: 880, freqEnd: 440, dur: 0.1, vol: 0.08 },
  ] },
  { id: 'error', cooldown: 0.2, layers: [
    { type: 'osc', wave: 'square', freq: 160, dur: 0.12, vol: 0.1, filter: { type: 'lowpass', freq: 900 } },
    { type: 'osc', wave: 'square', freq: 120, dur: 0.14, vol: 0.1, delay: 0.1, filter: { type: 'lowpass', freq: 900 } },
  ] },
  { id: 'notify', cooldown: 0.3, layers: [
    { type: 'osc', wave: 'sine', freq: 988, dur: 0.25, vol: 0.08 },
    { type: 'osc', wave: 'sine', freq: 1318, dur: 0.35, vol: 0.06, delay: 0.09 },
  ] },
  { id: 'magic', cooldown: 0.05, jitter: 0.1, layers: [
    { type: 'osc', wave: 'sawtooth', freq: 300, freqEnd: 1200, dur: 0.25, vol: 0.12, filter: { type: 'lowpass', freq: 2400, freqEnd: 600 } },
    { type: 'noise', dur: 0.3, vol: 0.12, attack: 0.05, filter: { type: 'bandpass', freq: 4000, q: 3 } },
  ] },
  { id: 'step', cooldown: 0.12, jitter: 0.25, layers: [
    { type: 'noise', dur: 0.04, vol: 0.05, filter: { type: 'lowpass', freq: 500 } },
  ] },
];

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.enabled = !game.isHeadless;
    this.last = new Map();
    this.music = null;
    this.listener = { x: 0, y: 0 };
  }

  get defs() {
    return this.game.defs.sfx;
  }

  registerSfx(id, def, owner = 'core') {
    return this.game.defs.sfx.add({ ...def, id }, owner);
  }

  /** Создать контекст (вызывать из обработчика ввода). */
  resume() {
    if (!this.enabled || typeof window === 'undefined') return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.enabled = false;
          return;
        }
        this.ctx = new AC();
        const c = this.ctx;
        this.comp = c.createDynamicsCompressor();
        this.comp.threshold.value = -14;
        this.comp.ratio.value = 4;
        this.master = c.createGain();
        this.sfxGain = c.createGain();
        this.musicGain = c.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain.connect(this.master);
        this.master.connect(this.comp);
        this.comp.connect(c.destination);
        this.noiseBuf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        this.music = new AmbientMusic(this);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (err) {
      this.enabled = false;
      console.warn('[audio] отключено:', err);
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.game.settings;
    this.master.gain.value = s.get('masterVolume') ?? 0.8;
    this.sfxGain.gain.value = s.get('sfxVolume') ?? 0.8;
    this.musicGain.gain.value = (s.get('musicVolume') ?? 0.5) * 0.5;
  }

  /** Сыграть звук. opts: {x, y — позиция в мире (затухание/панорама), vol, pitch} */
  play(id, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const def = this.game.defs.sfx.get(id);
    if (!def) return;
    const now = this.ctx.currentTime;
    const prev = this.last.get(id) || 0;
    if (now - prev < (def.cooldown ?? 0.03)) return;
    this.last.set(id, now);
    let vol = opts.vol ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      const dx = opts.x - this.listener.x;
      const dy = opts.y - this.listener.y;
      const d = Math.hypot(dx, dy);
      vol *= Math.max(0, 1 - d / 28);
      if (vol <= 0.01) return;
      pan = Math.max(-1, Math.min(1, dx / 14));
    }
    const pitch = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (def.jitter ?? 0));
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = vol * (def.vol ?? 1);
    let node = out;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxGain);
    for (const L of def.layers || []) this._layer(L, now + (L.delay || 0), pitch, out);
  }

  _layer(L, t0, pitch, out) {
    const c = this.ctx;
    const dur = L.dur ?? 0.1;
    const att = L.attack ?? 0.004;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L.vol ?? 0.3), t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let src;
    if (L.type === 'noise') {
      src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = pitch;
    } else {
      src = c.createOscillator();
      src.type = L.wave || 'sine';
      src.frequency.setValueAtTime((L.freq ?? 440) * pitch, t0);
      if (L.freqEnd) src.frequency.exponentialRampToValueAtTime(Math.max(1, L.freqEnd * pitch), t0 + dur);
    }
    let last = src;
    if (L.filter) {
      const f = c.createBiquadFilter();
      f.type = L.filter.type || 'lowpass';
      f.frequency.setValueAtTime(L.filter.freq ?? 1000, t0);
      if (L.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(L.filter.freqEnd, t0 + dur);
      f.Q.value = L.filter.q ?? 0.7;
      src.connect(f);
      last = f;
    }
    last.connect(g);
    g.connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** Вызывается каждый кадр (слушатель = камера, музыка). */
  update(dt) {
    const cam = this.game.camera;
    if (cam) {
      this.listener.x = cam.x;
      this.listener.y = cam.y;
    }
    if (this.music && this.ctx?.state === 'running') this.music.update(dt);
  }
}

/**
 * Простой генератор фоновой музыки: медленные аккорды-пэды (детюн, фильтр),
 * ночью — минорнее и тише, редкие «колокольчики». Модуль av может заменить: game.audio.music = new MyMusic(...)
 */
export class AmbientMusic {
  constructor(audio) {
    this.audio = audio;
    this.next = 0;
    this.step = 0;
    this.enabled = true;
    // ступени в полутонах от A2 (110 Гц)
    this.dayProg = [[0, 7, 12, 16], [5, 12, 17, 21], [-3, 4, 9, 12], [7, 14, 19, 23]];
    this.nightProg = [[0, 7, 12, 15], [-4, 3, 8, 12], [-7, 0, 5, 12], [-2, 5, 10, 14]];
  }

  update() {
    const a = this.audio;
    const c = a.ctx;
    if (!this.enabled || !c) return;
    if (c.currentTime < this.next - 0.2) return;
    const t0 = Math.max(c.currentTime + 0.05, this.next);
    const night = this.audio.game.time.nightFactor > 0.5;
    const prog = night ? this.nightProg : this.dayProg;
    const chord = prog[this.step % prog.length];
    this.step++;
    const len = 9;
    this.next = t0 + len - 1.5;
    const base = night ? 98 : 110;
    const out = c.createGain();
    out.gain.value = night ? 0.7 : 0.9;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(400, t0);
    filt.frequency.linearRampToValueAtTime(night ? 900 : 1500, t0 + len * 0.5);
    filt.frequency.linearRampToValueAtTime(350, t0 + len);
    filt.connect(out);
    out.connect(a.musicGain);
    for (const semi of chord) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = base * Math.pow(2, semi / 12);
        o.detune.value = det;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.035, t0 + 2.5);
        g.gain.linearRampToValueAtTime(0.03, t0 + len - 2.5);
        g.gain.linearRampToValueAtTime(0.0001, t0 + len);
        o.connect(g);
        g.connect(filt);
        o.start(t0);
        o.stop(t0 + len + 0.1);
      }
    }
    // колокольчик
    if (Math.random() < 0.6) {
      const semi = chord[1 + Math.floor(Math.random() * 3)] + 24;
      const tb = t0 + 1 + Math.random() * 4;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * Math.pow(2, semi / 12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, tb);
      g.gain.exponentialRampToValueAtTime(0.05, tb + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tb + 2.5);
      o.connect(g);
      g.connect(a.musicGain);
      o.start(tb);
      o.stop(tb + 2.6);
    }
  }
}
