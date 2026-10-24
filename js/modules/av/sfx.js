// av — процедурный банк звуков (расширяет game.defs.sfx ядра; формат слоёв — js/engine/audio.js).
// Слой: {type: 'osc'|'noise', wave?, freq, freqEnd?, dur, attack?, vol?, delay?, filter?: {type, freq, freqEnd?, q?}}
// Звуки с полем synth богаче проигрываются через game.api.av.play (свой синтез: AM-мурчание, стыки с темпом),
// а game.audio.play ядра играет их слои (упрощённый вариант) — оба пути работают.

const N = (dur, vol, filter, extra = {}) => ({ type: 'noise', dur, vol, filter, ...extra });
const O = (wave, freq, freqEnd, dur, vol, extra = {}) => ({ type: 'osc', wave, freq, freqEnd, dur, vol, ...extra });
const bp = (freq, q = 1, freqEnd) => ({ type: 'bandpass', freq, q, freqEnd });
const lp = (freq, freqEnd) => ({ type: 'lowpass', freq, freqEnd });
const hp = (freq, freqEnd) => ({ type: 'highpass', freq, freqEnd });

/** Гудок паровоза: «трёхголосый» свисток + пар. len — длительность одного гудка. */
function horn(len, blasts = 1, gap = 0.55) {
  const out = [];
  for (let b = 0; b < blasts; b++) {
    const d = b * gap;
    for (const [f, v] of [[392, 0.05], [494, 0.04], [587, 0.035]]) {
      out.push(O('sawtooth', f * 0.985, f, len, v, { attack: 0.07, delay: d, filter: bp(f * 2.2, 1.4) }));
      out.push(O('sine', f, f * 1.003, len, v * 0.9, { attack: 0.05, delay: d }));
    }
    out.push(N(len + 0.15, 0.07, bp(2800, 0.8), { attack: 0.04, delay: d }));
  }
  return out;
}

