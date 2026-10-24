// A* по сетке клеток (8 направлений, без срезания углов) + регионы связности.
// Стоимость клетки — map.cost (0 = непроходимо; двери проходимы с pathCost).
// Кэш путей и регионы сбрасываются при изменении map.costVersion (реальная смена стоимости/проходимости
// клеток) или при смене карты. Регионы (4-связность) пересчитываются лениво:
// при запрете срезания углов 4-связность = достижимость по 8 направлениям.
import { octile } from '../core/math.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class Pathfinder {
  constructor(game) {
    this.game = game;
    this.n = 0;
    this.mapRef = null;
    this.cache = new Map();
    this.cacheVersion = -1;
    this.regionVersion = -1;
    this.stats = { searches: 0, cacheHits: 0, expanded: 0, failed: 0 };
  }

  _ensure() {
    const map = this.game.map;
    if (!map) return false;
    if (this.mapRef !== map) {
      this.mapRef = map;
      this.cacheVersion = -1;
      this.regionVersion = -1;
    }
    if (this.n !== map.n) {
      this.n = map.n;
      this.g = new Float32Array(map.n);
      this.parent = new Int32Array(map.n);
      this.seen = new Uint32Array(map.n);
      this.closed = new Uint32Array(map.n);
      this.regions = new Int32Array(map.n);
      this.gen = 0;
      this.heapI = new Int32Array(map.n * 4);
      this.heapF = new Float32Array(map.n * 4);
      this.stack = new Int32Array(map.n);
      this.regionVersion = -1;
      this.cache.clear();
    }
    if (this.cacheVersion !== map.costVersion) {
      this.cache.clear();
      this.cacheVersion = map.costVersion;
    }
    return true;
  }

  /** Пересчитать регионы связности, если карта изменилась. */
  _ensureRegions() {
    if (!this._ensure()) return;
    const map = this.game.map;
    if (this.regionVersion === map.costVersion) return;
    this.regionVersion = map.costVersion;
    const reg = this.regions;
    reg.fill(0);
    const w = map.w;
    const h = map.h;
    const cost = map.cost;
    const stack = this.stack;
    let rid = 0;
    for (let s = 0; s < map.n; s++) {
      if (reg[s] || cost[s] <= 0) continue;
      rid++;
      let sp = 0;
      stack[sp++] = s;
      reg[s] = rid;
      while (sp > 0) {
        const i = stack[--sp];
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0) { const j = i - 1; if (!reg[j] && cost[j] > 0) { reg[j] = rid; stack[sp++] = j; } }
        if (x < w - 1) { const j = i + 1; if (!reg[j] && cost[j] > 0) { reg[j] = rid; stack[sp++] = j; } }
        if (y > 0) { const j = i - w; if (!reg[j] && cost[j] > 0) { reg[j] = rid; stack[sp++] = j; } }
        if (y < h - 1) { const j = i + w; if (!reg[j] && cost[j] > 0) { reg[j] = rid; stack[sp++] = j; } }
      }
    }
    this.regionCount = rid;
  }

  /** Номер региона клетки (0 = непроходимая). */
  regionAt(x, y) {
    this._ensureRegions();
    const map = this.game.map;
    if (!map || !map.inBounds(x, y)) return 0;
    return this.regions[map.idx(x, y)];
  }

  /**
   * Достижима ли цель. adjacent=true — достаточно встать рядом (8 соседей) с целью
   * (для работы с деревом/камнем/постройкой, которые сами непроходимы). rw/rh — размер цели.
   */
  canReach(sx, sy, tx, ty, adjacent = false, rw = 1, rh = 1) {
    this._ensureRegions();
    const map = this.game.map;
    if (!map) return false;
    sx = Math.floor(sx);
    sy = Math.floor(sy);
    let rs = this.regionAt(sx, sy);
    if (!rs) {
      // стоим в непроходимой клетке (например, на месте новой стены) — берём соседний регион
      for (const [dx, dy] of DIRS) {
        rs = this.regionAt(sx + dx, sy + dy);
        if (rs) break;
      }
      if (!rs) return false;
    }
    if (!adjacent) return this.regionAt(tx, ty) === rs;
    // клетки вокруг прямоугольника цели (rw×rh) и сама цель
    for (let y = ty - 1; y <= ty + rh; y++)
      for (let x = tx - 1; x <= tx + rw; x++) if (this.regionAt(x, y) === rs) return true;
    return false;
  }

  /**
   * Найти путь. Возвращает массив клеток [{x, y}, ...] (без стартовой) или null.
   * @param {object} [opts]
   * @param {boolean} [opts.adjacent] — цель: любая клетка рядом с (tx, ty) (Чебышёв ≤ 1)
   * @param {number} [opts.w] [opts.h] — размер цели (многоклеточная постройка), для adjacent
   * @param {number} [opts.maxNodes] — ограничение раскрытых узлов
   */
  findPath(sx, sy, tx, ty, opts = {}) {
    if (!this._ensure()) return null;
    const map = this.game.map;
    sx = Math.floor(sx);
    sy = Math.floor(sy);
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    const adjacent = !!opts.adjacent;
    const rw = opts.w || 1;
    const rh = opts.h || 1;
    if (!map.inBounds(sx, sy) || !map.inBounds(tx, ty)) return null;
    // adjacent: любая проходимая клетка на расстоянии ≤ 1 от прямоугольника цели
    const isGoal = adjacent
      ? (x, y) => x >= tx - 1 && x <= tx + rw && y >= ty - 1 && y <= ty + rh
      : (x, y) => x === tx && y === ty;
    if (isGoal(sx, sy)) return [];
    if (!this.canReach(sx, sy, tx, ty, adjacent, rw, rh)) {
      this.stats.failed++;
      return null;
    }
    const key = `${sx},${sy},${tx},${ty},${adjacent ? 1 : 0},${rw},${rh}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.stats.cacheHits++;
      return cached.slice();
    }
    this.stats.searches++;
    const w = map.w;
    const cost = map.cost;
    const gen = ++this.gen;
    if (gen >= 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const g = this.g;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    const heapI = this.heapI;
    const heapF = this.heapF;
    let hs = 0;
    const push = (i, f) => {
      if (hs >= heapI.length) return;
      let p = hs++;
      while (p > 0) {
        const q = (p - 1) >> 1;
        if (heapF[q] <= f) break;
        heapI[p] = heapI[q];
        heapF[p] = heapF[q];
        p = q;
      }
      heapI[p] = i;
      heapF[p] = f;
    };
    const pop = () => {
      const top = heapI[0];
      const li = heapI[--hs];
      const lf = heapF[hs];
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= hs) break;
        if (c + 1 < hs && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heapI[p] = heapI[c];
        heapF[p] = heapF[c];
        p = c;
      }
      heapI[p] = li;
      heapF[p] = lf;
      return top;
    };
    const cx = tx + (rw - 1) / 2;
    const cy = ty + (rh - 1) / 2;
    const slack = adjacent ? 1 + Math.max(rw, rh) / 2 : 0;
    const hx = (x, y) => Math.max(0, octile(cx - x, cy - y) - slack);
    const s = sy * w + sx;
    g[s] = 0;
    seen[s] = gen;
    parent[s] = -1;
    push(s, hx(sx, sy));
    const maxNodes = opts.maxNodes || 30000;
    let expanded = 0;
    let found = -1;
    while (hs > 0) {
      const i = pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      const x = i % w;
      const y = (i - x) / w;
      if (isGoal(x, y)) {
        found = i;
        break;
      }
      if (++expanded > maxNodes) break;
      const gi = g[i];
      for (let d = 0; d < 8; d++) {
        const dd = DIRS[d];
        const nx = x + dd[0];
        const ny = y + dd[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
        const j = ny * w + nx;
        const c = cost[j];
        if (c <= 0 || closed[j] === gen) continue;
        if (d >= 4) {
          // без срезания углов
          if (cost[y * w + nx] <= 0 || cost[ny * w + x] <= 0) continue;
        }
        const ng = gi + dd[2] * c;
        if (seen[j] !== gen || ng < g[j]) {
          seen[j] = gen;
          g[j] = ng;
          parent[j] = i;
          push(j, ng + hx(nx, ny));
        }
      }
    }
    this.stats.expanded += expanded;
    if (found < 0) {
      this.stats.failed++;
      return null;
    }
    const path = [];
    for (let i = found; i !== s; i = parent[i]) {
      const x = i % w;
      path.push({ x, y: (i - x) / w });
    }
    path.reverse();
    if (this.cache.size > 300) this.cache.clear();
    this.cache.set(key, path);
    return path.slice();
  }
}
