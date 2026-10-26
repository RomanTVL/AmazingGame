/**
 * МОДУЛЬ build (MVP) — стройка: меню B, чертежи, подноска материалов и стройка, двери, склады (Z), снос (X).
 * Владелец: js/modules/build/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * Файлы: defs.js (постройки, вкладки, фильтры склада), core.js (индексы, размещение, чертежи, снос, разрушение,
 * двери), jobs.js (задачи build_deliver / build_construct / build_deconstruct, действия E), ui.js (меню, призрак,
 * инструменты Z/X, подсказки), art.js (отрисовка), strings.js (ru/en).
 *
 * КЛАВИШИ: B — меню ('panel:build'), G — поворот ('build:rotate'), Z — зоны склада ('build:zones'),
 *          X — снести/отменить ('build:clear'), ПКМ — отмена, E (удерживать) — строить руками.
 * API (game.api.build): canPlace(defId, x, y, rot), place(defId, x, y, {rot, force, blueprint}) — без blueprint
 *   сразу готовая постройка (как заглушка ядра; так ставят combat/health), с blueprint: true — чертёж;
 *   placeBlueprint(defId, x, y, {rot}), placeFloor(floorId, x, y, {force}), cancel(blueprint), deconstruct(entity)
 *   (сразу, с возвратом половины материалов), designateDeconstruct(entity), destroy(entity, opts) (разрушение —
 *   зовёт combat при прочности 0; четверть материалов на месте), isDoorOpen(entity), blueprintAt(x, y), needs(bp).
 * СОБЫТИЯ: 'build:placed' {entity}, 'build:completed' {entity, pawn}, 'build:deconstructed' {entity, pawn, refund},
 *          'build:destroyed' {entity, x, y, cause, source}, 'build:cancelled' {entity, refund},
 *          'build:delivered' {blueprint, pawn, defId, count}, 'build:floorCompleted' {x, y, floorId, pawn},
 *          'build:doorChanged' {entity, open}.
 * Чертёж — сущность вида 'blueprint' {layer: 'building'|'floor', buildDefId|floorId, x, y, w, h, rot, cost, delivered,
 *   work, workTotal, faction}. Дверь: e.open (рядом пешка) — клетка не блокирует обзор/свет; закрытая — блокирует.
 */
import { EVENTS } from '../../core/events.js';
import { Build, OWNER } from './core.js';
import { BUILD_DEFS } from './defs.js';
import { installJobs } from './jobs.js';
import { installUI } from './ui.js';
import { registerArt } from './art.js';
import { registerStrings } from './strings.js';

const SFX = [
  { id: 'build_hit', cooldown: 0.08, jitter: 0.15, layers: [
    { type: 'osc', wave: 'triangle', freq: 320, freqEnd: 180, dur: 0.06, vol: 0.18 },
    { type: 'noise', dur: 0.04, vol: 0.14, filter: { type: 'bandpass', freq: 1800 } },
  ] },
  { id: 'build_done', cooldown: 0.12, layers: [
    { type: 'osc', wave: 'sine', freq: 520, freqEnd: 880, dur: 0.12, vol: 0.14 },
    { type: 'noise', dur: 0.12, vol: 0.12, filter: { type: 'lowpass', freq: 900 } },
  ] },
  { id: 'build_collapse', cooldown: 0.2, layers: [
    { type: 'noise', dur: 0.5, vol: 0.4, filter: { type: 'lowpass', freq: 1200, freqEnd: 200 } },
    { type: 'osc', wave: 'triangle', freq: 110, freqEnd: 45, dur: 0.4, vol: 0.35 },
  ] },
];