export const AV_SFX = [
  // ---------- шаги по поверхностям ----------
  { id: 'step_grass', cooldown: 0.06, jitter: 0.22, vol: 0.9, layers: [N(0.05, 0.07, lp(950)), N(0.06, 0.025, hp(3200), { delay: 0.01 })] },
  { id: 'step_dirt', cooldown: 0.06, jitter: 0.2, layers: [N(0.045, 0.08, lp(620)), O('sine', 92, 58, 0.045, 0.04)] },
  { id: 'step_stone', cooldown: 0.06, jitter: 0.18, layers: [N(0.03, 0.06, bp(2300, 2)), O('triangle', 230, 160, 0.03, 0.035)] },
  { id: 'step_wood', cooldown: 0.06, jitter: 0.16, layers: [O('triangle', 170, 110, 0.06, 0.07), N(0.04, 0.05, bp(900, 1.5))] },
  { id: 'step_snow', cooldown: 0.06, jitter: 0.2, layers: [N(0.09, 0.06, bp(2600, 0.7, 1500), { attack: 0.02 }), N(0.08, 0.035, lp(520))] },
  { id: 'step_ash', cooldown: 0.06, jitter: 0.2, layers: [N(0.07, 0.05, lp(1200, 480), { attack: 0.012 })] },
  { id: 'step_water', cooldown: 0.08, jitter: 0.2, layers: [N(0.12, 0.08, bp(1200, 1, 600)), O('sine', 520, 300, 0.08, 0.03)] },
  // ---------- работа ----------
  { id: 'chop', override: true, cooldown: 0.04, jitter: 0.12, layers: [N(0.08, 0.45, bp(1600, 1.6)), O('triangle', 200, 70, 0.12, 0.45), N(0.03, 0.14, hp(4200))] },
  { id: 'axe_chop', cooldown: 0.04, jitter: 0.12, layers: [N(0.08, 0.45, bp(1600, 1.6)), O('triangle', 200, 70, 0.12, 0.45), N(0.03, 0.14, hp(4200))] },
  { id: 'hammer', cooldown: 0.05, jitter: 0.08, layers: [O('square', 920, 700, 0.04, 0.1, { filter: hp(500) }), O('sine', 2450, 2400, 0.16, 0.05, { delay: 0.004 }), N(0.03, 0.18, bp(3000, 1.2)), O('triangle', 140, 80, 0.06, 0.24)] },
  { id: 'saw', cooldown: 0.25, jitter: 0.1, layers: [N(0.22, 0.17, bp(2200, 4, 2700), { attack: 0.03 }), N(0.22, 0.1, bp(1400, 3, 1700), { attack: 0.03, delay: 0.25 })] },
  { id: 'sizzle', cooldown: 0.3, jitter: 0.2, layers: [N(0.45, 0.06, hp(4000), { attack: 0.05 })] },
  { id: 'eat', override: true, cooldown: 0.15, jitter: 0.2, layers: [N(0.06, 0.15, lp(900)), N(0.06, 0.12, lp(800), { delay: 0.13 })] },
  { id: 'build_done', cooldown: 0.1, layers: [O('sine', 300, 900, 0.08, 0.15), O('sine', 1200, 1500, 0.06, 0.06, { delay: 0.05 }), N(0.08, 0.15, lp(1500))] },
  { id: 'craft_done', cooldown: 0.2, layers: [O('triangle', 660, 880, 0.12, 0.06), O('sine', 1320, 1320, 0.2, 0.04, { delay: 0.08 })] },
  { id: 'coins', cooldown: 0.15, layers: [O('sine', 2400, 2400, 0.15, 0.05), O('sine', 3100, 3100, 0.12, 0.04, { delay: 0.05 }), O('sine', 2700, 2700, 0.15, 0.04, { delay: 0.11 })] },
  // ---------- двери ----------
  { id: 'door_open', cooldown: 0.12, jitter: 0.1, layers: [N(0.24, 0.07, bp(620, 3, 950), { attack: 0.05 }), O('triangle', 180, 240, 0.2, 0.03), O('triangle', 160, 90, 0.05, 0.08, { delay: 0.22 })] },
  { id: 'door_close', cooldown: 0.12, jitter: 0.1, layers: [N(0.2, 0.06, bp(900, 3, 600), { attack: 0.04 }), O('triangle', 140, 70, 0.12, 0.13, { delay: 0.18 }), N(0.06, 0.1, lp(800), { delay: 0.18 })] },
  // ---------- бой ----------
  { id: 'sword_clash', cooldown: 0.05, jitter: 0.1, layers: [O('square', 1800, 1500, 0.16, 0.05, { filter: hp(1200) }), O('sine', 3100, 3050, 0.4, 0.045), O('sine', 4700, 4650, 0.3, 0.025), N(0.06, 0.24, hp(5000))] },
  { id: 'arrow_whoosh', cooldown: 0.04, jitter: 0.15, layers: [N(0.18, 0.2, bp(1200, 1.2, 3400), { attack: 0.05 })] },
  { id: 'arrow_hit', cooldown: 0.04, jitter: 0.15, layers: [N(0.05, 0.24, lp(1500)), O('triangle', 300, 120, 0.06, 0.18)] },
  { id: 'crossbow', cooldown: 0.06, jitter: 0.1, layers: [O('square', 200, 80, 0.05, 0.14, { filter: lp(1200) }), N(0.05, 0.2, bp(2000, 1.2)), O('triangle', 520, 320, 0.12, 0.07)] },
  { id: 'rune_bolt', cooldown: 0.05, jitter: 0.08, layers: [O('sawtooth', 900, 200, 0.22, 0.07, { filter: lp(3000, 800) }), O('sine', 1800, 600, 0.2, 0.06), N(0.15, 0.06, bp(5000, 4))] },
  { id: 'body_hit', cooldown: 0.04, jitter: 0.2, layers: [N(0.06, 0.25, lp(700)), O('sine', 140, 60, 0.08, 0.22)] },
  { id: 'thud', cooldown: 0.1, jitter: 0.15, layers: [O('sine', 120, 48, 0.2, 0.34), N(0.1, 0.18, lp(500))] },
  { id: 'explosion', cooldown: 0.1, jitter: 0.1, layers: [N(0.9, 0.7, lp(1300, 120), { attack: 0.005 }), O('sine', 72, 30, 0.75, 0.6), N(0.16, 0.3, hp(2500))] },
  { id: 'fire_crackle', cooldown: 0.03, jitter: 0.45, layers: [N(0.02, 0.12, hp(2500)), N(0.03, 0.08, bp(1200, 3), { delay: 0.04 }), N(0.015, 0.1, hp(3600), { delay: 0.09 })] },
  { id: 'swoosh', cooldown: 0.08, jitter: 0.12, layers: [N(0.2, 0.18, bp(800, 1, 2500), { attack: 0.04 })] },
  { id: 'war_cry', cooldown: 2, jitter: 0.1, layers: [O('sawtooth', 200, 260, 0.6, 0.06, { attack: 0.06, filter: bp(800, 2) }), O('sawtooth', 300, 390, 0.55, 0.035, { attack: 0.06, delay: 0.05, filter: bp(1300, 2) }), N(0.6, 0.06, bp(900, 1), { attack: 0.1 })] },
  // ---------- заклинания ----------
  { id: 'spell_fireball', cooldown: 0.08, jitter: 0.08, layers: [N(0.45, 0.28, lp(400, 2400), { attack: 0.08 }), O('sawtooth', 110, 220, 0.4, 0.07, { filter: lp(900) }), N(0.5, 0.14, bp(900, 1), { delay: 0.1 })] },
  { id: 'spell_lightning', cooldown: 0.08, jitter: 0.06, layers: [N(0.08, 0.38, hp(2000)), O('square', 3000, 200, 0.15, 0.04), N(0.6, 0.24, lp(3000, 300), { delay: 0.04 }), O('sawtooth', 60, 50, 0.3, 0.05)] },
  { id: 'spell_ice', cooldown: 0.08, jitter: 0.05, layers: [O('sine', 2600, 3400, 0.4, 0.05), O('sine', 3900, 3900, 0.6, 0.035, { delay: 0.05 }), O('triangle', 5200, 5200, 0.3, 0.02, { delay: 0.1 }), N(0.35, 0.1, hp(6000), { attack: 0.05 })] },
  { id: 'spell_shield', cooldown: 0.1, layers: [O('sine', 220, 440, 0.6, 0.09, { attack: 0.1 }), O('sine', 330, 660, 0.6, 0.065, { attack: 0.1 }), O('triangle', 880, 880, 0.8, 0.03, { delay: 0.2 })] },
  { id: 'spell_heal', cooldown: 0.1, layers: [O('sine', 523, 523, 0.6, 0.07, { attack: 0.05 }), O('sine', 659, 659, 0.6, 0.06, { delay: 0.08 }), O('sine', 784, 784, 0.7, 0.05, { delay: 0.16 }), O('sine', 1046, 1046, 0.8, 0.04, { delay: 0.24 })] },
  { id: 'spell_blink', cooldown: 0.08, layers: [O('sine', 1400, 300, 0.12, 0.09), N(0.15, 0.15, bp(3000, 2, 800)), O('sine', 300, 1400, 0.12, 0.07, { delay: 0.12 })] },
  { id: 'spell_spark', cooldown: 0.05, jitter: 0.1, layers: [O('square', 1600, 2600, 0.06, 0.05), N(0.05, 0.12, hp(4000))] },
  { id: 'spell_fizzle', cooldown: 0.2, jitter: 0.1, layers: [N(0.4, 0.12, bp(1200, 1, 400), { attack: 0.02 })] },
  { id: 'spell_okrik', cooldown: 0.3, layers: [O('sawtooth', 180, 150, 0.35, 0.11, { filter: bp(700, 2) }), O('sawtooth', 360, 300, 0.35, 0.055, { filter: bp(1200, 3) }), N(0.3, 0.05, bp(1000, 1))] },
  // ---------- UI ----------
  { id: 'ui_hover', cooldown: 0.04, layers: [O('sine', 1800, 1800, 0.025, 0.02)] },
  { id: 'ui_tab', cooldown: 0.04, layers: [O('triangle', 700, 900, 0.04, 0.05)] },
  { id: 'ui_confirm', cooldown: 0.06, layers: [O('sine', 660, 990, 0.1, 0.07), O('sine', 1320, 1320, 0.15, 0.035, { delay: 0.06 })] },
  { id: 'ui_cancel', cooldown: 0.06, layers: [O('sine', 600, 400, 0.08, 0.055)] },
  // ---------- смерть, память ----------
  { id: 'death_sting', cooldown: 1.5, layers: [
    O('sine', 440, 440, 1.7, 0.08, { attack: 0.03 }),
    O('sine', 415.3, 392, 2.3, 0.055, { delay: 0.55, attack: 0.05 }),
    O('triangle', 220, 220, 2.6, 0.045, { attack: 0.35, filter: lp(800) }),
    O('sine', 659.3, 659.3, 1.2, 0.025, { delay: 0.95 }),
  ] },
  { id: 'heartbeat', cooldown: 0.5, layers: [O('sine', 62, 44, 0.12, 0.28), O('sine', 58, 42, 0.12, 0.18, { delay: 0.22 })] },
  { id: 'arrive_chime', cooldown: 1, layers: [O('sine', 659.3, 659.3, 1.6, 0.05), O('sine', 830.6, 830.6, 1.5, 0.04, { delay: 0.12 }), O('sine', 987.8, 987.8, 1.6, 0.035, { delay: 0.24 })] },
  { id: 'victory_sting', cooldown: 2, layers: [O('triangle', 392, 392, 0.4, 0.06), O('triangle', 523, 523, 0.4, 0.06, { delay: 0.18 }), O('triangle', 659, 659, 0.9, 0.06, { delay: 0.36 }), O('sine', 784, 784, 1.2, 0.04, { delay: 0.36 })] },
  // ---------- поезд ----------
  { id: 'bell', cooldown: 0.5, layers: [O('sine', 660, 660, 2.5, 0.11), O('sine', 1584, 1584, 1.6, 0.045), O('sine', 2640, 2640, 0.8, 0.025), O('sine', 990, 990, 2, 0.035), N(0.02, 0.1, bp(4000, 2))] },
  { id: 'whistle', cooldown: 0.5, layers: horn(1.3) },
  { id: 'horn_short', cooldown: 0.3, layers: horn(0.45) },
  { id: 'horn_double', cooldown: 0.6, layers: horn(0.32, 2, 0.5) },
  { id: 'horn_long', cooldown: 1, layers: horn(2.2) },
  { id: 'rail_joint', synth: 'railJoint', cooldown: 0.12, jitter: 0.05, layers: [
    N(0.035, 0.22, bp(1800, 3)), O('triangle', 180, 90, 0.06, 0.22),
    N(0.035, 0.2, bp(1650, 3), { delay: 0.13 }), O('triangle', 165, 85, 0.06, 0.2, { delay: 0.13 }),
  ] },
  { id: 'rail_clack', cooldown: 0.05, jitter: 0.06, layers: [N(0.035, 0.22, bp(1800, 3)), O('triangle', 180, 90, 0.06, 0.22)] },
  { id: 'chuff', cooldown: 0.05, jitter: 0.12, layers: [N(0.18, 0.13, lp(900, 300), { attack: 0.01 })] },
  { id: 'brake_screech', cooldown: 1.5, layers: [O('sawtooth', 2200, 1700, 1.6, 0.025, { filter: bp(2400, 8) }), O('square', 3300, 2900, 1.4, 0.012, { filter: hp(2000) }), N(1.6, 0.1, bp(3000, 3), { attack: 0.1 })] },
  { id: 'steam_hiss', cooldown: 0.3, layers: [N(1.2, 0.18, hp(3000), { attack: 0.05 })] },
  { id: 'steam_burst', cooldown: 0.2, layers: [N(0.7, 0.28, bp(2500, 0.7), { attack: 0.01 })] },
  { id: 'woomph', cooldown: 0.1, layers: [N(0.35, 0.34, lp(300, 1600), { attack: 0.06 }), O('sine', 80, 140, 0.3, 0.28)] },
  { id: 'bass_thump', cooldown: 0.1, layers: [O('sine', 90, 40, 0.38, 0.55), O('sine', 180, 60, 0.12, 0.2)] },
  { id: 'shovel_scrape', cooldown: 0.15, jitter: 0.1, layers: [N(0.18, 0.11, bp(2500, 2, 1800), { attack: 0.02 })] },
  { id: 'coal_throw', cooldown: 0.1, jitter: 0.1, layers: [N(0.09, 0.14, lp(2000)), O('triangle', 400, 200, 0.05, 0.07)] },
  { id: 'coal_spill', cooldown: 0.2, jitter: 0.1, layers: [N(0.02, 0.15, hp(2000)), N(0.02, 0.13, hp(2200), { delay: 0.05 }), N(0.02, 0.12, hp(1800), { delay: 0.11 }), N(0.025, 0.1, hp(2400), { delay: 0.18 })] },
  { id: 'kettle', cooldown: 4, layers: [O('sine', 2100, 2300, 1.4, 0.012, { attack: 0.4 }), N(1.4, 0.02, bp(3500, 4), { attack: 0.4 })] },
  // ---------- погода и природа ----------
  { id: 'thunder', cooldown: 1, jitter: 0.15, layers: [N(2.4, 0.55, lp(900, 100), { attack: 0.02 }), O('sine', 55, 35, 2, 0.32), N(1.2, 0.28, lp(400), { delay: 0.4 })] },
  { id: 'wind_gust', cooldown: 2, jitter: 0.2, layers: [N(2, 0.13, bp(420, 0.8, 900), { attack: 0.6 })] },
  { id: 'rain_drop', cooldown: 0.02, jitter: 0.5, layers: [N(0.015, 0.05, hp(3000))] },
  { id: 'wolf_howl', cooldown: 3, jitter: 0.06, layers: [O('sine', 300, 540, 0.6, 0.07, { attack: 0.15, filter: bp(700, 1.5) }), O('sine', 540, 420, 1.1, 0.07, { delay: 0.55, filter: bp(700, 1.5) }), O('triangle', 600, 1080, 0.6, 0.02, { attack: 0.15 }), O('triangle', 1080, 840, 1.1, 0.02, { delay: 0.55 })] },
  { id: 'crowd', cooldown: 2, layers: [N(1.5, 0.14, bp(500, 1), { attack: 0.3 }), N(1.3, 0.07, bp(1100, 2), { attack: 0.3, delay: 0.1 }), O('sawtooth', 140, 160, 1.2, 0.018, { filter: bp(600, 2) })] },
  { id: 'voice_order', cooldown: 0.3, jitter: 0.08, layers: [O('sawtooth', 220, 180, 0.22, 0.07, { filter: bp(900, 3) }), O('sawtooth', 440, 360, 0.22, 0.035, { filter: bp(1800, 4) })] },
  // ---------- мелочи ----------
  { id: 'loot_tink', cooldown: 0.03, jitter: 0, layers: [O('sine', 1760, 1760, 0.25, 0.07), O('sine', 2640, 2640, 0.18, 0.035, { delay: 0.01 })] },
  { id: 'clap', cooldown: 0.08, jitter: 0.1, layers: [N(0.05, 0.4, bp(1500, 0.8)), N(0.04, 0.2, hp(3000), { delay: 0.008 })] },
  { id: 'glass_clink', cooldown: 0.1, jitter: 0.05, layers: [O('sine', 2800, 2800, 0.6, 0.055), O('sine', 3700, 3700, 0.5, 0.035), O('sine', 5200, 5200, 0.3, 0.022), N(0.02, 0.1, hp(6000))] },
  { id: 'mug_jump', cooldown: 0.05, jitter: 0.2, layers: [O('sine', 3200, 3200, 0.08, 0.012)] },
  { id: 'cat_purr', synth: 'purr', cooldown: 1.2, layers: [O('sawtooth', 26, 25, 1.4, 0.16, { attack: 0.2, filter: lp(260) }), N(1.4, 0.05, lp(300), { attack: 0.2 })] },
  { id: 'cat_meow', cooldown: 1, jitter: 0.1, layers: [O('sawtooth', 650, 950, 0.18, 0.04, { filter: bp(1100, 3) }), O('sawtooth', 950, 600, 0.3, 0.04, { delay: 0.16, filter: bp(1000, 3) })] },
  { id: 'heart_pop', cooldown: 0.1, jitter: 0.2, layers: [O('sine', 900, 1400, 0.08, 0.03)] },
];

