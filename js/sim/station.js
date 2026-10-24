// Смена стоянки: поезд со всем содержимым вагонов уезжает со старой карты и встаёт на новую.
// Это низкоуровневая операция ядра; КОГДА и КУДА ехать (маршрут, топливо, время в пути) решает модуль journey:
//   game.changeStation({ biome: 'ash', stationIndex: 5 })
// Что переезжает: всё внутри вагонов (мебель, предметы, трупы, пешки, зоны вагонов) + все живые поселенцы
// (те, кто снаружи, «садятся» в поезд). Остальное (лагерь на земле, деревья, враги снаружи) остаётся на старой карте
// и исчезает. Задачи отменяются, пометки и резервы сбрасываются, шлётся 'world:reset' {reason: 'station'},
// затем 'map:generated', 'train:stamped' и в конце 'station:changed' {map, train, carried, opts}.
import { EVENTS } from '../core/events.js';
import { FACTION } from '../core/constants.js';
import { generateStation } from './worldgen.js';
import { stopMoving } from './pawn.js';

/**
 * @param {object} game
 * @param {object} [opts]
 * @param {string} [opts.biome] — биом новой карты (по умолчанию текущий)
 * @param {number} [opts.stationIndex] — номер станции (влияет на сид генерации)
 * @param {number} [opts.w] [opts.h] — размер карты (по умолчанию как у текущей)
 * @param {number} [opts.x0] — левый край поезда (по умолчанию по центру)
 * @param {boolean} [opts.boardAll=true] — посадить в поезд всех живых поселенцев снаружи
 * @param {object[]} [opts.carry] — дополнительные сущности снаружи, которые едут с поездом (пленники, животные)
 * @param {(e) => boolean} [opts.filter] — что из содержимого вагонов НЕ брать (вернуть false); по умолчанию враги остаются
 * @returns {object} новая карта
 */
export function changeStation(game, opts = {}) {
  const train = game.train;
  if (!train) throw new Error('[station] нет поезда');
  const old = game.map;
  const filter = opts.filter || ((e) => !(e.kind === 'pawn' && e.faction === FACTION.ENEMY));
  const contents = train.stamped ? train.captureContents(filter) : [];
  const zones = train.stamped ? train.captureZones() : [];
  const aboard = new Set(contents.map((c) => c.entity));
  const boarding = [];
  if (opts.boardAll !== false) for (const p of game.colonists()) if (!aboard.has(p)) boarding.push(p);
  for (const e of opts.carry || []) if (e && !e.removed && !aboard.has(e) && !boarding.includes(e)) boarding.push(e);

  // задачи — отменить (груз в руках сохраняется)
  for (const p of game.entities.ofKind('pawn')) {
    if (!p.job) continue;
    p.job.keepCarry = true;
    game.jobs.endJob(p, 'cancelled');
  }
  for (const c of contents) game.entities.detach(c.entity);
  for (const e of boarding) game.entities.detach(e);

  // старая карта исчезает целиком
  game.entities.clear({ keepNextId: true });
  game.designations.clear();
  game.zones.clear();
  game.jobs.reservations.clear();
  for (const car of train.cars) car.rect = null;
  train.stamped = false;
  train.invalidateLights();
  game.events.emit(EVENTS.WORLD_RESET, { reason: 'station' });

  const map = generateStation(game, {
    biome: opts.biome || old?.biome || 'forest',
    w: Math.max(opts.w || old?.w || 140, train.length + 8),
    h: Math.max(opts.h || old?.h || 90, 24),
    stationIndex: opts.stationIndex ?? 0,
    railY: opts.railY,
  });
  train.stamp(map.railY, opts.x0 ?? Math.floor((map.w - train.length) / 2), { zones });

  for (const c of contents) {
    const r = train.carById(c.carId)?.rect;
    const e = c.entity;
    if (!r) continue;
    e.x = r.x + c.dx;
    e.y = r.y + c.dy;
    if (e.kind === 'pawn') stopMoving(e);
    game.entities.attach(e);
  }
  // севшие снаружи: свободные клетки жилых вагонов, затем любых
  const cells = [];
  const cars = [...train.cars].sort((a, b) => (b.type === 'residential') - (a.type === 'residential'));
  for (const car of cars) for (const c of train.interior(car)) if (map.isPassable(c.x, c.y) && !map.buildingAt(c.x, c.y)) cells.push(c);
  boarding.forEach((e, i) => {
    const c = cells.length ? cells[(i * 5 + 2) % cells.length] : { x: Math.floor(map.w / 2), y: map.railY };
    if (e.kind === 'pawn') {
      e.x = c.x + 0.5;
      e.y = c.y + 0.5;
      stopMoving(e);
    } else {
      e.x = c.x;
      e.y = c.y;
    }
    game.entities.attach(e);
  });
  train.nudgePawns();
  const carried = contents.length + boarding.length;
  game.events.emit(EVENTS.STATION_CHANGED, { map, train, carried, opts });
  return map;
}