export function register(game) {
  const B = new Build(game);
  registerStrings(game);
  game.entities.registerKind('blueprint', { static: true });
  for (const d of BUILD_DEFS) if (!game.defs.buildings.has(d.id)) game.defs.buildings.add(d, OWNER);
  registerArt(game, BUILD_DEFS);
  for (const s of SFX) if (!game.defs.sfx.has(s.id)) game.audio.registerSfx(s.id, s, OWNER);
  game.input.registerKey('build:rotate', 'KeyG', OWNER, { label: 'build.key.rotate' });
  game.input.registerKey('build:zones', 'KeyZ', OWNER, { label: 'build.key.zones' });
  game.input.registerKey('build:clear', 'KeyX', OWNER, { label: 'build.key.clear' });
  installJobs(B);
  installUI(B);

  game.provide(
    'build',
    {
      canPlace: (defId, x, y, rot = 0) => B.canPlace(defId, x, y, rot, { noAuto: true }),
      place: (defId, x, y, opts = {}) => B.place(defId, x, y, opts),
      placeBlueprint: (defId, x, y, opts = {}) => B.place(defId, x, y, { ...opts, blueprint: true }),
      placeFloor: (floorId, x, y, opts = {}) => B.placeFloor(floorId, x, y, opts),
      cancel: (bp) => B.cancel(bp),
      deconstruct: (entity) => {
        if (!entity || entity.removed) return false;
        if (entity.kind === 'blueprint') return B.cancel(entity);
        return B.deconstructNow(entity, null);
      },
      designateDeconstruct: (entity) => B.designateDeconstruct(entity),
      destroy: (entity, opts = {}) => B.destroy(entity, opts),
      isDoorOpen: (entity) => B.isDoorOpen(entity),
      blueprintAt: (x, y) => B.blueprintAt(x, y, true),
      needs: (bp) => (bp ? B.needs(bp) : null),
      /** Инструмент стройки (для UI и тестов): mode 'place' (+ {id, kind: 'building'|'floor', rot}) | 'zone' | 'clear' | null. */
      setTool: (mode, opts = {}) => {
        if (mode === 'place') {
          if (!game.ui.isOpen('build')) game.ui.openPanel('build');
          const def = opts.kind === 'floor' ? game.defs.floors.get(opts.id) : game.defs.buildings.get(opts.id);
          B.ui.sel = def ? { kind: opts.kind === 'floor' ? 'floor' : 'building', id: opts.id, def } : null;
          B.ui.mode = 'place';
          if (Number.isFinite(opts.rot)) B.ui.rot = opts.rot & 3;
        } else {
          B.actions.setMode(mode || null);
          if (!mode && game.ui.isOpen('build')) game.ui.closePanel('build');
        }
        return true;
      },
      getTool: () => ({ mode: B.ui.mode, id: B.ui.sel?.id || null, kind: B.ui.sel?.kind || null, rot: B.ui.rot, zoneSel: B.ui.zoneSel, zoneFilter: B.ui.zoneFilter }),
      setZoneFilter: (zone, filterId) => B.actions.setZoneFilter(zone, filterId),
    },
    OWNER,
  );

  // двери: тик после ядра (растения 60), до прочих модулей
  game.systems.add({ id: 'build', order: 62, update: (g) => B.updateDoors(g.time.tick) }, OWNER);

  const on = (name, fn) => game.events.on(name, fn, OWNER);
  on(EVENTS.WORLD_RESET, () => {
    B.reset();
    B.ui.drag = null;
    B.ui.zoneSel = 0;
  });
  for (const ev of [EVENTS.COLONY_STARTED, EVENTS.LOAD_AFTER, EVENTS.STATION_CHANGED, EVENTS.TRAIN_STAMPED]) on(ev, () => B.dirty());
  on(EVENTS.ENTITY_SPAWNED, ({ entity }) => {
    if (B.rt.mapRef !== game.map || !B.rt.bp) return;
    if (entity.kind === 'blueprint') B.gridSet(entity, true);
    else if (entity.kind === 'building') B.track(entity, true);
  });
  on(EVENTS.ENTITY_REMOVED, ({ entity }) => {
    if (B.rt.mapRef !== game.map || !B.rt.bp) return;
    if (entity.kind === 'blueprint') B.gridSet(entity, false);
    else if (entity.kind === 'building') B.track(entity, false);
  });
  on(EVENTS.ENTITY_MOVED, ({ entity }) => {
    if (entity.kind === 'blueprint' || (entity.kind === 'building' && B.rt.doors.has(entity.id))) B.dirty();
  });
  on(EVENTS.MAP_CHANGED, (e) => {
    if (B.rt.mapRef === game.map) B.reapplyDoors(e?.x ?? 0, e?.y ?? 0, e?.w ?? game.map.w, e?.h ?? game.map.h);
  });
  // стук молотка (косметика, только браузер)
  on(EVENTS.WORK_HIT, ({ x, y, fx }) => {
    if (fx !== 'build' || game.isHeadless) return;
    game.audio.play('build_hit', { x, y });
    game.fx.preset('chips', x, y, { count: 3 });
  });
}