/**
 * Свой синтез для звуков с полем synth (через game.api.av.play). c — AudioContext, out — выходной узел,
 * t0 — время начала, opts — {pitch, gap, ...}, nb — буфер шума.
 */
export const SYNTHS = {
  /** Мурчание: низкий шум, амплитудно промодулированный ~26 Гц (AM). */
  purr(c, out, t0, opts, nb) {
    const dur = opts.dur ?? 1.6;
    const src = c.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 340;
    f.Q.value = 0.9;
    const am = c.createGain();
    am.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.frequency.value = 24 + (opts.pitch ?? 1) * 3;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.5;
    const bias = c.createConstantSource ? c.createConstantSource() : null;
    lfo.connect(lfoGain);
    lfoGain.connect(am.gain);
    if (bias) {
      bias.offset.value = 0.55;
      bias.connect(am.gain);
      bias.start(t0);
      bias.stop(t0 + dur + 0.1);
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.25);
    env.gain.setValueAtTime(0.5, t0 + dur - 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(am);
    am.connect(env);
    env.connect(out);
    // тональная «урчалка» под шумом
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 52;
    const of = c.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 160;
    const og = c.createGain();
    og.gain.value = 0.12;
    o.connect(of);
    of.connect(og);
    og.connect(am);
    src.start(t0);
    lfo.start(t0);
    o.start(t0);
    src.stop(t0 + dur + 0.1);
    lfo.stop(t0 + dur + 0.1);
    o.stop(t0 + dur + 0.1);
  },
  /** Стык рельсов: два щелчка «ту-дум», интервал gap зависит от скорости. */
  railJoint(c, out, t0, opts, nb) {
    const gap = Math.max(0.07, Math.min(0.32, opts.gap ?? 0.14));
    const v = opts.vol ?? 1;
    for (let k = 0; k < 2; k++) {
      const t = t0 + k * gap;
      const n = c.createBufferSource();
      n.buffer = nb;
      n.playbackRate.value = 0.9 + k * 0.08;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800 - k * 150;
      f.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.24 * v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      n.connect(f);
      f.connect(g);
      g.connect(out);
      n.start(t);
      n.stop(t + 0.08);
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(180 - k * 15, t);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.07);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(og);
      og.connect(out);
      o.start(t);
      o.stop(t + 0.1);
    }
  },
};

