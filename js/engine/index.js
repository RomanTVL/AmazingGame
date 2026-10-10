// Регистрация движковых определений и кадровых систем ядра: звуки, пресеты частиц,
// клавиши времени/отладки, обновление камеры/звука/частиц, отклик на события (звук + частицы).
import { CORE_SFX } from './audio.js';
import { CORE_FX_PRESETS } from './particles.js';
import { EVENTS } from '../core/events.js';

export const CORE_KEYS = [
  ['time:pause', 'Space', 'input.pause'],
  ['time:faster', ['Equal', 'NumpadAdd'], 'input.faster'],
  ['time:slower', ['Minus', 'NumpadSubtract'], 'input.slower'],
  ['time:speed1', 'Numpad1', 'input.speed1'],
  ['time:speed2', 'Numpad2', 'input.speed2'],
  ['time:speed3', 'Numpad3', 'input.speed3'],
  ['debug:toggle', 'F9', 'input.debug'],
  ['ui:back', 'Escape', 'input.back'],
];

export function registerEngineDefs(game) {
  for (const s of CORE_SFX) game.defs.sfx.add(s);
  for (const p of CORE_FX_PRESETS) game.defs.fxPresets.add(p);
  for (const [a, k, label] of CORE_KEYS) game.input.registerKey(a, k, 'core', { label });

  const fs = game.frameSystems;
  fs.add({ id: 'mouse-world', order: 0, update: (g) => g.input.updateMouseWorld(g.camera) });
  fs.add({ id: 'ui', order: 10, update: (g) => g.ui.frame(g) });
  fs.add({
    id: 'time-controls',
    order: 20,
    update(g) {
      const i = g.input;
      if (i.pressed('time:pause')) g.togglePause();
      if (i.pressed('time:faster')) g.setSpeed(g.paused ? g.speed : g.speed + 1);
      if (i.pressed('time:slower')) g.setSpeed(g.speed - 1);
      if (i.pressed('time:speed1')) g.setSpeed(1);
      if (i.pressed('time:speed2')) g.setSpeed(2);
      if (i.pressed('time:speed3')) g.setSpeed(3);
      if (i.pressed('debug:toggle')) g.settings.set('showDebug', !g.settings.get('showDebug'));
      if (i.pressed('ui:back') && !g.ui.closeTop()) g.events.emit(EVENTS.UI_MENU_REQUESTED, {});
    },
  });
  fs.add({
    id: 'camera',
    order: 80,
    update(g, dt) {
      const w = g.input.mouse.wheel;
      if (w && !g.ui.wantsMouse) g.camera.zoomBy(w);
      g.camera.update(dt);
    },
  });
  fs.add({ id: 'audio', order: 85, update: (g, dt) => g.audio.update(dt) });
  fs.add({ id: 'particles', order: 90, update: (g, dt) => !g.isHeadless && g.fx.update(g.paused ? 0 : dt * g.speed) });

  game.events.on(EVENTS.SETTINGS_CHANGED, ({ key }) => {
    if (key.endsWith('Volume')) game.audio.applyVolumes();
  });

  registerFeedback(game);
}

/** Звуки и частицы на события симуляции (косметика). Модуль av может дополнить/снять: game.events.offOwner('core-fx'). */
function registerFeedback(game) {
  const O = 'core-fx';
  const on = (n, f) => game.events.on(n, f, O);
  on(EVENTS.WORK_HIT, ({ x, y, fx }) => {
    if (fx === 'chop') {
      game.audio.play('chop', { x, y });
      game.fx.preset('chips', x, y);
      game.fx.preset('leaves', x, y - 0.2);
    } else if (fx === 'mine') {
      game.audio.play('mine', { x, y });
      game.fx.preset('sparks', x, y);
      game.fx.preset('dust', x, y, { count: 4 });
    } else if (fx === 'harvest') {
      game.audio.play('harvest', { x, y });
      game.fx.preset('leaves', x, y, { color: '#ff7aa0' });
    } else if (fx === 'eat') game.audio.play('eat', { x, y, vol: 0.6 });
  });
  on(EVENTS.PLANT_CUT, ({ plant, harvestOnly }) => {
    if (harvestOnly) return;
    game.audio.play('tree_fall', { x: plant.x + 0.5, y: plant.y + 0.5 });
    game.fx.preset('leaves', plant.x + 0.5, plant.y + 0.5, { count: 22, speed: 3 });
    game.fx.preset('chips', plant.x + 0.5, plant.y + 0.5, { count: 10 });
    game.camera.addShake(0.12);
  });
  on(EVENTS.THING_MINED, ({ thing }) => {
    game.audio.play('rock_break', { x: thing.x + 0.5, y: thing.y + 0.5 });
    game.fx.preset('dust', thing.x + 0.5, thing.y + 0.5, { count: 18 });
    game.camera.addShake(0.15);
  });
  on(EVENTS.ITEM_PICKED, ({ pawn }) => pawn.isLeader && game.audio.play('pickup', { x: pawn.x, y: pawn.y }));
  on(EVENTS.ITEM_DROPPED, ({ pawn }) => pawn.isLeader && game.audio.play('drop', { x: pawn.x, y: pawn.y }));
  on(EVENTS.UI_NOTIFY, () => game.audio.play('notify'));
}
