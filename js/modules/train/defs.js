// Определения модуля train (MVP): уголь, угольный пласт (добыча), тендер, звуки гудка.
// Котёл, топка, регулятор, рунный двигатель, депо — после MVP (черновики: machine.js, stoke.js).

const OWNER = 'train';

export function registerDefs(game) {
  const D = game.defs;

  // ---------- предметы ----------
  if (!D.items.has('coal')) {
    D.items.add({
      id: 'coal', nameKey: 'train.item.coal', category: 'fuel', stackLimit: 75, value: 2, color: '#5d6278', icon: 'ore',
    }, OWNER);
  }

  // ---------- природа: угольный пласт (добыча киркой → уголь) ----------
  if (!D.buildings.has('coal_seam')) {
    D.buildings.add({
      id: 'coal_seam', nameKey: 'train.b.coal_seam', category: 'natural', natural: true, buildable: false, mineable: true,
      blocksVision: true, blocksLight: true, hp: 420, yield: { coal: 14 }, workToMine: 380, color: '#7c84a6', bake: true,
    }, OWNER);
  }

  // ---------- вагоны ----------
  if (!D.wagonTypes.has('tender')) {
    D.wagonTypes.add({ id: 'tender', nameKey: 'train.wagon.tender', length: 6, color: '#c9a46b', light: '#ffe0a0', stockpile: true, fuelOnly: true }, OWNER);
  }

  registerSfx(game);
}

function registerSfx(game) {
  const A = game.audio;
  const horn = (dur, delay = 0) => [
    { type: 'osc', wave: 'sawtooth', freq: 233, freqEnd: 228, dur, attack: 0.04, vol: 0.16, delay, filter: { type: 'lowpass', freq: 1500 } },
    { type: 'osc', wave: 'square', freq: 294, freqEnd: 289, dur, attack: 0.05, vol: 0.09, delay, filter: { type: 'lowpass', freq: 1300 } },
    { type: 'osc', wave: 'sawtooth', freq: 350, freqEnd: 344, dur, attack: 0.05, vol: 0.06, delay, filter: { type: 'lowpass', freq: 1800 } },
    { type: 'noise', dur: dur * 0.9, attack: 0.05, vol: 0.05, delay, filter: { type: 'bandpass', freq: 2400, q: 1.2 } },
  ];
  A.registerSfx('train:horn', { cooldown: 0.2, layers: horn(0.55) }, OWNER);
  A.registerSfx('train:horn_double', { cooldown: 0.3, layers: [...horn(0.28), ...horn(0.32, 0.38)] }, OWNER);
  A.registerSfx('train:horn_long', { cooldown: 0.5, layers: horn(1.9) }, OWNER);
  A.registerSfx('train:chuff', { cooldown: 0.05, jitter: 0.1, layers: [
    { type: 'noise', dur: 0.14, vol: 0.07, attack: 0.01, filter: { type: 'bandpass', freq: 600, q: 0.7 } },
  ] }, OWNER);
}