/** id звука заклинания по spellId combat. */
export function spellSfx(spellId) {
  const s = String(spellId || '').toLowerCase();
  if (/fire|flame|огн/.test(s)) return 'spell_fireball';
  if (/light|chain|thunder|молн/.test(s)) return 'spell_lightning';
  if (/ice|frost|cold|лёд|лед/.test(s)) return 'spell_ice';
  if (/shield|ward|щит/.test(s)) return 'spell_shield';
  if (/heal|леч/.test(s)) return 'spell_heal';
  if (/blink|tele|dash|блинк/.test(s)) return 'spell_blink';
  if (/okrik|shout|voice|окрик/.test(s)) return 'spell_okrik';
  if (/spark|искр/.test(s)) return 'spell_spark';
  if (/fizz|fail/.test(s)) return 'spell_fizzle';
  return 'magic';
}

/** Цвет вспышки заклинания. */
export function spellColor(spellId) {
  const s = String(spellId || '').toLowerCase();
  if (/fire|flame|огн/.test(s)) return '#ff8a3d';
  if (/light|chain|thunder|молн/.test(s)) return '#bfe8ff';
  if (/ice|frost|cold/.test(s)) return '#9fe8ff';
  if (/shield|ward/.test(s)) return '#c9b8ff';
  if (/heal/.test(s)) return '#9dffb0';
  if (/blink|tele|dash/.test(s)) return '#e0b0ff';
  if (/okrik|voice/.test(s)) return '#ffe08a';
  return '#9ff8ff';
}
