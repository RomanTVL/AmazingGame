// av — процедурная адаптивная музыка с контекстами и кроссфейдами (замена AmbientMusic ядра).
// Контексты: calm (стоянка днём: мягкие пэды + щипки, лады по биому), night, combat (барабаны + низкие струнные),
// travel (стук колёс + мелодия, темп 60 → 110 от скорости поезда), boss, death (грустное соло).
// Каждый контекст — своя шина (GainNode) → сухо + реверб → game.audio.musicGain (громкость из настроек).
// Планировщик с упреждением 0.3 с по времени AudioContext. Только браузер (создаётся, когда есть контекст звука).
import { clamp01, num, biomeClass, isMoving, trainState } from './util.js';

const hz = (root, semi) => root * Math.pow(2, semi / 12);
const rnd = Math.random;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

export const CONTEXTS = ['calm', 'night', 'combat', 'travel', 'boss', 'death'];
const LEVEL = { calm: 0.85, night: 0.8, combat: 0.85, travel: 0.8, boss: 0.95, death: 0.9 };
const FADE_IN = { calm: 2.2, night: 2.5, combat: 0.6, travel: 1.6, boss: 0.5, death: 0.4 };

/** Лады и гармонии «стоянки» по биому. */
const CALM = {
  forest: {
    root: 146.83, bpm: 74, pluckP: 0.55, voice: 'pluck',
    prog: [[0, 7, 12, 16], [-3, 4, 9, 12], [-7, 0, 5, 9], [-5, 2, 7, 11]],
    scale: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  },
  ash: {
    root: 164.81, bpm: 62, pluckP: 0.42, voice: 'oud',
    prog: [[0, 7, 12, 16], [1, 8, 13, 17], [0, 7, 12, 16], [-2, 5, 10, 13]],
    scale: [0, 1, 4, 5, 7, 8, 10, 12, 13, 16],
  },
  ice: {
    root: 220, bpm: 60, pluckP: 0.36, voice: 'bell',
    prog: [[0, 7, 11, 16], [2, 9, 14, 18], [-1, 6, 11, 14], [-5, 2, 7, 11]],
    scale: [0, 2, 4, 6, 7, 9, 11, 12, 14, 16],
  },
};
const NIGHT_PROG = [[0, 7, 12, 15], [-4, 3, 8, 12], [-7, 0, 5, 12], [-2, 5, 10, 14]];
const COMBAT_ROOTS = [0, -4, -2, -5];
const OSTINATO = [0, 0, 12, 0, 7, 0, 10, 0];
// мелодия пути (соль миксолидийский): [доля, полутон, длительность в долях]
const TRAVEL_PHRASES = [
  [[0, 7, 1], [1, 9, 0.5], [1.5, 7, 0.5], [2, 5, 1], [3, 4, 1], [4, 2, 1.5], [5.5, 4, 0.5], [6, 0, 2]],
  [[0, 0, 0.5], [0.5, 2, 0.5], [1, 4, 1], [2, 7, 1], [3, 9, 0.5], [3.5, 10, 0.5], [4, 9, 1], [5, 7, 1], [6, 5, 1], [7, 4, 1]],
];
const TRAVEL_CHORDS = [[0, 4, 7, 12], [-2, 2, 5, 10], [-7, -3, 0, 5], [0, 4, 7, 12]];
// мотив смерти (ля минор): [доля, полутон, длительность]
const DEATH_MOTIF = [[0, 7, 1.5], [1.5, 5, 0.5], [2, 3, 1], [3, 2, 1], [4, 0, 2.5], [6.5, -2, 0.5], [7, 0, 3], [10, 3, 1], [11, 2, 1], [12, -5, 4]];

