// av — звук поверх движка ядра (game.audio): проигрывание со своим синтезом, фоновые петли (ветер, дождь,
// снег, огонь, гул колёс, свист клапана, шипение), приглушение (сцена смерти), выключение звука (M),
// шаги по поверхностям и звуки дверей. Узлы подключаются к game.audio.sfxGain / musicGain — громкости из настроек.
import { SYNTHS } from './sfx.js';
import { MusicDirector } from './music.js';
import { clamp01, num, trainState, isMoving } from './util.js';
import { TILE } from '../../core/constants.js';

const LISTEN_R = 28;

export class AvAudio {
  constructor(game, S) {
    this.game = game;
    this.S = S;
    this.last = new Map();
    this.loops = null;
    this.brown = null;
    this.masterSet = -1;
    this.stepT = new Map();
    this.doorOpen = new Map();
    this.doorT = 0;
    this.crackleT = 0;
    this.buf = [];
  }

  get engine() {
    return this.game.audio;
  }

  ready() {
    const c = this.engine?.ctx;
    return !!c && c.state === 'running';
  }

  /** Сыграть звук: свой синтез (def.synth), иначе — слои ядра. */
  play(id, opts = {}) {
    const game = this.game;
    if (game.isHeadless) return;
    const def = game.defs.sfx.get(id);
    if (!def) return;
    if (!def.synth || !SYNTHS[def.synth]) return this.engine.play(id, opts);
    if (!this.ready()) return;
    const a = this.engine;
    const c = a.ctx;
    const now = c.currentTime;
    if (now - (this.last.get(id) || 0) < (def.cooldown ?? 0.03)) return;
    this.last.set(id, now);
    let vol = num(opts.vol, 1);
    let pan = 0;
    if (opts.x !== undefined && Number.isFinite(opts.x)) {
      const dx = opts.x - a.listener.x;
      const dy = num(opts.y) - a.listener.y;
      const d = Math.hypot(dx, dy);
      vol *= Math.max(0, 1 - d / LISTEN_R);
      if (vol <= 0.01) return;
      pan = Math.max(-1, Math.min(1, dx / 14));
    }
    const out = c.createGain();
    out.gain.value = vol * (def.vol ?? 1);
    let node = out;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(a.sfxGain);
    try {
      SYNTHS[def.synth](c, out, now + 0.01, opts, a.noiseBuf);
    } catch (err) {
      console.warn('[av] синтез', id, err?.message || err);
    }
  }

  /** Бурый шум (ветер, гул). */
  _brown(c) {
    if (this.brown) return this.brown;
    const len = c.sampleRate * 3;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    this.brown = b;
    return b;
  }

