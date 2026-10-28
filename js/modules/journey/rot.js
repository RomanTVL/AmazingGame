// journey — Гниль: таймер стоянки; затянул — Гниль ползёт с запада (ландшафт 'rot'), уровень растёт, приходят
// гнилые волки. События 'journey:rotAdvance' {level}.
import { hours, notify, safe, diff, raidActive } from './state.js';

/** Сколько игровых часов до Гнили на станции шага step (0 — старт: scenario.rotGapHours). */
export function rotHoursFor(J, step) {
  const base = step === 0 ? J.game.getScenario?.()?.rotGapHours ?? 30 : [30, 28, 26, 30][step - 1] ?? 26;
  return base * diff(J).rotMul;
}

export function startRotTimer(J, h) {
  const now = J.game.time.tick;
  J.S.rot = { deadline: now + hours(h), level: 0, nextLevelAt: 0, nextBeastAt: 0, creep: 0 };
}

/** Часов до Гнили (может быть < 0). */
export function rotHoursLeft(J) {
  return (J.S.rot.deadline - J.game.time.tick) / hours(1);
}

/** Протянуть Гниль с западного края до колонки level·5 (не ближе 3 клеток к поезду). */
function creep(J) {
  const game = J.game;
  const map = game.map;
  const R = J.S.rot;
  if (!map) return;
  const x0 = game.train?.stamped ? game.train.x0 - 3 : map.w;
  const target = Math.max(0, Math.min(x0, R.level * 5));
  if (target <= R.creep) return;
  const floors = map.floor;
  map.batch(() => {
    for (let x = R.creep; x < target; x++)
      for (let y = 0; y < map.h; y++) {
        const i = map.idx(x, y);
        if (floors[i]) continue;
        const td = map.terrainDef(x, y);
        if (!td || td.cost <= 0 || td.rot) continue;
        map.setTerrain(x, y, 'rot');
      }
  });
  R.creep = target;
}

function spawnBeasts(J) {
  const game = J.game;
  const R = J.S.rot;
  const cap = 20 + 22 * game.colonists().filter((p) => !p.downed).length;
  // по одному волку, но всё чаще (уровень Гнили растёт)
  const points = Math.round(Math.min(cap, 22) * diff(J).threat);
  const res = safe(J, 'spawnRaid', () => game.api.combat.spawnRaid({ points, faction: 'rot_beasts', edge: 'west' }), null);
  if (res) {
    J.S.stats.rotWaves++;
    notify(J, 'journey.rot.wolves', {}, 'danger');
  }
  return !!res;
}

export function rotTick(J) {
  const S = J.S;
  if (S.phase !== 'station' && S.phase !== 'wild') return;
  const game = J.game;
  const now = game.time.tick;
  const R = S.rot;
  if (!R || now < R.deadline) return;
  if (R.level === 0) {
    R.level = 1;
    R.nextLevelAt = now + hours(6);
    R.nextBeastAt = now + hours(4);
    creep(J);
    notify(J, 'journey.rot.arrived', {}, 'danger');
    game.api.av.play('journey_rot', {});
    game.events.emit('journey:rotAdvance', { level: R.level });
    return;
  }
  if (now >= R.nextLevelAt && R.level < 20) {
    R.level++;
    R.nextLevelAt = now + hours(6);
    creep(J);
    game.events.emit('journey:rotAdvance', { level: R.level });
  }
  if (now >= R.nextBeastAt) {
    if (raidActive(J) || !spawnBeasts(J)) R.nextBeastAt = now + hours(1);
    else R.nextBeastAt = now + hours(Math.max(10, 18 - R.level / 2));
  }
}