function makeImpulse(c, sec) {
  const len = Math.floor(c.sampleRate * sec);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

export class MusicDirector {
  constructor(game, S, engine) {
    this.game = game;
    this.S = S;
    this.engine = engine;
    const c = engine.ctx;
    this.c = c;
    this.isAvMusic = true;
    this.enabled = true;
    this.master = c.createGain();
    this.master.gain.value = 1;
    this.master.connect(engine.musicGain);
    this.dry = c.createGain();
    this.dry.gain.value = 0.85;
    this.dry.connect(this.master);
    try {
      this.verb = c.createConvolver();
      this.verb.buffer = makeImpulse(c, 2.6);
      this.verbIn = c.createGain();
      this.verbIn.gain.value = 0.35;
      this.verbIn.connect(this.verb);
      this.verb.connect(this.master);
    } catch {
      this.verbIn = this.dry;
    }
    this.layers = {};
    for (const id of CONTEXTS) {
      const g = c.createGain();
      g.gain.value = 0.0001;
      g.connect(this.dry);
      g.connect(this.verbIn);
      this.layers[id] = { id, gain: g, target: 0, level: 0, next: 0, beat: 0, wasOn: false };
    }
    this.current = null;
    this.decideT = 0;
    this.duck = 1;
    this.noise = engine.noiseBuf;
  }

  /** Какой контекст сейчас нужен. */
  decide() {
    const S = this.S;
    const game = this.game;
    if (S.forceMusic && this.layers[S.forceMusic]) return S.forceMusic;
    if (S.now < S.deathMusicUntil) return 'death';
    const th = S.threat || {};
    if (th.boss || S.bossActive) return 'boss';
    if (th.near > 0 || (S.raidActive && th.hostiles > 0)) return 'combat';
    if (isMoving(game, S)) return 'travel';
    if ((game.time?.nightFactor ?? 0) > 0.55) return 'night';
    return 'calm';
  }

  switchTo(id) {
    this.current = id;
    for (const L of Object.values(this.layers)) {
      const on = L.id === id;
      L.target = on ? LEVEL[L.id] : 0;
      if (on && L.level < 0.05) {
        L.beat = 0;
        L.next = 0;
      }
    }
  }

  update(dt) {
    const c = this.c;
    if (!this.enabled || !c || c.state !== 'running') return;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(0.25, dt);
    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = 0.5;
      const want = this.decide();
      if (want !== this.current) this.switchTo(want);
    }
    const now = c.currentTime;
    // громкости контекстов (кроссфейд)
    for (const L of Object.values(this.layers)) {
      const tau = L.target > L.level ? FADE_IN[L.id] / 3 : 0.9;
      const prev = L.level;
      L.level += (L.target - L.level) * (1 - Math.exp(-dt / tau));
      if (Math.abs(L.level - prev) > 0.0005 || L.wasOn !== L.target > 0) {
        L.gain.gain.setTargetAtTime(Math.max(0.0001, L.target), now, tau);
        L.wasOn = L.target > 0;
      }
    }
    const duck = clamp01(num(this.S.musicDuck, 1));
    if (Math.abs(duck - this.duck) > 0.01) {
      this.duck = duck;
      this.master.gain.setTargetAtTime(Math.max(0.0001, duck), now, 0.4);
    }
    // планирование нот
    const ahead = now + 0.3;
    for (const L of Object.values(this.layers)) {
      if (L.target <= 0 && L.level < 0.012) continue;
      if (!L.next || L.next < now - 0.4) L.next = now + 0.06;
      let guard = 0;
      while (L.next < ahead && guard++ < 16) L.next = this[`beat_${L.id}`](L, L.next);
    }
  }

  // ---------------- инструменты ----------------
  _osc(type, f, t, dur, bus, v, opts = {}) {
    const c = this.c;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glide), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = c.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    if (opts.linear) {
      g.gain.linearRampToValueAtTime(v, t + a);
      g.gain.setValueAtTime(v, t + Math.max(a, dur - (opts.release ?? 0.5)));
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    let node = o;
    if (opts.filter) {
      const f2 = c.createBiquadFilter();
      f2.type = opts.filter.type || 'lowpass';
      f2.frequency.setValueAtTime(opts.filter.freq, t);
      if (opts.filter.freqEnd) f2.frequency.exponentialRampToValueAtTime(opts.filter.freqEnd, t + dur);
      f2.Q.value = opts.filter.q ?? 0.7;
      o.connect(f2);
      node = f2;
    }
    if (opts.vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = opts.vibrato;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.6, dur * 0.5));
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    node.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(t, dur, bus, v, filter, attack = 0.002) {
    const c = this.c;
    if (!this.noise) return;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.8 + rnd() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t);
    if (filter.freqEnd) f.frequency.exponentialRampToValueAtTime(filter.freqEnd, t + dur);
    f.Q.value = filter.q ?? 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f);
    f.connect(g);
    g.connect(bus);
    n.start(t, rnd() * 0.5);
    n.stop(t + dur + 0.05);
  }

  pad(bus, t, freqs, dur, v, cutoff = 900, wave = 'sawtooth') {
    for (const f of freqs) {
      this._osc(wave, f, t, dur, bus, v, { attack: Math.min(1.8, dur * 0.3), linear: true, release: Math.min(2.2, dur * 0.35), detune: -7, filter: { type: 'lowpass', freq: cutoff * 0.6, freqEnd: cutoff } });
      this._osc(wave, f, t, dur, bus, v * 0.8, { attack: Math.min(1.8, dur * 0.3), linear: true, release: Math.min(2.2, dur * 0.35), detune: 7, filter: { type: 'lowpass', freq: cutoff, freqEnd: cutoff * 0.5 } });
    }
  }

  pluck(bus, t, f, v, decay = 0.9) {
    this._osc('triangle', f, t, decay, bus, v, { attack: 0.004, filter: { type: 'lowpass', freq: 3200, freqEnd: 700 } });
    this._osc('sine', f * 2, t, decay * 0.4, bus, v * 0.25, { attack: 0.003 });
  }

  oud(bus, t, f, v) {
    this._osc('sawtooth', f, t, 0.55, bus, v * 0.7, { attack: 0.003, filter: { type: 'bandpass', freq: f * 3, freqEnd: f * 1.5, q: 2.2 } });
    this._osc('triangle', f, t, 0.7, bus, v * 0.5, { attack: 0.003 });
  }

  bell(bus, t, f, v, dur = 2.8) {
    this._osc('sine', f, t, dur, bus, v, { attack: 0.003 });
    this._osc('sine', f * 2.76, t, dur * 0.5, bus, v * 0.35, { attack: 0.002 });
    this._osc('sine', f * 5.4, t, dur * 0.22, bus, v * 0.15, { attack: 0.002 });
  }

  lead(bus, t, f, dur, v, wave = 'triangle') {
    this._osc(wave, f, t, dur + 0.25, bus, v, { attack: 0.04, linear: true, release: 0.22, vibrato: 5.2, filter: { type: 'lowpass', freq: 2600 } });
    this._osc('sine', f * 2, t, dur + 0.2, bus, v * 0.18, { attack: 0.05, linear: true, release: 0.2 });
  }

  bass(bus, t, f, dur, v, cutoff = 420) {
    this._osc('sawtooth', f, t, dur, bus, v, { attack: 0.01, linear: true, release: Math.min(0.3, dur * 0.4), filter: { type: 'lowpass', freq: cutoff, q: 1.2 } });
    this._osc('sine', f / 2, t, dur, bus, v * 0.6, { attack: 0.01, linear: true, release: Math.min(0.3, dur * 0.4) });
  }

  kick(bus, t, v = 0.5) {
    this._osc('sine', 130, t, 0.32, bus, v, { attack: 0.002, glide: 42 });
    this._noise(t, 0.02, bus, v * 0.25, { type: 'lowpass', freq: 1800 });
  }

  snare(bus, t, v = 0.25) {
    this._noise(t, 0.16, bus, v, { type: 'bandpass', freq: 1900, q: 0.9 });
    this._osc('triangle', 190, t, 0.1, bus, v * 0.6, { attack: 0.002, glide: 140 });
  }

  hat(bus, t, v = 0.06, open = false) {
    this._noise(t, open ? 0.18 : 0.04, bus, v, { type: 'highpass', freq: 7000 });
  }

  tom(bus, t, f, v = 0.3) {
    this._osc('sine', f, t, 0.3, bus, v, { attack: 0.002, glide: f * 0.6 });
  }

  clack(bus, t, v = 0.2, pitch = 1) {
    this._noise(t, 0.04, bus, v, { type: 'bandpass', freq: 1700 * pitch, q: 3 });
    this._osc('triangle', 170 * pitch, t, 0.07, bus, v * 0.8, { attack: 0.002, glide: 80 });
  }

  brass(bus, t, freqs, dur, v) {
    for (const f of freqs) {
      this._osc('sawtooth', f, t, dur, bus, v, { attack: 0.06, linear: true, release: 0.3, detune: -5, filter: { type: 'lowpass', freq: 300, freqEnd: 1400, q: 2 } });
      this._osc('sawtooth', f, t, dur, bus, v * 0.7, { attack: 0.06, linear: true, release: 0.3, detune: 6, filter: { type: 'lowpass', freq: 300, freqEnd: 1200, q: 2 } });
    }
  }

  choir(bus, t, freqs, dur, v) {
    for (const f of freqs) {
      for (const [fq, k] of [[720, 1], [1150, 0.6]]) {
        this._osc('sawtooth', f, t, dur, bus, v * k, { attack: dur * 0.3, linear: true, release: dur * 0.3, detune: (rnd() - 0.5) * 14, filter: { type: 'bandpass', freq: fq, q: 3 } });
      }
    }
  }

  // ---------------- контексты (одна доля за вызов; возвращают время следующей доли) ----------------
  beat_calm(L, t) {
    const cls = biomeClass(this.game.map?.biome);
    const P = CALM[cls] || CALM.forest;
    const spb = 60 / P.bpm;
    const b = L.beat++;
    const chordI = Math.floor(b / 8) % P.prog.length;
    const chord = P.prog[chordI];
    if (b % 8 === 0) this.pad(L.gain, t, chord.map((s) => hz(P.root, s - 12)), spb * 8 + 1.6, 0.022, cls === 'ash' ? 700 : 1100, cls === 'ice' ? 'triangle' : 'sawtooth');
    if (b % 4 === 0 && rnd() < 0.7) this.bass(L.gain, t, hz(P.root, chord[0] - 12), spb * 3.5, 0.03, 300);
    if (rnd() < P.pluckP) {
      const tt = t + (rnd() < 0.3 ? spb * 0.5 : 0);
      const near = P.scale.filter((s) => chord.some((c) => (((s - c) % 12) + 12) % 12 === 0)).concat(P.scale);
      const semi = pick(near) + (rnd() < 0.25 ? 12 : 0);
      const f = hz(P.root, semi);
      if (P.voice === 'bell') this.bell(L.gain, tt, f * 2, 0.03, 3.4);
      else if (P.voice === 'oud') this.oud(L.gain, tt, f, 0.05);
      else this.pluck(L.gain, tt, f, 0.05, 1.1);
    }
    if (b % 16 === 12 && rnd() < 0.5) this.bell(L.gain, t, hz(P.root, chord[2] + 12), 0.018, 4);
    return t + spb;
  }

  beat_night(L, t) {
    const root = 110;
    const spb = 60 / 52;
    const b = L.beat++;
    const chord = NIGHT_PROG[Math.floor(b / 8) % NIGHT_PROG.length];
    if (b % 8 === 0) this.pad(L.gain, t, chord.map((s) => hz(root, s)), spb * 8 + 2, 0.02, 650);
    if (rnd() < 0.13) this.bell(L.gain, t + rnd() * spb, hz(root, pick(chord) + 24), 0.02, 4.5);
    if (rnd() < 0.12) this.pluck(L.gain, t, hz(root, pick(chord) + 12), 0.03, 1.6);
    if (b % 16 === 0 && this.noise) this._noise(t, spb * 6, L.gain, 0.012, { type: 'bandpass', freq: 500, freqEnd: 900, q: 0.6 }, spb * 2);
    return t + spb;
  }

  beat_combat(L, t) {
    const root = 73.42;
    const spb = 60 / 132;
    const b = L.beat++;
    const bar = Math.floor(b / 4);
    const inBar = b % 4;
    const r = COMBAT_ROOTS[bar % COMBAT_ROOTS.length];
    const e = spb / 2;
    // барабаны
    if (inBar === 0 || inBar === 2) this.kick(L.gain, t, 0.42);
    if (inBar === 3 && rnd() < 0.5) this.kick(L.gain, t + e, 0.3);
    if (inBar === 1 || inBar === 3) this.snare(L.gain, t, 0.2);
    this.hat(L.gain, t, 0.035);
    this.hat(L.gain, t + e, 0.025);
    if (bar % 4 === 3 && inBar === 3) {
      this.tom(L.gain, t, 160, 0.22);
      this.tom(L.gain, t + e * 0.5, 130, 0.22);
      this.tom(L.gain, t + e, 100, 0.25);
    }
    // низкие струнные — остинато восьмыми
    for (let k = 0; k < 2; k++) {
      const s = OSTINATO[(inBar * 2 + k) % OSTINATO.length];
      this._osc('sawtooth', hz(root, r + s), t + k * e, e * 0.9, L.gain, 0.03, { attack: 0.01, linear: true, release: 0.06, filter: { type: 'lowpass', freq: 700, q: 1.4 } });
    }
    if (inBar === 0) {
      this.bass(L.gain, t, hz(root, r), spb * 3.8, 0.04, 260);
      if (bar % 2 === 0) this.pad(L.gain, t, [hz(root, r + 12), hz(root, r + 15), hz(root, r + 19)], spb * 8, 0.012, 1200);
    }
    return t + spb;
  }

  beat_travel(L, t) {
    const st = trainState(this.game, this.S);
    const sp = clamp01(num(st.speed, 0.6) / 1.0);
    const bpm = 60 + 50 * sp;
    const spb = 60 / bpm;
    const root = 98;
    const b = L.beat++;
    const inBar = b % 4;
    const bar = Math.floor(b / 4);
    // стук колёс: «та-дум» на первую долю, одиночный — на третью
    if (inBar === 0) {
      this.clack(L.gain, t, 0.12);
      this.clack(L.gain, t + spb * 0.3, 0.1, 0.92);
      this.kick(L.gain, t, 0.16);
    }
    if (inBar === 2) {
      this.clack(L.gain, t, 0.09);
      this.kick(L.gain, t, 0.1);
    }
    this._noise(t + spb * 0.5, 0.05, L.gain, 0.012, { type: 'highpass', freq: 5000 });
    const chord = TRAVEL_CHORDS[bar % TRAVEL_CHORDS.length];
    if (inBar === 0) {
      this.pad(L.gain, t, chord.slice(1).map((s) => hz(root * 2, s)), spb * 4 + 0.6, 0.012, 1300, 'triangle');
      this.bass(L.gain, t, hz(root, chord[0]), spb * 1.8, 0.035, 380);
    }
    if (inBar === 2) this.bass(L.gain, t, hz(root, chord[0] + 7), spb * 1.8, 0.03, 380);
    // мелодия: 16 долей фраза A+B, затем 16 долей тишины/вариаций
    const cyc = b % 32;
    if (cyc < 16) {
      const ph = TRAVEL_PHRASES[cyc < 8 ? 0 : 1];
      const off = cyc % 8;
      for (const [s, semi, d] of ph) {
        if (s >= off && s < off + 1) this.lead(L.gain, t + (s - off) * spb, hz(root * 2, semi), d * spb * 0.95, 0.04);
      }
    } else if (rnd() < 0.25) this.pluck(L.gain, t, hz(root * 2, pick([0, 2, 4, 7, 9, 12])), 0.03, 0.9);
    return t + spb;
  }

  beat_boss(L, t) {
    const root = 69.3;
    const spb = 60 / 96;
    const b = L.beat++;
    const inBar = b % 4;
    const bar = Math.floor(b / 4);
    const e = spb / 2;
    this.kick(L.gain, t, 0.5);
    if (inBar === 1 || inBar === 3) {
      this.snare(L.gain, t, 0.26);
      this._noise(t, 0.4, L.gain, 0.05, { type: 'lowpass', freq: 900 });
    }
    this.hat(L.gain, t + e, 0.03, inBar === 3);
    if (bar % 4 === 3 && inBar >= 2) for (let k = 0; k < 4; k++) this.tom(L.gain, t + k * e * 0.5, 170 - k * 22 - (inBar - 2) * 40, 0.24);
    if (inBar === 0) this.brass(L.gain, t, [hz(root, 0), hz(root, 1), hz(root, 7)], spb * 1.2, 0.022);
    if (inBar === 2 && bar % 2 === 1) this.brass(L.gain, t + e, [hz(root, -1), hz(root, 6)], spb * 0.9, 0.02);
    if (b % 8 === 0) this.choir(L.gain, t, [hz(root * 2, 0), hz(root * 2, 7), hz(root * 2, 12), hz(root * 2, 13)], spb * 8, 0.008);
    if (bar % 4 === 2) {
      const motif = [0, 6, 7, 6];
      this._osc('sawtooth', hz(root * 4, motif[inBar]), t, spb * 0.9, L.gain, 0.025, { attack: 0.02, linear: true, release: 0.15, filter: { type: 'bandpass', freq: 1100, q: 2 } });
    }
    this.bass(L.gain, t, hz(root, inBar === 3 ? 6 : 0), spb * 0.9, 0.045, 220);
    return t + spb;
  }

  beat_death(L, t) {
    const root = 220;
    const spb = 60 / 54;
    const b = L.beat++;
    if (b === 0) this.pad(L.gain, t, [hz(root, -12), hz(root, -5), hz(root, 0), hz(root, 3)], spb * 8 + 1, 0.013, 700, 'triangle');
    if (b === 8) this.pad(L.gain, t, [hz(root, -16), hz(root, -9), hz(root, -4), hz(root, 0)], spb * 8 + 2.5, 0.012, 650, 'triangle');
    if (b < 18) {
      for (const [s, semi, d] of DEATH_MOTIF) {
        if (s >= b && s < b + 1) this.lead(L.gain, t + (s - b) * spb, hz(root, semi), d * spb, 0.05, 'sine');
      }
    }
    return t + spb;
  }
}