  _makeLoops() {
    const a = this.engine;
    const c = a.ctx;
    const mk = (buf, filters, extra) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      let node = src;
      const fs = [];
      for (const f of filters) {
        const bq = c.createBiquadFilter();
        bq.type = f.type;
        bq.frequency.value = f.freq;
        bq.Q.value = f.q ?? 0.7;
        node.connect(bq);
        node = bq;
        fs.push(bq);
      }
      const g = c.createGain();
      g.gain.value = 0.0001;
      node.connect(g);
      g.connect(a.sfxGain);
      src.start();
      const L = { src, filters: fs, gain: g, cur: 0, target: 0 };
      if (extra) extra(L);
      return L;
    };
    const white = a.noiseBuf;
    const brown = this._brown(c);
    this.loops = {
      wind: mk(brown, [{ type: 'bandpass', freq: 500, q: 0.6 }]),
      rain: mk(white, [{ type: 'highpass', freq: 900 }, { type: 'lowpass', freq: 6500 }]),
      snow: mk(brown, [{ type: 'lowpass', freq: 900 }, { type: 'highpass', freq: 200 }]),
      fire: mk(brown, [{ type: 'lowpass', freq: 380 }]),
      rumble: mk(brown, [{ type: 'lowpass', freq: 150, q: 1.1 }]),
      hiss: mk(white, [{ type: 'highpass', freq: 2800 }]),
      whistle: mk(white, [{ type: 'bandpass', freq: 3100, q: 6 }], (L) => {
        // тон свистка клапана: две синусоиды с вибрато
        L.oscs = [];
        for (const f of [1760, 2640]) {
          const o = c.createOscillator();
          o.frequency.value = f;
          const lfo = c.createOscillator();
          lfo.frequency.value = 6.5;
          const lg = c.createGain();
          lg.gain.value = f * 0.008;
          lfo.connect(lg);
          lg.connect(o.frequency);
          const og = c.createGain();
          og.gain.value = f > 2000 ? 0.25 : 0.4;
          o.connect(og);
          og.connect(L.gain);
          o.start();
          lfo.start();
          L.oscs.push(o, lfo);
        }
      }),
    };
  }

  _setLoop(L, target, now, tau = 0.6) {
    target = clamp01(target);
    if (Math.abs(target - L.target) < 0.004) return;
    L.target = target;
    L.gain.gain.setTargetAtTime(Math.max(0.0001, target), now, tau);
  }

  /** Кадр: музыка, петли, приглушение, шаги, двери. */
  update(dt) {
    const game = this.game;
    if (game.isHeadless) return;
    const a = this.engine;
    if (!a.ctx || a.ctx.state !== 'running') return;
    const S = this.S;
    // заменить музыку ядра своей (ядро создаёт AmbientMusic при первом вводе)
    if (!a.music?.isAvMusic) {
      try {
        if (a.music) a.music.enabled = false;
        a.music = new MusicDirector(game, S, a);
        S.music = a.music;
      } catch (err) {
        console.warn('[av] музыка недоступна:', err?.message || err);
      }
    }
    if (!this.loops) {
      try {
        this._makeLoops();
      } catch (err) {
        console.warn('[av] петли звука недоступны:', err?.message || err);
        this.loops = {};
      }
    }
    const now = a.ctx.currentTime;
    // мастер: выключение звука (M) и приглушение сцены смерти
    const base = game.settings.get('av.muted') ? 0 : num(game.settings.get('masterVolume'), 0.8);
    const duck = clamp01(num(S.sfxDuck, 1));
    const want = base * duck;
    if (Math.abs(want - this.masterSet) > 0.005 || Math.abs(a.master.gain.value - want) > 0.02) {
      this.masterSet = want;
      a.master.gain.setTargetAtTime(Math.max(0.0001, want), now, 0.15);
    }
    const L = this.loops;
    if (L.wind) {
      const wx = S.wx;
      const indoor = this._listenerIndoor();
      const roofK = indoor ? 0.45 : 1;
      this._setLoop(L.wind, (0.03 + Math.abs(wx.wind) * 0.12 + wx.storm * 0.12 + wx.snow * 0.08 + wx.ash * 0.05) * roofK, now, 1.2);
      L.wind.filters[0].frequency.setTargetAtTime(380 + Math.abs(wx.wind) * 500 + Math.sin(S.now * 0.31) * 180, now, 1.5);
      this._setLoop(L.rain, (wx.rain * 0.22 + wx.storm * 0.08) * (indoor ? 0.7 : 1), now, 1);
      if (indoor && L.rain.filters[1]) L.rain.filters[1].frequency.setTargetAtTime(indoor ? 2200 : 6500, now, 0.5);
      else if (L.rain.filters[1]) L.rain.filters[1].frequency.setTargetAtTime(6500, now, 0.5);
      this._setLoop(L.snow, wx.snow * 0.09 * roofK, now, 1.5);
      this._setLoop(L.fire, clamp01(S.fireNear || 0) * 0.16, now, 0.5);
      const moving = isMoving(game, S);
      const st = trainState(game, S);
      this._setLoop(L.rumble, moving ? 0.08 + clamp01(num(st.speed) / 1.15) * 0.14 : 0, now, 1);
      const boiler = S.boiler;
      const near = S.locoNear ?? 1;
      this._setLoop(L.whistle, boiler === 'valve' ? 0.05 * near : 0, now, 0.25);
      this._setLoop(L.hiss, boiler === 'cracked' ? 0.12 * near : boiler === 'valve' ? 0.04 * near : 0, now, 0.3);
    }
    // треск огня — одиночные щелчки возле костров
    if ((S.fireNear || 0) > 0.05) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) {
        this.crackleT = 0.08 + Math.random() * 0.35;
        a.play('fire_crackle', { vol: 0.25 + S.fireNear * 0.6 });
      }
    }
    // капли по крыше
    if (S.wx.rain > 0.2 && Math.random() < S.wx.rain * 0.4) a.play('rain_drop', { vol: 0.3 + Math.random() * 0.4, pitch: 0.7 + Math.random() * 0.8 });
    this._steps(dt);
    this._doors(dt);
  }

  _listenerIndoor() {
    const map = this.game.map;
    const l = this.game.getLeader();
    if (!map || !l) return false;
    const x = Math.floor(l.x);
    const y = Math.floor(l.y);
    return map.inBounds(x, y) && map.roof[map.idx(x, y)] > 0;
  }

  /** Поверхность под клеткой → id звука шага. */
  surface(x, y) {
    const map = this.game.map;
    if (!map || !map.inBounds(x, y)) return 'step_dirt';
    const fd = map.floorDef(x, y);
    if (fd && fd.id !== 'none' && fd.index !== 0) {
      if (/stone|tile|marble|камен/.test(fd.id)) return 'step_stone';
      if (/carpet|rug|ковер/.test(fd.id)) return 'step_grass';
      return 'step_wood';
    }
    const td = map.terrainDef(x, y);
    const id = td?.id || 'dirt';
    if (td?.water || /water|ice_thin/.test(id)) return 'step_water';
    if (/snow|ice|frost/.test(id)) return 'step_snow';
    if (/ash|cinder|пепел/.test(id)) return 'step_ash';
    if (/stone|rock|gravel|basalt/.test(id)) return 'step_stone';
    if (/grass|moss|meadow/.test(id)) return 'step_grass';
    return 'step_dirt';
  }

  _steps(dt) {
    const game = this.game;
    const cam = game.camera;
    const a = this.engine;
    const leader = game.getLeader();
    const buf = this.buf;
    buf.length = 0;
    game.entities.queryRadius(cam.x, cam.y, 12, 'pawn', null, buf);
    for (const p of buf) {
      if (!p.moving || p.dead || p.downed || p.asleep) continue;
      if (game.vision.enabled && !game.vision.isVisible(Math.floor(p.x), Math.floor(p.y))) continue;
      const k = p.id;
      const t = (this.stepT.get(k) || 0) + dt;
      const interval = (p === leader ? 0.3 : 0.36) * (4 / Math.max(2, num(p.speed, 4)));
      if (t >= interval) {
        this.stepT.set(k, 0);
        const surf = this.surface(Math.floor(p.x), Math.floor(p.y));
        const v = p === leader ? 0.75 : p.faction === 'enemy' ? 0.5 : 0.35;
        a.play(surf, { x: p.x, y: p.y, vol: v });
      } else this.stepT.set(k, t);
    }
    if (this.stepT.size > 300) this.stepT.clear();
  }

  _doors(dt) {
    this.doorT -= dt;
    if (this.doorT > 0) return;
    this.doorT = 0.1;
    const game = this.game;
    const cam = game.camera;
    const b = cam.bounds(2);
    const buf = this.buf;
    buf.length = 0;
    game.entities.queryRect(b.x0, b.y0, b.x1, b.y1, 'building', buf);
    for (const e of buf) {
      const def = game.defs.buildings.get(e.defId);
      if (!def?.door) continue;
      let near = false;
      const ps = game.entities.queryRadius(e.x + 0.5, e.y + 0.5, 1.3, 'pawn');
      for (const p of ps) if (!p.dead) near = true;
      const was = this.doorOpen.get(e.id);
      if (was !== undefined && was !== near) {
        const d = Math.hypot(e.x + 0.5 - cam.x, e.y + 0.5 - cam.y);
        if (d < 16) this.engine.play(near ? 'door_open' : 'door_close', { x: e.x + 0.5, y: e.y + 0.5, vol: 0.7 });
      }
      this.doorOpen.set(e.id, near);
    }
    if (this.doorOpen.size > 600) this.doorOpen.clear();
  }

  reset() {
    this.doorOpen.clear();
    this.stepT.clear();
  }
}

export { TILE };
