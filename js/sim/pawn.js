// Пешка (поселенец, враг, нейтрал). Позиция — дробные координаты клеток (центр клетки = x+0.5).
// Компоненты (объекты-«мешки») заполняют модули: needs, mood, health, skills, traits, inventory, equipment.
// Ядро гарантирует, что эти поля существуют (пустые) у каждой пешки.
import { EVENTS } from '../core/events.js';
import { FACTION } from '../core/constants.js';
import { clamp } from '../core/math.js';

export const NAMES = {
  ru: {
    male: ['Мирон', 'Ярослав', 'Тихон', 'Савва', 'Елисей', 'Глеб', 'Остап', 'Фрол', 'Игнат', 'Любомир', 'Демид', 'Прохор', 'Святогор', 'Ермолай', 'Захар', 'Лука', 'Радим', 'Всеволод'],
    female: ['Злата', 'Милава', 'Ведана', 'Ярина', 'Агния', 'Дарина', 'Любава', 'Есения', 'Марфа', 'Весна', 'Рада', 'Олеся', 'Таисия', 'Устинья', 'Белослава', 'Забава'],
    last: ['Ветров', 'Сажин', 'Горюнов', 'Крапивин', 'Лихой', 'Туманов', 'Стужев', 'Ольхов', 'Пепелов', 'Воронов', 'Брусникин', 'Ковалёв', 'Мхов', 'Зарецкий', 'Полынов', 'Рябинин'],
  },
  en: {
    male: ['Miron', 'Yaroslav', 'Tikhon', 'Savva', 'Elisey', 'Gleb', 'Ostap', 'Frol', 'Ignat', 'Lubomir', 'Demid', 'Prokhor', 'Zakhar', 'Luka', 'Radim'],
    female: ['Zlata', 'Milava', 'Vedana', 'Yarina', 'Agnia', 'Darina', 'Lubava', 'Esenia', 'Marfa', 'Vesna', 'Rada', 'Olesya', 'Taisia', 'Zabava'],
    last: ['Vetrov', 'Sazhin', 'Goryunov', 'Krapivin', 'Likhoy', 'Tumanov', 'Stuzhev', 'Olkhov', 'Pepelov', 'Voronov', 'Kovalev', 'Mkhov', 'Polynov', 'Ryabinin'],
  },
};

/** Неоновые цвета колонистов (лидер — бледно-лиловый со свечением белых кудрей). */
export const PAWN_COLORS = ['#ff4fd8', '#7dff6a', '#ffb347', '#5aa8ff', '#ff5f6d', '#f5ff6a', '#3dffc5', '#c77dff', '#ff8fa3', '#9dffea'];
export const LEADER_COLOR = '#c9b8ff';

/** Фамилии для женщин в ru: простое правило (-ов → -ова, -ин → -ина, -ой → -ая). */
function feminize(last, lang) {
  if (lang !== 'ru') return last;
  if (/(ов|ев|ёв|ин)$/.test(last)) return last + 'а';
  if (/ой$/.test(last)) return last.slice(0, -2) + 'ая';
  if (/ий$/.test(last)) return last.slice(0, -2) + 'ая';
  return last;
}

export function generateName(rng, lang = 'ru', gender = 'male') {
  const t = NAMES[lang] || NAMES.ru;
  const first = rng.pick(gender === 'female' ? t.female : t.male);
  let last = rng.pick(t.last);
  if (gender === 'female') last = feminize(last, lang);
  return `${first} ${last}`;
}

/** Базовые поля пешки. Модули дописывают свои компоненты по событию pawn:spawned. */
export function pawnDefaults(game) {
  return {
    name: '???',
    gender: 'male',
    age: 30,
    isLeader: false,
    faction: FACTION.COLONY,
    controlled: 'ai', // 'ai' | 'player'
    x: 0,
    y: 0,
    dir: 0,
    speed: 4, // клеток/сек
    radius: 0.3,
    color: '#ffffff',
    hairColor: '#e8e2d0',
    path: null,
    pathI: 0,
    pathFailed: false,
    job: null,
    carry: null, // {defId, count}
    asleep: false,
    downed: false,
    drafted: false,
    dead: false,
    moveInput: { x: 0, y: 0 },
    walkPhase: 0,
    moving: false,
    needs: {},
    mood: { value: 0.6 },
    health: { hp: 100, maxHp: 100 },
    skills: {},
    traits: [],
    inventory: { items: [] },
    equipment: {},
    workPriorities: game.jobs.defaultPriorities(),
    light: null,
  };
}

/** Создать пешку. opts переопределяют поля по умолчанию. */
export function createPawn(game, opts = {}) {
  const pawn = game.entities.spawn('pawn', { ...pawnDefaults(game), ...opts });
  game.events.emit(EVENTS.PAWN_SPAWNED, { pawn });
  return pawn;
}

export const isColonist = (p) => p && p.kind === 'pawn' && !p.dead && !p.removed && p.faction === FACTION.COLONY;
export const isAlive = (p) => p && !p.dead && !p.removed;
export const tileOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

/**
 * Проложить путь пешки к клетке. adjacent — встать рядом с целью.
 * @returns {boolean} найден ли путь
 */
export function moveTo(game, pawn, tx, ty, opts = {}) {
  const path = game.pathfinder.findPath(pawn.x, pawn.y, tx, ty, opts);
  pawn.pathFailed = !path;
  if (!path) {
    pawn.path = null;
    return false;
  }
  pawn.path = path;
  pawn.pathI = 0;
  pawn.pathGoal = { x: tx, y: ty, adjacent: !!opts.adjacent };
  return true;
}

export function stopMoving(pawn) {
  pawn.path = null;
  pawn.pathI = 0;
  pawn.moving = false;
}

export function pathDone(pawn) {
  return !pawn.path || pawn.pathI >= pawn.path.length;
}

/** Система движения по пути (порядок 50). Пешки под прямым управлением двигает player-система. */
export function registerPawnSystems(game) {
  game.systems.add({
    id: 'movement',
    order: 50,
    update(game, dt) {
      const map = game.map;
      if (!map) return;
      for (const p of game.entities.ofKind('pawn')) {
        if (p.dead || p.downed) {
          p.moving = false;
          continue;
        }
        if (!p.path || p.pathI >= p.path.length) {
          if (p.controlled !== 'player') p.moving = false;
          continue;
        }
        const node = p.path[p.pathI];
        // если клетка впереди стала непроходимой — перепрокладываем
        if (map.cost[map.idx(node.x, node.y)] <= 0) {
          const g = p.pathGoal;
          if (!g || !moveTo(game, p, g.x, g.y, { adjacent: g.adjacent })) {
            stopMoving(p);
            p.pathFailed = true;
          }
          continue;
        }
        const tx = node.x + 0.5;
        const ty = node.y + 0.5;
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const tileCost = map.cost[map.idx(Math.floor(p.x), Math.floor(p.y))] || 1;
        const speed = p.speed * clamp(game.api.health.moveSpeedFactor(p), 0.05, 3) / Math.max(0.5, tileCost);
        const step = speed * dt;
        if (d <= step) {
          p.x = tx;
          p.y = ty;
          p.pathI++;
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
        }
        if (d > 1e-4) p.dir = Math.atan2(dy, dx);
        p.moving = true;
        p.walkPhase += step * 2.6;
        game.entities.moved(p);
      }
    },
  });
}
