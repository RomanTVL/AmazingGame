# «Последний поезд» — архитектура и контракт ядра

Этот документ — **авторитетный контракт** между ядром и модулями (`js/modules/<имя>/index.js`).
Всё, что здесь названо, существует в коде (проверяется `tests/contract.mjs`). Если код и документ расходятся —
это баг; сообщайте, а не обходите.

Дизайн игры — `PLAN.md` (разделы 3 «Лидер и поселенцы», 11 «Управление», 12 «Архитектура»).

---

## 0. Правила для авторов модулей (коротко)

1. **Правьте только свою папку** `js/modules/<имя>/`. Ядро (`js/core`, `js/engine`, `js/sim`, `js/ai`, `js/render`,
   `js/player`, `js/main.js`, `js/modules.js`, `index.html`, `css/`, `tests/`) не трогать — нужен новый хук → просите.
2. **Точка входа** — `export function register(game)` (может быть `async`). Порядок модулей — `js/modules.js` (§2).
3. **Без DOM в `register()`** и в симуляции: headless-тест падает, если тронуть `window`/`document`/`localStorage`.
   DOM/Canvas — только лениво внутри `draw()`/`handleInput()` (они не вызываются в headless).
4. **Расширение — только через** реестры `game.defs.*`, системы `game.systems`/`game.frameSystems`, слои
   `game.render`, UI `game.ui`, ввод `game.input`, сохранения `game.save`, события `game.events`, API `game.provide/api`.
5. **Детерминизм**: в симуляции — только `game.rng` (или `game.rng.fork(label)`), никогда `Math.random`
   (`Math.random` можно в косметике: частицы, тряска, звук).
6. **Состояние — JSON**: всё, что лежит в полях сущностей, `game.train`, `game.colony`, сохраняется автоматически.
   Поля с префиксом `_` — служебные (не сохраняются). Ссылки на сущности — только по `id`.
7. **Межмодульные вызовы** — только `game.api.<ns>.<fn>(...)` в момент вызова (не кешируйте функцию: модуль-владелец
   может переопределить её позже). Цель может быть ещё заглушкой ядра — её поведение описано в §18.
8. **Ошибки не роняют игру**: исключения в системах/слоях/обработчиках событий пишутся в `game.errors`
   (`game.error(err, where)`); тесты падают при `game.errors.length > 0`.
9. **Строки** — через `game.t(key)` с ключами вашего модуля (`'combat.spell.fireball'`), RU обязательно, EN желательно.
10. **Клавиши** — только из таблицы §14 (`js/core/keymap.js`). Новая клавиша — сначала в таблицу.

---

## 1. Структура и запуск

```
index.html, css/style.css       — канвас #game, загрузчик
js/main.js                      — браузер: createGame → input.attach → Renderer → game.newGame → цикл rAF
js/modules.js                   — манифест модулей (порядок регистрации)
js/core/                        — Game, события, реестры, RNG, i18n, настройки, хранилище, сейвы, api, keymap, math, noise
js/engine/                      — ввод, камера, UI (immediate-mode), звук (синтез), частицы, спрайт-кэш
js/sim/                         — карта, генерация, сущности, пешки, работы, предметы/зоны, потребности (заглушка),
                                  поезд, колония (старт/сценарии/наследование), смена стоянки, A*
js/ai/ai.js                     — дерево мыслей (think nodes), системы ai/jobs
js/player/controller.js         — лидер под прямым управлением, взаимодействия E
js/render/                      — рендерер, слои, тайлы-чанки, свет, туман, сущности, пешки, HUD ядра
js/modules/<имя>/index.js       — 10 модулей (сейчас заглушки со спецификацией в JSDoc)
tests/headless.mjs              — N игровых дней в Node + сейв/загрузка + детерминизм + контракт
tests/contract.mjs              — контракт ядра для модулей (быстро, без DOM)
tests/browser.mjs               — дымовой тест в Chromium (Playwright), скриншоты tests/screens/
tests/server.mjs                — статический сервер (node tests/server.mjs --port 8080)
```

Команды:

```
node tests/server.mjs --port 8080                 # играть: http://127.0.0.1:8080/?seed=42&scenario=standard&difficulty=normal
node tests/headless.mjs --days 20 --seed 3        # симуляция + контракт (флаги: --quiet, --no-contract)
node tests/contract.mjs                           # только контракт (~1 с)
node tests/browser.mjs [--seed 42]                # браузерный дым-тест (~90 с)
npm test                                          # headless (10 дней) + browser
```

Модуль считается готовым, когда все три теста зелёные, `game.errors` пуст, `game.input.conflicts` пуст.

---

## 2. Загрузка игры

### 2.1 `createGame(opts)` — `js/core/boot.js`

```js
import { createGame, startNewColony } from './js/core/boot.js';
const game = await createGame({ headless: true, seed: 42 });   // opts: {headless?, seed?, storage?, modules?: false}
```

Порядок (одинаково в браузере и в Node):

1. `new Game(opts)` — шина событий, хранилище, настройки, i18n, RNG, менеджеры (§3);
2. `registerCoreStrings` — строки ядра (ru/en);
3. `registerEngineDefs` — звуки `defs.sfx`, пресеты частиц `defs.fxPresets`, клавиши времени/отладки/Esc, кадровые системы;
4. `registerSim` — ландшафт/полы, предметы/зоны, растения/постройки, биомы, типы вагонов, работы/шаги/пометки,
   переноска, ИИ, потребности (заглушка), движение, колония (сценарии, сложности, наследование, сериализаторы);
5. `registerPlayer` — контроллер лидера, клавиши игрока, взаимодействия E;
6. `registerCoreRender` — слои отрисовки, отрисовщики сущностей, HUD ядра (только регистрация — рисует `main.js`);
7. `registerModules` — модули по манифесту: **vision, mind, health, economy, build, combat, journey, train, ui, av**
   (исключение в `register` пишется как `module:<id>`, модуль не попадает в `game.modules`);
8. `game.init()` — `init(game)` всех систем, событие `game:init`.

Мира после `createGame` ещё нет (`game.map === null`). Его создаёт `game.newGame(opts)` (§4) или загрузка сейва.

### 2.2 Браузер (`js/main.js`)

`createGame({headless: false, seed})` → `game.input.attach(canvas)` → `new Renderer(game, canvas)` (`game.renderer`) →
`game.newGame({seed, scenarioId, difficulty})` из параметров адреса → цикл `requestAnimationFrame`:

```
frame(now):  dtReal = min(0.1, Δt)
  game.frame(dtReal)                         // кадровые системы (ввод, UI, камера, звук, частицы), истечение slowMo
  если !paused: acc += dtReal * game.speed * game.timeScale
                while (acc >= DT && steps < 4) game.step()   // DT = 1/60; тики симуляции
  renderer.frame(dtReal)                     // слои по order
  game.input.endFrame()                      // сброс «нажато в этом кадре»
```

Единственный глобал — `window.__game` (отладка). Исключение внутри кадра не останавливает цикл.

### 2.3 Headless (Node)

Тот же `createGame({headless: true})`; хранилище в памяти; звук и частицы — no-op; рендер-слои регистрируются,
но не рисуются. Тест сам вызывает `game.step()` (тик) и `game.frame(1/60)` (кадровые системы, напр. каждые 4 тика),
затем `game.input.endFrame()`. Виртуальный ввод: `game.input.setKey(code, down)`, `tap(code)`, `setMouseWorld(wx, wy)`.

---

## 3. Объект `Game` (`js/core/game.js`)

| Поле | Что это |
|---|---|
| `isHeadless` | `true` в Node |
| `errors` | `[{where, message, stack}]` (≤ 200; повторы одной ошибки — 3 раза, затем только `errorCounts`) |
| `events` | `EventBus` (§17) |
| `storage` | `getItem/setItem(→bool)/removeItem/keys` (localStorage с запасом в памяти; в Node — память) |
| `settings` | `Settings` (§20.2) |
| `i18n` | `I18n` (§20.1) |
| `seed`, `rng` | сид мира и основной детерминированный ГСЧ (§20.3) |
| `defs` | все реестры определений (§6) |
| `systems`, `frameSystems` | тиковые и кадровые системы (§12) |
| `time` | `Clock` (§5) |
| `map` | `TileMap` текущей стоянки или `null` (§8) |
| `train` | `Train` или `null` (§9) |
| `entities` | `EntityManager` (§7) |
| `pathfinder` | A* + регионы связности (§10.6) |
| `jobs`, `designations` | работы и пометки (§10) |
| `items`, `zones` | предметы и зоны (§11) |
| `ai` | дерево мыслей (§10.5) |
| `colony` | состояние колонии (§4.4), сохраняется |
| `vision` | `{enabled, version, isVisible(tx,ty), isExplored(tx,ty)}` — фасад для рендера; `enabled=false` → тумана нет |
| `log` | журнал уведомлений `[{text, type, tick, day, ...}]` (≤ 500; в сейв идут последние 100) |
| `stats` | `{jobsDone, jobsFailed, ticks}` (числовые поля обнуляются при новой игре) |
| `api`, `providers` | межмодульный API и кто какую функцию предоставил (§18) |
| `save` | `SaveManager` (§19) |
| `input`, `camera`, `ui`, `audio`, `fx`, `render` | движок (§14–16) |
| `player` | `PlayerController` (§13) |
| `speed` (1..3), `paused` | скорость времени |
| `renderer`, `perf` | только в браузере: `Renderer`, `{fps, frameMs, steps}` |
| `initialized`, `modules` | после `init()`; список успешно зарегистрированных модулей |

| Метод | Описание |
|---|---|
| `t(key, vars)` | перевод (§20.1) |
| `error(err, where)` | записать ошибку, не роняя игру |
| `provide(ns, impl, owner)` | переопределить функции API (§18) |
| `newGame(opts)` | новая колония без перезагрузки страницы (§4) |
| `changeStation(opts)` | переезд поезда на новую карту (§9.6) → новая карта |
| `resetWorld(reason)` | очистить мир (вызывают `newGame`/загрузка); шлёт `world:reset` |
| `getScenario()` | `ScenarioDef` текущей колонии или `null` |
| `setSpeed(s)`, `togglePause(v?)`, `speedIndex` | время; шлют `time:speed` |
| `timeScale` (get/set), `slowMo(scale, realMs)`, `slowMoEnd(id)` | темп симуляции (§5.2) |
| `step()` | один тик (1/60 с игрового времени) |
| `frame(dtReal)` | кадровые системы |
| `getLeader()` | живой лидер или `null` |
| `colonists()` | живые пешки фракции `colony` (новый массив) |
| `defOf(e)` | определение сущности из реестра её вида |
| `reseed(seed)`, `setMap(map)`, `init()` | служебные |

---

## 4. Новая игра, сценарии, сложность

### 4.1 `game.newGame(opts)` = `startNewColony(game, opts)` (`js/sim/colony.js`)

Полностью заменяет мир (можно вызывать сколько угодно раз — «Новая игра» из меню, без перезагрузки):

1. выбор сценария (§4.2) → `game.resetWorld('new')` → `world:reset` → `reseed(opts.seed)` (если задан);
2. `game.colony`: `name` (`opts.colonyName` или `t('colony.defaultName')`), `scenarioId`, `difficulty`, `flags` (из сценария);
3. поезд из `consist` и карта первой стоянки (`biome`, `w`, `h`; ширина всегда ≥ длина поезда + 8) → `map:generated`,
   `train:stamped`;
4. лидер (маг, `isLeader: true`, `controlled: 'player'`, `markProgress: 1`, `look` — §4.3), затем спутники;
5. запасы `items` в вагон-склад (неизвестные `defId` пропускаются с одним `console.warn`), серебро `silver`;
6. `scenario.apply(game, opts, ctx)` (исключение → `game.errors`, старт продолжается);
7. событие `colony:started` `{seed, biome, scenarioId, difficulty, opts}`, уведомление-подсказка; камера — к лидеру.

`opts`:

| Поле | Смысл |
|---|---|
| `seed` | число или строка; без него — текущий сид (`game.rng.fork` даст ту же карту) |
| `scenarioId` | id из `game.defs.scenarios`; по умолчанию `'three_survivors'`, если зарегистрирован, иначе `'standard'` |
| `difficulty` | id из `game.defs.difficulties` (важнее `scenario.difficulty`; по умолчанию `'normal'`) |
| `colonyName`, `leaderName`, `leaderGender` | имя колонии, имя/пол лидера (имя генерируется всё равно — поток RNG не зависит от выбора) |
| `look` | внешность лидера `{curls 5..9, curlLen 0.6..1.4, crystal '#hex', scar: bool}` (нормализуется `normalizeLook`) |
| `roster` | `[{name, gender, age, bio, traits, skills, look, role}]` — готовые пешки; запись с `role: 'leader'` — лидер, остальные — спутники (их число заменяет `scenario.colonists`) |
| `biome`, `w`, `h`, `colonists`, `consist`, `items`, `silver` | переопределить поля сценария |
| любые другие | передаются в `scenario.apply(game, opts, ctx)` и в `colony:started` |

**Обработчики `pawn:spawned` не должны перезаписывать заранее заполненные `bio`/`traits`/`skills`/`look`** (из `roster`) —
только дополнять недостающее (`pawn.bio ??= ...`).

### 4.2 `game.defs.scenarios` — ScenarioDef (sortBy `order`)

| Поле | Тип | Смысл |
|---|---|---|
| `id`, `nameKey`, `descKey`, `order` | | для экрана новой игры |
| `difficulty` | `'easy'\|'normal'\|'hard'\|'brutal'` | оценка сценария и сложность по умолчанию |
| `rerolls` | 0..3 | сколько перебросов состава даёт UI (данные для ui) |
| `colonists` | число | спутников кроме лидера (по умолчанию 4) |
| `consist` | `string[]` | типы вагонов с хвоста к голове, **локомотив последним** |
| `items` | `[[defId, count], ...]` | стартовые запасы |
| `silver` | число | предмет `'silver'` (если его зарегистрировал economy), иначе `game.colony.silver` |
| `rotGapHours` | число | фора до Гнили (читает journey) |
| `engine` | `'steam'\|'rune'` | тип двигателя (читает train) |
| `flags` | объект | сливается в `game.colony.flags` |
| `biome`, `w`, `h` | | первая стоянка |
| `leader` | объект | поля лидера поверх стандартных (`{mage: false}` для «Наследника поневоле») |
| `colonist(game, i, rng)` | функция → объект | поля i-го сгенерированного спутника |
| `apply(game, opts, ctx)` | функция | после карты, поезда, пешек и запасов, до `colony:started`; `ctx = {scenario, map, train, leader, colonists, rng}` |

Ядро регистрирует только `'standard'` (order 1000) — прежний старт: лидер + 4 спутника, состав
`workshop, storage, kitchen, residential, locomotive`, `STARTING_ITEMS`, `engine: 'rune'`.
Настоящие сценарии («Трое выживших» `three_survivors` — по умолчанию, «Голый одиночка», «Наследник поневоле»…)
регистрирует **модуль train**. Экспорт: `DEFAULT_SCENARIO`, `CORE_SCENARIO`, `CORE_SCENARIOS`, `STARTING_ITEMS`,
`resolveScenario(game, id)`, `normalizeLook(look)`, `DEFAULT_LEADER_LOOK`.

### 4.3 Сложность — `game.defs.difficulties` (sortBy `order`)

`{id, nameKey, descKey, order}`: `easy` (Мирный), `normal` (Обычный), `hard` (Тяжёлый), `brutal` (Жестокий).
Выбранная — `game.colony.difficulty`. Числовые параметры добавляет journey: `game.defs.difficulties.extend('hard', {threat: 1.5})`.

### 4.4 `game.colony` (сохраняется сериализатором `meta`)

```js
{ leaderId, heirId, name, lost, scenarioId, difficulty,
  authority: 50,   // 0..100, авторитет лидера (mind: getAuthority/addAuthority)
  memory: 10,      // 0..100, «память» о павших (health: getMemory/addMemory)
  flags: {},       // флаги сценария/сюжета
  objectives: {},  // цели HUD (ui.setObjective) — {id: {text, ...opts}}
  silver?          // только если сценарий дал серебро, а предмета 'silver' нет
}
```

Модули могут добавлять свои поля (JSON) — они сохраняются. Фабрика: `createColonyState()` (`js/core/game.js`).

---

## 5. Время

### 5.1 Часы — `game.time` (`Clock`, `js/sim/time.js`)

Константы (`js/core/constants.js`): `TPS = 60`, `DT = 1/60`, `TICKS_PER_HOUR = 600` (10 с реального времени на 1×),
`HOURS_PER_DAY = 24`, `TICKS_PER_DAY = 14400` (4 мин на 1×), `MAX_STEPS_PER_FRAME = 4`, `SPEEDS = [0, 1, 2, 3]`;
`DAYS_PER_SEASON = 15` (`js/sim/time.js`). Игра начинается в 07:00 дня 1.

`tick`, `startHour`, `totalHours`, `day` (с 1), `hour` (дробный), `hourInt`, `minute`, `daylight` (0 ночь .. 1 день;
рассвет 4–7, закат 18–21), `nightFactor`, `isNight()` (21–5), `isSleepTime()` (22–6), `season`
(`'spring'|'summer'|'autumn'|'winter'`), `seasonIndex`, `clockString()`, `setHour(h)` (отладка), `Clock.hours(h)` → тики,
`reset()`. События `time:hour` `{day, hour}`, `time:day` `{day}`.

Скорость: `game.speed` 1..3, `game.paused`; `game.setSpeed(s)` снимает паузу; `game.togglePause(v?)`. Клавиши — §14.

### 5.2 Темп симуляции и замедление — `game.timeScale`, `game.slowMo`

`game.timeScale` = базовый масштаб (сеттер, 0..8, по умолчанию 1) × самое сильное активное замедление.
Главный цикл браузера делает `acc += dtReal * speed * timeScale`, т.е. замедляет **только тики**; кадровые системы,
UI, камера, анимации слоёв идут в реальном времени. Частицы тоже замедляются.

```js
const id = game.slowMo(0.25, Infinity);  // колесо приказов (vision): до slowMoEnd
game.slowMoEnd(id);
game.slowMo(0.05, 60);                   // «хит-стоп» (combat/av): истекает сам через 60 реальных мс
game.slowMo(0.3, 600);                   // последний рейдер
```

Одновременные запросы не складываются — действует минимальный `scale` (0..1, 0 = стоп-кадр). Истечение считается
в `game.frame(dtReal)`. Новая игра/загрузка сбрасывают все замедления. **В headless ни на что не влияет** —
детерминизм симуляции от замедлений не зависит.

---

## 6. Реестры определений — `game.defs.*`

Реестр (`Registry`, `js/core/registry.js`): `add(def, owner)` (повтор id — ошибка, если не `def.override: true`),
`addAll(defs, owner)`, `extend(id, patch)` (дописать поля чужой записи), `remove(id)`, `get(id)`, `require(id)`,
`has(id)`, `all()` (не мутировать), `ids()`, `filter(fn)`, `find(fn)`, `size`, `byIndex(i)` (индексные реестры),
`onAdd(fn)`. Каждая запись получает `owner`. Новый реестр: `game.defs.create(name, {defaults, indexed, sortBy, validate})`
(возвращает существующий, если уже создан). Список: `game.defs.names()`.

| Реестр | Кто создаёт | Ключевые поля (схема ниже) |
|---|---|---|
| `terrain` (indexed) | ядро | `{id, nameKey, cost (0 = непроходимо), buildable, fertile, water?}` |
| `floors` (indexed; 0 = нет пола) | ядро | `{id, nameKey, cost, materials?, workToBuild?, train?, bridge?, paint?(ctx, px, py, x, y, map, game)}` |
| `items` | ядро | ItemDef §6.3 |
| `zoneTypes` | ядро | `{id, nameKey, color, storage: bool}` |
| `plants` | ядро | PlantDef §6.2 |
| `buildings` | ядро | BuildingDef §6.1 |
| `biomes` | ядро | `{id, nameKey, palette, gen, generate?(game, map, rng, opts)}` (§8.3) |
| `wagonTypes` | ядро | WagonTypeDef §9.2 |
| `workTypes` (sortBy order) | ядро | `{id, nameKey, order, skill, defaultPriority}` (§10.1) |
| `jobTypes` | ядро | JobTypeDef §10.2 |
| `toils` | ядро | ToilDef §10.3 |
| `designations` | ядро | `{id, nameKey, color, glyph, jobType, valid(game, x, y) → targetId\|0, draw?}` (§10.4) |
| `interactions` (sortBy order) | ядро | `{id, order, find(game, pawn, tx, ty) → {...}\|null, hold?, onHoldStart?, onHoldTick?, onRelease?}` (§13.2) |
| `sfx` | ядро | `{id, layers, cooldown?, jitter?, vol?}` (§15.8) |
| `fxPresets` | ядро | `{id, emit(fx, x, y, opts)}` (§15.7) |
| `scenarios` (sortBy order) | ядро (`standard`), train | ScenarioDef §4.2 |
| `difficulties` (sortBy order) | ядро, journey дополняет | `{id, nameKey, descKey, order, ...}` |

Ожидаемые реестры модулей (создают сами через `game.defs.create`): `thoughts`, `traits`, `skills` (mind);
`bodyParts`, `conditions` (health); `recipes` (economy); `enemies` (combat); `incidents` (journey).
Схемы — в JSDoc заглушек модулей.

### 6.1 BuildingDef (`BUILDING_DEFAULTS`, `js/sim/content.js`)

| Поле | По умолчанию | Смысл |
|---|---|---|
| `id`, `nameKey`, `color` | | `color` — неон отрисовщика по умолчанию |
| `size` | `[1, 1]` | `[w, h]` в клетках; `rot` 1/3 меняет местами (`entities.footprintSize`) |
| `rotatable` | `false` | |
| `passable`, `pathCost` | `false`, `1` | непроходимо → `map.cost = 0`; проходимо → cost ≥ `pathCost` |
| `blocksVision`, `blocksLight` | `false` | слои `map.blocksVision/blocksLight` (vision; свет) |
| `door` | `false` | дверь: проходима (`passable: true`), отрисовщик `wagon_door` анимирует; vision считает открытой при пешке рядом |
| `bed`, `restEffect` | `false`, `1` | кровать (ИИ сна ищет `def.bed`; владелец — `e.ownerId`); множитель отдыха |
| `storage` | `false` | на клетке можно хранить предметы, хотя она непроходима (стеллаж) |
| `light` | `null` | `{radius (клетки), color, intensity 0..1, flicker?}` — свет ночью (§15.5) |
| `hp`, `materials`, `workToBuild` | `100`, `{}`, `100` | для build |
| `placeableOn` | `'both'` | `'wagon'` (в вагоне: `roof>0 && room>0`), `'ground'`, `'both'` — проверяет `api.build.canPlace` |
| `category` | `'misc'` | `structure\|furniture\|production\|light\|security\|storage\|misc\|natural\|train` |
| `buildable` | `true` | показывать в меню стройки |
| `natural`, `mineable`, `yield`, `workToMine` | | скалы/жилы (`mine`) |
| `indestructible` | `false` | |
| `bake` | `false` | статично запекать в кэш тайлов (стены, скалы) — см. §15.4 |
| `connects` | | группа связности стен (`'wall'`) для `paintWall` |
| `window` | | окно (рисуется светящимся) |
| `draw(ctx, e, game, view, def)`, `drawEmissive(ctx, e, game, view, alpha, def)` | | свой отрисовщик (§15.3) |
| `paintBaked(ctx, px, py, e, game, def)` | | отрисовка в кэш тайлов при `bake: true` |
| `vision` | | соглашение vision: `{radius}` — источник обзора (камера-глаз, вышка) |

Ядро: `rock`, `ore_iron`, `mana_vein` (natural), `wagon_wall`, `wagon_window`, `wagon_door`, `mana_engine` (train).

### 6.2 PlantDef (`PLANT_DEFAULTS`)

`blocksMove` (false), `blocksVision` (false), `pathCost` (1), `choppable` (false), `yield` (при рубке, `{wood: 22}`),
`harvestYield` (при сборе — растение остаётся, `growth → 0`), `regrowHours` (48), `workToCut` (200),
`workToHarvest` (120), `biomes` (`['forest']`), `light` (null), `bake` (true), + `nameKey`, `color`, `canopy` (радиус
кроны в клетках), `draw?`. Сущность: `growth` 0..1 (система `plants` раз в час), `variant` 0..7.
Ядро: `tree_pine`, `tree_birch`, `tree_oak`, `bush_berry`, `glowcap`.

### 6.3 ItemDef (`CORE_ITEMS`, `js/sim/items.js`)

`{id, nameKey, category ('resource'|'food'|'medicine'|'material'|'fuel'|'weapon'|'misc'|...), stackLimit (75), value (1),
nutrition? (0..1 за единицу), foodKind? ('raw'|'meal'|'preserved' → мысли ate_raw/ate_meal/ate_ration),
medicine? {potency}, color, icon ('logs'|'stone'|'ore'|'crystal'|'berries'|'meat'|'box'|'meal'|'cross'|'bag'|любой → ящик),
glow? (светится ночью), haulable? (false — не носить на склад)}`. Модули добавляют поля (`weapon: {...}` и т.п.).
Ядро: `wood, stone, iron_ore, mana_crystal, berries, meat_raw, ration, meal_simple, medicine_herbal, cloth`.
Серебро (`'silver'`) регистрирует economy.

---

## 7. Сущности (`js/sim/entities.js`)

Сущность — простой JSON-объект `{id, kind, defId?, x, y, ...компоненты}`. Поля `_*` не сохраняются; ссылки — по id.

### 7.1 Виды (kinds)

| kind | индекс | defs | примечания |
|---|---|---|---|
| `pawn` | динамичный (чанки) | — | transient: `job, path, pathI, pathGoal, moveInput, workProgress` |
| `item` | клетка | `items` | одна стопка на клетку: `{defId, count, forbidden}` |
| `building` | клетки footprint | `buildings` | `{defId, rot, w, h, hp}` + флаги ниже |
| `plant` | клетка | `plants` | `{defId, growth, variant}` |
| `corpse` | клетка | — | `{pawnId, name, color, faction, wasLeader, diedTick, cause, rot}` |
| `projectile` | динамичный | — | не сохраняется |
| `decal` | клетка | — | `{color, alpha, r, ox, oy, a}` (кровь и т.п.) |

Свой вид: `game.entities.registerKind(id, {static, defs, transient: [...], saved, restore(e)})`.

Флаги построек ядра: `train` (постройка поезда — пересоздаётся при stamp), `carIndex`, `carId`, `fixture`, `tint`
(неон вагона), `gangway` (переход), `natural`, `blueprint` (запасной отрисовщик рисует пунктир), `ownerId` (кровать).

### 7.2 Пешка (`pawnDefaults`, `createPawn`, `js/sim/pawn.js`)

Позиция — дробные клетки (центр клетки = `x + 0.5`). Базовые поля:
`name, gender, age, isLeader, faction ('colony'|'enemy'|'neutral'), controlled ('ai'|'player'), x, y, dir, speed (кл/с),
radius, color, hairColor, path, pathI, pathFailed, job, carry ({defId, count}|null), asleep, downed, drafted, dead,
moveInput, walkPhase, moving, needs {food, rest, ...}, mood {value}, health {hp, maxHp}, skills {}, traits [], inventory
{items: []}, equipment {}, workPriorities {workType: 0..4}, light ({radius, color, intensity, flicker}|null)`;
у лидера `mage: true`.

**Соглашения о полях модулей** (JSON, сохраняются; значения по умолчанию ставит ядро, где указано):

| Поле | Владелец | Смысл |
|---|---|---|
| `pose` (`'idle'`), `poseUntil` (0), `faceId` (0) | sim-модули ставят, av рисует | `'idle'\|'sit'\|'sleep'\|'talk'\|'shovel'\|'carry'\|'carried'\|'hug'\|'toast'\|'pet'\|'window'\|'dying'\|'limp'\|'hop'`; срок в тиках; к кому лицом |
| `soot` (0) | journey/train | копоть 0..1 |
| `markProgress` (лидер 1, иначе 0) | mind/av | белая кудрявая метка 0..1 |
| `perks` ({}) | combat | перки |
| `look` ({}; у лидера `{curls, curlLen, crystal, scar}`) | ui/сценарий | внешность |
| `nameless` | combat | безымянный |
| `dream`, `inspiration` | mind | сон, вдохновение |
| `dying` `{untilTick}` | health | умирает |
| `naked` | сценарий | без одежды |
| `bio`, `relations`, `schedule` | mind | биография, отношения `{[id]: {kind, opinion}}`, расписание |
| `mana`, `order`, `role`, `drawAs` | combat / vision / ui / av | мана; текущий приказ; роль из roster; id отрисовщика (`render.defDrawers`) |

Помощники: `createPawn(game, opts)` (шлёт `pawn:spawned`), `generateName(rng, lang, gender)`, `moveTo(game, pawn, tx, ty,
{adjacent, w, h})` → bool, `stopMoving(pawn)`, `pathDone(pawn)`, `isColonist(p)`, `isAlive(p)`, `tileOf(p)`,
`sanitizePosition(game, p)` (страховка от NaN), `NAMES`, `PAWN_COLORS`, `LEADER_COLOR`.
Компоненты (needs, mood, skills…) модули заполняют на `pawn:spawned`, **не перезаписывая готовое**.

### 7.3 API `game.entities`

| Метод | Описание |
|---|---|
| `spawn(kind, props)` | создать (шлёт `entity:spawned`); статичные округляются до клетки; нечисловая позиция → `game.error` |
| `remove(e, reason)` | удалить (шлёт `entity:removed` `{entity, reason}`); пометки на цели снимаются |
| `setPosition(e, x, y)` | переместить тот же объект (переиндексация; шлёт `entity:moved`; пометки переезжают) |
| `moved(e)` | после пошагового движения динамичной сущности (обновить чанк) |
| `detach(e)`, `attach(e, {movedFrom?})` | служебное: снять/вернуть без удаления (перенос поезда) |
| `get(id)`, `ofKind(kind)` (итератор, можно удалять во время обхода), `listKind(kind)` (копия), `countKind`, `count` | |
| `defOf(e)` | def из реестра вида |
| `atTile(x, y, kind?)`, `firstAtTile` | сущности на клетке (постройки — по любой клетке footprint; без kind — ещё и пешки) |
| `queryRect(x0, y0, x1, y1, kind?, out?)` | в прямоугольнике клеток (включительно); постройки ищутся с запасом 4 клетки от начала |
| `queryRadius(x, y, r, kind?, filter?, out?)` | по центрам |
| `center(e)`, `footprintSize(def, rot)` | |
| `relocate(e, x, y)` | устарело (пересоздаёт объект) — используйте `setPosition` |

---

## 8. Карта (`TileMap`, `js/sim/map.js`)

### 8.1 Слои (типизированные массивы, индекс `map.idx(x, y) = y * w + x`)

| Слой | Тип | Смысл |
|---|---|---|
| `terrain` | Uint8 | индекс `defs.terrain` |
| `floor` | Uint8 | индекс `defs.floors` (0 — нет) |
| `flags` | Uint8 | `TILE_FLAG.RAIL = 1`, `TILE_FLAG.RAIL_RUNE = 2` |
| `roof` | Uint8 | 0 — нет; 1 — крыша вагона; 2 — построенная крыша (соглашение build) |
| `room` | Int32 | 0 — улица; вагоны: `TRAIN_ROOM_BASE (10000) + car.id`; комнаты на земле (build) — 1..9999 |
| `building`, `plant` | Int32 | id сущности на клетке |
| `cost` | Float32 | производное: множитель времени шага, 0 = непроходимо |
| `blocksVision`, `blocksLight` | Uint8 | производное (постройки/растения) |

Также `w, h, n, biome, railY` (ряд рельсов).

### 8.2 API

`idx, inBounds, terrainDef(x, y), floorDef(x, y), setTerrain(x, y, id), setFloor(x, y, id|null), setRoof, setRoom,
hasFlag, setFlag(x, y, f, on), refresh(x, y), touch(x, y, w, h), batch(fn), recomputeAll(), isPassable, costAt, isRoofed,
roomAt, buildingAt, plantAt, chunkOf, randomPassableNear(rng, x, y, r, tries, pred)`. Сеттеры вне карты — no-op.

Версии: `map.version` растёт при любом `touch` (кэши отрисовки/видимости); `map.costVersion` — только когда реально
изменился `map.cost` (кэш A* и регионы). `touch`/`batch` шлют `map:changed` `{x, y, w, h}` (batch — одно событие).

### 8.3 Генерация — `generateStation(game, {biome, w, h, stationIndex, railY})` (`js/sim/worldgen.js`)

Создаёт карту, ставит `game.setMap(map)`, рельсы по всей ширине, шлёт `map:generated` `{map, biome}`.
Сид: `game.rng.fork('world:<biome>:<stationIndex>')`. BiomeDef: `{id, nameKey, palette: {bg, terrain: {<id>: {base, alt,
speck, tuft, edge?}}, rail, rune, fog, nightTint}, gen: {trees, treeDensity, bushDensity, glowcapDensity, waterLevel,
rockLevel, oreChance, manaChance, railClear}, generate?(game, map, rng, opts)}` — `generate` полностью заменяет
стандартный генератор (journey: пустоши, пики, руины).

---

## 9. Поезд (`js/sim/train.js`, `js/sim/station.js`)

### 9.1 Модель данных — простые JSON-данные в `game.train`

```js
game.train = {
  cars: [{ id, index, type, rect: {x, y, w, h} | null, roomId, fixtures: [], data: {} }, ...], // хвост (запад) → голова (восток)
  nextCarId, railY, x0, stamped,
  data: {},          // мешок модулей: train.data.train = {...}, train.data.journey = {...}
  // + любые поля модулей: train.engine, train.fuel, train.pressure ... — сохраняются автоматически
}
```

`Train.serialize()` сохраняет **все собственные поля**, кроме `game` и полей с `_`; у вагонов — все поля, кроме `_*`.
Значит модуль может просто писать `game.train.fuel = 40` или `car.upgrades = ['boiler']` — после загрузки они на месте.
`car.id` стабилен (не меняется при вставке вагонов) — ключуйте данные по нему; `car.index` — текущая позиция.
Ядро владеет полями `cars, nextCarId, railY, x0, stamped` и `rect/roomId/index` вагонов — не пишите в них.

### 9.2 WagonTypeDef — `game.defs.wagonTypes`

`{id, nameKey, length (клеток со стенами; по умолчанию 12), color, light, locomotive?, stockpile?, fixtures?: [{defId, dx,
dy, rot?, props?}]}`. Высота вагона `CAR_HEIGHT = 7` (внутри 5 рядов). Ядро: `locomotive` (10, фикстура `mana_engine` в
(6, 2)), `residential, kitchen, storage` (склад: зона по умолчанию), `workshop, greenhouse, infirmary, battle, hearse` (10).
Неизвестный тип (старый сейв) рисуется запасным определением, не падает. Train добавит `tender`, `salon`.

### 9.3 API `game.train`

| Метод/поле | Описание |
|---|---|
| `carDef(car)`, `length`, `locomotive`, `carById(id)`, `carAt(x, y)`, `carOfType(type)`, `interior(car)` → `[{x, y}]`, `center()` | запросы |
| `addCar(type, {index?, position?: 'tail'\|'head', data?, restamp?})` | вставить вагон (по умолчанию — перед локомотивом); шлёт `train:carAdded` `{train, car}` |
| `removeCar(car\|index, {restamp?})` | отцепить; шлёт `train:carRemoved`; содержимое остаётся лежать на карте |
| `restamp()` | переложить поезд на той же карте: **содержимое вагонов (мебель, предметы, трупы, пешки) и зоны внутри вагонов едут со своим вагоном**; задачи пешек отменяются |
| `stamp(railY, x0, {zones?})` | поставить на карту (x0 сдвигается, чтобы влезть); расчистка полосы: растения и постройки сносятся, предметы рассыпаются рядом, трупы/пешки сдвигаются на проходимую клетку; шлёт `train:stamped` |
| `unstamp()` | снять (постройки `train: true`, пол/крыша/комнаты вагонов, зоны `data.train`); шлёт `train:unstamped` |
| `fixturesOf(car)` | `def.fixtures` типа + `car.fixtures` (при `car.replaceFixtures = true` — только свои) |
| `captureContents(filter?)` → `[{entity, carId, dx, dy}]`, `captureZones()`, `restoreZones(list)` | служебное (restamp/changeStation) |
| `nudgePawns()`, `lights()`, `invalidateLights()` | служебное |

Экспорт: `CORE_WAGON_TYPES`, `DEFAULT_CONSIST`, `CAR_HEIGHT`, `TRAIN_ROOM_BASE`, `nearestPassable(map, x, y)`.

### 9.4 Хуки для модуля train (локомотив, котёл, вагоны)

* **Своё состояние** — поля на `game.train`/`car` (§9.1); инициализация на `colony:started` (тип двигателя —
  `game.getScenario()?.engine`), сброс runtime-кэшей на `world:reset`.
* **Купить вагон**: `game.train.addCar('tender', {restamp: true})` → `train:carAdded` → `train:stamped`.
* **Постройка в локомотиве** (топка, котёл, регулятор): зарегистрируйте `BuildingDef` (category `'train'`) и добавьте
  фикстуру: всем локомотивам — `game.defs.wagonTypes.extend('locomotive', {fixtures: [...]})`; одному вагону —
  `car.fixtures.push({defId: 'boiler', dx: 3, dy: 1})`; заменить двигатель — `car.replaceFixtures = true;
  car.fixtures = [{defId: 'steam_engine', dx: 6, dy: 2}]` — затем `game.train.restamp()`.
  Фикстуры (`train: true, fixture: true, carId`) **пересоздаются при каждом stamp** — состояние держите в `train`/`car`.
* Альтернатива — спавнить свои постройки с `train: true` в обработчике `train:stamped` (их снимет `unstamp`).
* Свет вагонов: `train.lights()` (кэш; после ручных правок — `invalidateLights()`), свои источники — §15.5.

### 9.5 Комнаты и зоны вагонов

`map.room` вагона = `TRAIN_ROOM_BASE + car.id`, `map.roof = 1`, пол `wagon_planks`. Вагон-склад получает зону
`stockpile` с `data: {carIndex, carId, train: true}`; фильтры/приоритет зон внутри вагонов переживают `restamp` и
`changeStation`.

### 9.6 Смена стоянки — `game.changeStation(opts)` (`js/sim/station.js`)

Низкоуровневая операция для journey (КОГДА ехать решает journey):

```js
game.changeStation({ biome: 'ash', stationIndex: 5 /*, w, h, x0, railY, boardAll = true, carry: [...], filter */ });
```

Уезжает: всё внутри вагонов (кроме врагов — `opts.filter(e) → false` исключает) + все живые поселенцы
(`boardAll`; стоящие снаружи «садятся» на свободные клетки, сперва жилых вагонов) + `opts.carry`. Остальное (лагерь,
деревья, враги снаружи, пометки, резервы) исчезает. Задачи отменяются (груз в руках остаётся), id сущностей не
переиспользуются. Порядок событий: `world:reset` `{reason: 'station'}` → `map:generated` → `train:stamped` →
`entity:spawned` (для перевезённых) → `station:changed` `{map, train, carried, opts}`. Время не сдвигается.

---

## 10. Работы, задачи, ИИ (`js/sim/jobs.js`, `js/ai/ai.js`)

### 10.1 Типы работ — столбцы таблицы приоритетов

`game.jobs.registerWorkType({id, nameKey, order, skill, defaultPriority}, owner)`. Ядро: `doctoring(10), construction(20),
mining(30), cutting(40), growing(50), cooking(60), hunting(70), crafting(80), hauling(90), cleaning(100), research(110)`.
`skill` — id навыка mind (`medicine, construction, mining, plants, cooking, shooting, crafting, intellect` или null).
Приоритет пешки: `pawn.workPriorities[wt]` 0 (не делает), 1 (высший) … 4; `game.jobs.getPriority(pawn, wt)`,
`setPriority(pawn, wt, v)` (шлёт `work:priority`), `defaultPriorities()`.

### 10.2 Виды задач — JobTypeDef

```js
game.jobs.registerJobType({
  id: 'construct', workType: 'construction',   // null — служебная (еда, сон, прогулка)
  labelKey: 'build.job.construct', priority: 50, adjacent: true,
  findTargets(game, pawn) { /* итерируемое {x, y, targetId?, data?} */ },  // ИЛИ findJob(game, pawn) → spec|null
  canDo(game, pawn, spec) { return true; },
  makeToils(game, pawn, job) { return [{ type: 'goto', targetId: job.targetId, adjacent: true }, { type: 'work', ticks: 300, ... }]; },
  reserve(game, pawn, job) { return [resKey.entity(job.targetId)]; },  // по умолчанию e<targetId>
  failIf(game, pawn, job) { return false; },   // проверка каждый тик
  onEnd(game, pawn, job, result) {},           // 'done'|'failed'|'cancelled'
}, 'build');
```

Поиск: `findWork(pawn)` перебирает уровни 1..4 и типы работ по `order`, внутри — виды задач по убыванию `priority`;
`tryJobType` берёт ближайшие цели (до 24 проверок), отсекая зарезервированные и недостижимые (`pathfinder.canReach`).
Объект задачи (runtime, **не сохраняется**): `{id, type, workType, pawnId, targetId, x, y, data, priority, manual, toils, i,
startedTick, reserved, keepCarry?}`. API: `createJob(typeId, pawn, spec)`, `startJob(pawn, job)` → bool,
`endJob(pawn, result)`, `startManual(pawn, typeId, spec)` (ручная работа лидера, priority 100; WASD её отменяет),
`tickPawn`, `jobTypesFor(wt)`. Резервы: `resKey.entity(id)`, `resKey.cell(x, y)`, `isReserved/reserve/release/releaseAll`.
При `result !== 'done'` груз в руках бросается, если не `job.keepCarry`.
Фабрика «работа над вещью по пометке»: `thingWorkJob({id, workType, designation, labelKey, fx, kind, workTicks(def, t),
canTarget(game, t), complete(game, pawn, target), priority})`. Готовые действия: `cutPlant(game, plant, pawn, harvestOnly)`,
`mineThing(game, thing, pawn)`.

Ядро: `chop, harvest, mine` (по пометкам), `haul` (на склад), `eat`, `sleep` (needs), `flee`, `wander`, `wait`, `goto`,
`player_pickup`, `player_drop`.

### 10.3 Шаги — ToilDef

`game.jobs.registerToil({id, start?(game, pawn, toil, job) → 'done'|'failed'|void, tick(game, pawn, toil, job, dt) →
'running'|'done'|'failed', end?(game, pawn, toil, job, result)})`. Мгновенные шаги проходят в том же тике.

| Шаг | Параметры |
|---|---|
| `goto` | `{x?, y?, targetId?, adjacent?}` — явные x/y шага важнее targetId задачи (`toilTargetId`) |
| `wait` | `{ticks}` |
| `work` | `{ticks, workType?, targetId?, x?, y?, fx?, onDone(game, pawn, job, toil) → 'failed'?, onTick?}` — скорость = `health.workSpeedFactor × mind.skillFactor` (×1.25 у лидера); шлёт `work:hit` для звука/частиц |
| `pickup` | `{targetId, count}` (рядом с предметом) |
| `drop` | `{x?, y?}` |
| `interact` | `{fn(game, pawn, job, toil) → 'done'\|'failed'\|'running'}` |
| `sleep` | (needs) отдых до утра/бодрости |

### 10.4 Пометки — `game.designations`

`registerType({id, nameKey, color, glyph ('axe'|'pick'|'hand'|...), jobType, valid(game, x, y) → targetId|0, draw?(ctx, d, game,
view)}, owner)`; `add(type, x, y)`, `remove(type, x, y)`, `addRect(types, x0, y0, x1, y1)` (для каждой клетки — первый
подходящий тип), `removeRect`, `get/has(type, x, y)`, `forTarget(id)`, `ofType(type)`, `count(type?)`, `removeTargetType`.
Пометки — для **статичных** целей (ключ — клетка); удаление цели снимает пометки, `setPosition` их переносит.
Ядро: `chop`, `harvest`, `mine`; временный инструмент ядра — C + перетаскивание (§13).

### 10.5 Дерево мыслей — `game.ai`

```js
game.ai.registerThinkNode({
  id: 'order', priority: 85, interrupts: true, factions: ['colony'],
  evaluate(game, pawn, ctx /* {interrupt} */) { return pawn.order ? game.jobs.createJob('goto', pawn, {...}) : null; },
  override: false,                 // true — заменить узел с тем же id
}, 'vision');
```

Пешка без задачи перебирает узлы по убыванию `priority`; первый вернувший задачу побеждает (её priority поднимается до
priority узла). Узлы с `interrupts` раз в 30 тиков (`(tick + id) % 30 === 0`) могут прервать задачу с меньшим
priority. Пешки с `controlled === 'player'` ИИ не трогает. Неудача → пауза размышлений 20+ тиков.
Ядро: `flee` 95 (interrupts; colony, neutral), `eat` 90 (interrupts), `sleep` 80, `work` 50, `wander` 10 (все фракции).
Резервирование приоритетов узлов модулей: `mentalBreak` 99, `callToArms` 97 (combat), `order` 85 (vision).
`removeThinkNode(id)`, `getNode(id)`, `think(pawn, interrupt)`.

### 10.6 Потребности (заглушка ядра `js/sim/needs.js`) и путь

`pawn.needs.food/rest` 0..1; система `needs` (order 20) — mind может отключить `game.systems.setEnabled('needs', false)`
и переопределить узлы `eat`/`sleep` (`override: true`), переиспользуя задачи `eat`/`sleep` и шаг `sleep`.
Экспорт: `NEEDS`, `makeEatJob(game, pawn)`, `makeSleepJob(game, pawn)`. Ядро зовёт мысли `ate_raw, ate_meal, ate_ration,
slept_on_floor, slept_in_bed, hungry, starving, exhausted` и `health.applyDamage(p, 1, {type: 'starvation'})` раз в час при
голоде.

Путь: `game.pathfinder.findPath(sx, sy, tx, ty, {adjacent, w, h, maxNodes})` → `[{x, y}]` (без старта) | `null`;
`canReach(sx, sy, tx, ty, adjacent, w, h)` — O(1) по регионам связности; `regionAt(x, y)`; 8 направлений без срезания
углов. Пешки: `moveTo(...)`, система `movement` (order 50) перепрокладывает путь, если клетка впереди стала непроходимой.

---

## 11. Предметы и зоны (`js/sim/items.js`)

`game.items`: `def(defId)`, `itemAt(x, y)`, `canHoldItems(x, y)`, `roomAt(defId, x, y)`, `spawn(defId, count, x, y,
{forbidden})` (сливает со стопками, рассыпает по спирали ≤ 8 клеток) → затронутые стопки, `take(item, n)` → взято,
`pickUp(pawn, item, count)`, `dropCarried(pawn, x?, y?)`, `count(defId, {storedOnly})`, `totals()` → Map,
`isStored(item)`, `consume(cost, nearX, nearY)` (всё или ничего), `findNearest(pawn, filter(item, def), {allowForbidden,
maxDist})`. События `item:changed`, `item:picked`, `item:dropped`.

`game.zones`: `create(type, cells ([[x, y]] | idx[]), {id?, name, color, priority 1..4, filter: {categories?, items?, deny?},
data})`, `addCells`, `removeCells`, `remove(zone)`, `zoneAt(x, y)`, `isStorage(zone)`, `accepts(zone, defId)`,
`findStorageCell(pawn, defId, fromX, fromY)`, `zones` (Map). Зона: `{id, type, name, color, priority, filter, cells, data}`.
Событие `zone:changed`.

---

## 12. Системы

`game.systems.add({id, order, update(game, dt), init?(game), enabled?}, owner)` — тики симуляции (dt = 1/60);
`game.frameSystems.add(...)` — каждый кадр с реальным dt (ввод, UI-логика, камера). Также `get(id)`, `remove(id)`,
`setEnabled(id, v)`; поле `ms` — скользящее время (отладка F9). Исключение → `game.errors`, игра идёт дальше.

| Тиковые (`game.systems`) | order | | Кадровые (`game.frameSystems`) | order |
|---|---|---|---|---|
| `player` (WASD-движение лидера) | 15 | | `mouse-world` | 0 |
| `needs` (заглушка) | 20 | | `ui` (клавиши панелей, `handleInput`) | 10 |
| `ai` (выбор задач) | 30 | | `time-controls` (пауза/скорость/F9/Esc) | 20 |
| `jobs` (шаги задач) | 40 | | `player` (ввод лидера, E, события) | 30 |
| `movement` | 50 | | `player-steps` | 31 |
| `plants` (рост раз в час) | 60 | | `camera` | 80 |
| модули: 61–99 и 100+ (по умолчанию 100) | | | `audio` 85, `particles` 90 | |

Рекомендации: mind — потребности 20 (вместо ядра) и настроение 25; health — 35 (кровотечение) ; combat — 45 (атаки,
снаряды), train — 70–90 (котёл, топливо), journey — 100+. Кадровые системы модуля, которым нужно перехватить ввод до лидера
(ЛКМ в режиме стройки/прицеливания) — order < 30.

---

## 13. Лидер под прямым управлением (`js/player/controller.js`)

### 13.1 `game.player` (PlayerController)

`pawn` (живой лидер с `controlled === 'player'` или null), `walkTo(x, y)`, `hint` (текущее действие E: `{label, run, x, y,
id, tx, ty, ...}`), `tool`/`toolActive` (временный инструмент пометок), `coreDesignateTool` (true; build ставит false,
когда заменяет инструмент C своим), `holding` (идущее удержание E), `applyTool(tool, x1, y1)`, `hoveredColonist(p)`,
`findInteraction(p)`, `collides(x, y, r)`, `reset()`, `endHold()`.

Кадр (`frame`, order 30): WASD → `pawn.moveInput` (движение — тиковая система `player`, order 15, с коллизиями; отменяет
ручную задачу и автоходьбу), взгляд на курсор, C+ЛКМ/ПКМ — пометить/снять прямоугольник, E — действие, Q/R/1–4/ЛКМ/Shift —
события для модулей (§17: `player:orderMenu` + `api.orders.openMenu`, `player:callToArms`, `player:spell`, `player:attack`
(не над UI и не с инструментом), `player:dash`). Модальная панель (`modal: true`) блокирует управление лидером.
Потеря фокуса окна отпускает все клавиши, отменяет перетаскивание и удержание E.

### 13.2 Действия E — `game.defs.interactions` (sortBy order)

```js
game.defs.interactions.add({
  id: 'build:construct', order: 15,
  find(game, pawn, tx, ty) {           // проверяется наведённая клетка (≤ 8 клеток), затем клетки вокруг лидера
    const bp = game.map.buildingAt(tx, ty);
    return bp?.blueprint ? { label: game.t('build.act.construct'), x: tx, y: ty, run(game, pawn) { /* startManual */ } } : null;
  },
}, 'build');
```

Ядро: `work-thing` 10 (рубить/собрать/добыть), `eat` 20 (если голоден), `store` 25, `pickup` 30, `sleep` 90 (если устал);
без цели при грузе в руках — «Бросить». **Удерживаемые действия** (лопата в топку, нести, сесть, канал заклинания):
`hold: true` и `onHoldStart(game, pawn)`, `onHoldTick?(game, pawn, heldMs, dtReal)`, `onRelease(game, pawn, heldMs)` —
в определении или в результате `find`; `run` не вызывается; пока E зажата, цель не меняется; отпускание, потеря
фокуса, модальная панель или смена лидера → `onRelease` и событие `player:interactEnd` `{pawn, interaction, heldMs}`.

### 13.3 Смерть лидера и наследник

`game.colony.heirId` — назначенный наследник (UI health/mind). На `pawn:died` колониста-лидера (`js/sim/colony.js`):
`heir = game.api.colony.chooseHeir(deadPawn)` (назначенный → иначе максимум суммы `skills[*].level`, при равенстве меньший id) →
`leader:died` `{pawn, heir}` → `game.api.colony.transferLeadership(heir)` (снимает задачу, `isLeader = true`,
`controlled = 'player'`, `colony.leaderId`, сбрасывает `heirId`, шлёт `leader:changed` `{from: null, to: heir}`) →
уведомление. Камера сама переходит к новому лидеру. Нет живых колонистов → `colony.lost = true`, `colony:lost` `{day}`.
health/mind могут переопределить `chooseHeir(exclude)` (уважение, отношения); `transferLeadership` — ядро, не трогать.

---

## 14. Ввод и клавиши (`js/engine/input.js`, `js/core/keymap.js`)

### 14.1 API `game.input`

Модули **не слушают keydown** — регистрируют действие и опрашивают его каждый кадр:

```js
game.input.registerKey('build:rotate', 'KeyG', 'build', { label: 'build.key.rotate' });   // label — i18n-ключ
if (game.input.pressed('build:rotate')) rotate();
```

| Метод/поле | Описание |
|---|---|
| `registerKey(action, key \| keys[], owner, {label, allowShared, allowWhileTyping})` | клавиши — `KeyboardEvent.code` (`'KeyE'`, `'Space'`, `'F1'`, `'Digit1'`, `'BracketLeft'`), с модификатором `'Shift+F5'`; мышь — `'Mouse0'` (ЛКМ), `'Mouse1'`, `'Mouse2'` (ПКМ). Конфликт → `input.conflicts` (тесты падают) |
| `unregisterKey(action)`, `rebind(action, keys)`, `resetBinding(action)`, `recomputeConflicts()` | переназначения сохраняются в `settings.keybinds` |
| `isDown(a)`, `pressed(a)` (в этом кадре и не поглощено), `released(a)`, `consume(a)` | действия |
| `keyDown(code)`, `keyPressed(code)`, `consumeCode(code)` | сырые коды (UI-клики: `'Mouse0'`) |
| `mouse` `{sx, sy (CSS px), wx, wy (клетки, дробно), tx, ty (клетка), inside, wheel, moved}`, `mods` `{shift, ctrl, alt}` | |
| `bindings` (Map action → `{action, keys, defaultKeys, owner, label, allowShared, allowWhileTyping}`), `keyOf(a)`, `labelOf(a)`, `Input.keyLabel(code)` | |
| `captureText(owner)`, `releaseText()`, `textCapture`, `typed` | поле ввода: пока захвачено, все действия молчат (кроме `allowWhileTyping`, т.е. Esc); набранное за кадр — `typed` (`'\b'` = Backspace), Enter — `keyPressed('Enter')`. Esc при захвате: обработайте в `handleInput` и вызовите `consume('ui:back')`, иначе ядро закроет верхнюю панель |
| `lostFocus` | `true` в кадре, когда окно потеряло фокус/вкладка скрыта (все клавиши уже отпущены) — отмените свои перетаскивания |
| `setKey(code, down)`, `tap(code)`, `setMouseWorld(wx, wy)` | виртуальный ввод (headless) |

Голая клавиша срабатывает и с Shift, но не с Ctrl/Alt. Браузерные действия по F1–F10, Tab, Space, стрелкам и всем
занятым клавишам подавляются (`preventDefault`); F11/F12 — нет.

### 14.2 Правила раскладки (разрешение конфликтов PLAN §11)

* **Пробел — пауза** (как в RimWorld). Блинк мага — **рывок** (`player:dash`, левый Shift) или заклинание в слоте 1–4.
* Скорость времени — **Num1–Num3** и **+/−** (цифры 1–4 заняты заклинаниями).
* Никаких `Ctrl+буква` в игровых привязках (Ctrl+W закрывает вкладку) и никаких `Shift+X` (Shift — рывок; голая X
  сработает вместе с Shift).
* ЛКМ — атака лидера (`player:attack`). Режиму модуля, которому нужна ЛКМ (стройка, прицел заклинания, выбор цели приказа),
  — `game.input.consume('player:attack')` в кадровой системе с order < 30 или в `panel.handleInput`. Клики по UI
  (по прямоугольникам прошлого кадра) атаку не вызывают.
* ПКМ (`Mouse2`) — контекстная отмена/снятие (C+ПКМ — снять пометки; ПКМ — отмена стройки); как действие не регистрируется.
* Панель с `key` регистрирует действие `panel:<id>` (владелец — модуль панели).

### 14.3 Итоговая таблица клавиш (источник — `allKeys()` в `js/core/keymap.js`)

| Клавиша | Действие | Владелец | Регистрирует | Назначение |
|---|---|---|---|---|
| Пробел | `time:pause` | core | ядро | Пауза |
| =/+ / Num+ | `time:faster` | core | ядро | Быстрее (с паузы — снять паузу) |
| − / Num− | `time:slower` | core | ядро | Медленнее |
| Num1 / Num2 / Num3 | `time:speed1..3` | core | ядро | Скорость 1/2/3 |
| F9 | `debug:toggle` | core | ядро | Отладка |
| Esc | `ui:back` | core | ядро | Закрыть верхнюю панель, иначе событие `ui:menuRequested` (меню — ui) |
| W A S D | `player:up/left/down/right` | core | ядро | Движение лидера |
| E | `player:interact` | core | ядро | Действие руками (тап/удержание) |
| C | `player:designate` | core → build | ядро | Пометки (временный инструмент ядра; build заменяет) |
| Q | `player:orders` | vision | ядро | Меню приказов |
| R | `player:callToArms` | combat | ядро | «К оружию!» |
| 1 2 3 4 | `player:spell1..4` | combat | ядро | Заклинания |
| ЛКМ | `player:attack` | combat | ядро | Атака посохом |
| Shift (левый) | `player:dash` | combat | ядро | Рывок / блинк |
| H | `journey:horn` | train | ядро | Гудок |
| ] | `journey:regUp` | train | ядро | Регулятор + |
| [ | `journey:regDown` | train | ядро | Регулятор − |
| B | `panel:build` | build | модуль | Меню стройки |
| G | `build:rotate` | build | модуль | Поворот чертежа |
| Z | `build:zones` | build | модуль | Зоны складов |
| X | `build:clear` | build | модуль | Снять пометки / разобрать |
| F | `combat:draft` | combat | модуль | Призвать/отпустить наведённого поселенца |
| V | `vision:cameras` | vision | модуль | Вид рунных камер |
| I | `panel:character` | mind | модуль | Карточка персонажа |
| F7 | `panel:schedule` | mind | модуль | Расписание и отношения |
| F2 | `panel:health` | health | модуль | Здоровье |
| F8 | `panel:fallen` | health | модуль | Павшие |
| T | `panel:trade` | economy | модуль | Торговля |
| K | `panel:bills` | economy | модуль | Производство / заказы |
| F4 | `panel:route` | journey | модуль | Карта маршрута |
| L | `panel:train` | train | модуль | Панель поезда / отправление |
| F1 | `panel:work` | ui | модуль | Работы (приоритеты) |
| F3 | `panel:log` | ui | модуль | Журнал |
| F5 | `ui:quicksave` | ui | модуль | Быстрое сохранение |
| F6 | `ui:quickload` | ui | модуль | Быстрая загрузка |
| F10 | `panel:settings` | ui | модуль | Настройки |
| Tab | `panel:inventory` | ui | модуль | Инвентарь |
| M | `av:mute` | av | модуль | Звук вкл/выкл |
| колесо | — | core | ядро | Зум (над UI — прокрутка списков) |
| ПКМ | — | контекст | — | Отмена / снять пометки (C+ПКМ) |

Свободны (`FREE_KEYS`): J, N, O, P, U, Y, 5–0, \`, F11/F12 (браузер). Занять — через `MODULE_KEYS` в `js/core/keymap.js`.

---

## 15. Рендер (`js/render/*`, только браузер)

### 15.1 Слои — `game.render.registerLayer({id, order, space: 'world'|'screen', enabled?, draw(ctx, game, view)}, owner)`

Мировые слои рисуют в мировых пикселях (клетка = `TILE = 32`), трансформ камеры уже применён; экранные — в CSS-пикселях.
`ctx.save()/restore()` вокруг каждого слоя делает рендерер. Константы — `LAYER` (`js/render/renderer.js`).

| order | id | space | что |
|---|---|---|---|
| 0 | `ground` | world | чанки-кэш ландшафта, полов, рельсов, запекаемых построек и растений |
| 10 | `water-fx` | world | блики воды |
| 20 | `zones` | world | зоны |
| 30 | `decals` | world | кровь и т.п. |
| 40 | `items` | world | предметы |
| 45 | `plants` | world | растения, которые не запекаются (`bake: false` или свой `draw`) |
| 50 | `buildings` | world | постройки, которые не запекаются |
| 55 | `corpses` | world | трупы |
| 60 | `pawns` | world | пешки по y + оверлеи пешек (§15.6) |
| 65 | `train-deco` | world | нос локомотива, искры, подписи вагонов |
| 70 | `projectiles` | world | снаряды (combat) |
| 80 | `particles` | world | частицы без свечения |
| 85 | *(резерв `LAYER.WEATHER`)* | world/screen | погода (av), Гниль/фон пути (journey) |
| 88 | `tint` | screen | тёплая тонировка сумерек |
| 90 | `lighting` | screen | карта освещённости (ночь) |
| 92 | `emissive` | world | неон поверх темноты (`drawEmissive`) |
| 93 | `particles-glow` | world | светящиеся частицы |
| 95 | `fog` | world | туман войны (если `game.vision.enabled`) |
| 97 | `designations` | world | пометки |
| 98 | `overlay` | world | подсветка цели E, полосы работы, имена, рамка инструмента; превью стройки `build:ghost` |
| 150 | *(резерв `LAYER.SCREEN_FX`)* | screen | виньетка, вспышки (av) |
| 200 | `ui` | screen | HUD, панели, подсказки (`game.ui.drawAll`) |
| 900 | `cursor` | screen | курсор |

Ночью слои с order > 90 рисуются на отдельный верхний канвас (неон поверх темноты); днём всё — в основной.
`view`: `{w, h, dpr, zoom, scale (= TILE·zoom), camX, camY, x0, y0, x1, y1 (видимые клетки, обрезаны картой), time (с),
dt, frame, night (0..1), daylight}`. Рендерер сам ловит смену размера окна и `devicePixelRatio`.

### 15.2 Правила производительности

* **Никакого `shadowBlur` в циклах кадра.** Свечение — заранее отрисованные спрайты: `glowSprite(color, radius, falloff)`,
  `drawGlow(ctx, x, y, r, color, alpha)` (аддитивно), `neonStroke(ctx, pathFn, color, width, glowAlpha)`,
  `neonCircle(...)`, `glowText` (для немногих надписей UI) — `js/render/glow.js`. `shadowBlur` допустим только при
  запекании (чанки тайлов, `sprite()`).
* Кэш спрайтов: `sprite(key, w, h, draw)` (`js/engine/assets.js`; ≤ `SPRITE_CACHE_MAX` = 3000, старые вытесняются),
  `makeCanvas`, `clearSpriteCache(prefix)`. Ключ должен содержать всё, от чего зависит картинка, и иметь **конечное**
  число значений — квантуйте плавающие цвета/размеры (`glowSprite` сам квантует радиус до 8 px).
* Цвета: `hexToRgb`, `rgba(hex, a)`, `mix(a, b, t)`, `lighten`, `darken` (`js/render/color.js`) — принимают `#rgb`,
  `#rrggbb`, `rgb()/rgba()`; неверный цвет → белый без исключения.
* Не аллоцируйте в горячих циклах: `queryRect(..., out)` с переиспользуемым массивом, `visibleOfKind(game, view, kind, sortY, out)`,
  `isEntityVisible(game, e)`.

### 15.3 Отрисовщики сущностей

Выбор: `def.draw` → `game.render.registerDefDrawer(defId, drawer)` → `game.render.registerDrawer(kind, drawer)`.
Drawer: `{draw(ctx, e, game, view, def), drawEmissive?(ctx, e, game, view, alpha, def), paintBaked?(ctx, px, py, e, game, def)}`.
Пешка с `pawn.drawAs = 'enemy_ghoul'` рисуется `registerDefDrawer('enemy_ghoul', ...)`. Запасной отрисовщик построек —
прямоугольник цвета `def.color` с первой буквой названия. Экспорт: `drawEntity`, `makeKindLayer(id, order, kind, sortY,
filter)`, `pawnsLayer`, `emissiveLayer`, `itemSprite(def)`, `canopySprite`, `drawPawnBody`, `drawLeader`, `pawnDrawer`.
Лидер рисуется по `pawn.look` (число и длина кудрей, цвет кристалла, шрам). Сущности вне обзора скрываются
(динамичные — если клетка не видна, статичные — если не исследована).

### 15.4 Запекание (кэш тайлов)

Чанки 16×16 (`CHUNK`) перерисовываются по `map:changed`. Запекаются: ландшафт, полы (`floorDef.paint` или defDrawer
`paint`), рельсы, постройки с `bake: true` и чем запекать (`def.paintBaked` / `paintBaked` отрисовщика / без своего `draw` —
стена `paintWall` или скала `paintRock`), растения с `bake !== false` без своего `draw`. Изменили вид запечённой вещи —
`game.map.touch(x, y)`. Кэш ограничен по памяти (бюджет пикселей), масштаб запекания ≤ 3.

### 15.5 Свет

Источник `Light = {x, y (клетки), radius (клетки), color, intensity 0..1, flicker?}`. Откуда: поле `e.light` у сущности
(пешки, постройки), `def.light` у построек/растений/предметов, поставщики
`game.render.registerLightSource({id, collect(game, view, out) { out.push(light) }}, owner)` (ядро: `train`).
Темнота = `night × 0.84`; карта света рисуется в 1/3 разрешения и умножается на сцену.

### 15.6 Оверлеи пешек — `game.render.registerPawnOverlay({id, order, draw(ctx, pawn, view, game)}, owner)`

Вызываются для каждой **видимой** пешки сразу после её тела, в мировых пикселях (центр пешки — `pawn.x * TILE`,
`pawn.y * TILE`), с `save/restore` вокруг. Для кудрей, глифов, поз, копоти (av) и облачков реплик (ui) — вместо
отдельных полных проходов по пешкам. Реестр: `game.render.pawnOverlays` (`enabled: false` — выключить).

### 15.7 Камера и частицы

`game.camera`: `x, y, zoom, targetZoom, minZoom (0.45), maxZoom (2.6), w, h, followId (0 — лидер), lookAhead, shake`;
`snapTo(x, y)`, `addShake(amount)` (учитывает настройку `shake`), `zoomBy(steps)`, `worldToScreen(wx, wy)`,
`screenToWorld(sx, sy)`, `bounds(margin)`, `scale`, `viewX/viewY`. Сама прыгает к лидеру на `colony:started`,
`load:after`, `station:changed`.

`game.fx` (пул 3000, только косметика, `Math.random` допустим): `emit(x, y, {count, speed, angle, spread, life, size,
color, gravity, drag, glow, alpha, grow, jitter})`, `preset(id, x, y, opts)`, `clear()`. Пресеты:
`game.defs.fxPresets.add({id, emit(fx, x, y, opts)})`; ядро: `chips, leaves, sparks, dust, magic, smoke, embers`.
Не более 1024 разных цветов частиц — используйте палитру.

### 15.8 Звук (`js/engine/audio.js`)

Процедурный синтез Web Audio; контекст создаётся при первом вводе; в headless — тишина.
`game.audio.registerSfx(id, {layers, cooldown, jitter, vol}, owner)` (= `game.defs.sfx`), `game.audio.play(id, {x, y, vol,
pitch})` (позиционно от камеры). Слой: `{type: 'osc'|'noise', wave?, freq, freqEnd?, dur, attack?, vol?, delay?, filter?:
{type, freq, freqEnd?, q?}}`. Музыка — `game.audio.music` (объект с `update(dt)`, ядро — `AmbientMusic`; av может
заменить). Громкости — `applyVolumes()` (по настройкам). Отклик ядра на события (звук + частицы) — владелец событий
`'core-fx'`: av может снять его `game.events.offOwner('core-fx')` и сделать богаче. Звуки ядра: `chop, mine, harvest,
eat, tree_fall, rock_break, pickup, drop, designate, ui_click, ui_open, ui_close, error, notify, magic, step`.

---

## 16. UI на канвасе (`js/engine/ui.js`)

Immediate-mode: панели и HUD рисуются каждый кадр слоем `ui`; регистрация безопасна в headless.

* **Панель**: `game.ui.registerPanel({id, title (i18n-ключ), key?, width, height, anchor: 'center'|'left'|'right', modal?,
  draw(ctx, game, ui, rect), handleInput?(game, input), onOpen?(game), onClose?(game)}, owner)`. Одна панель на якорь;
  `key` → действие `panel:<id>` (переключает). `openPanel/closePanel/togglePanel(id)`, `isOpen(id)`, `closeTop()`,
  `open` (стек), `modalOpen`. События `ui:panelOpened/Closed` `{id}`.
* **HUD**: `game.ui.registerHud({id, slot, order, height?: number|(game, ui) → number, visible?(game), draw(ctx, game, ui, box) →
  занятая высота}, owner)`. Слоты `HUD_SLOTS`: `top-left, top-center, top-right, left, right, bottom-left, bottom-center,
  bottom-right` (у нижних слотов высота берётся из `height`, по умолчанию 24; 0 — не рисовать). `box = {x, y, align, slot, w}`. Ядро: `core:debug` (F9), `core:clock`,
  `core:colonists`, `core:leader`, `core:hint`, `core:controls`, `core:toasts` — модуль ui может убрать:
  `game.ui.hud.remove('core:toasts')`.
* **Подсказки к клетке**: `game.ui.registerTooltip({id, order, lines(game, hover) → [string | {text, color, bold, size} |
  {sep: true}]}, owner)`; `hover = {tx, ty, wx, wy, entities}`; `game.ui.hoverWorld`.
* **Помощники** (внутри `draw`): `ui.panel(x, y, w, h, {title, accent, bg, titleColor})` → внутренний прямоугольник,
  `ui.button(x, y, w, h, label, {active, disabled, size, tooltip})` → нажата, `ui.text(str, x, y, {size, bold, color, align,
  baseline, glow, glowColor, font})` → ширина, `ui.measure`, `ui.bar(x, y, w, h, v, color, bg)`, `ui.list(id, x, y, w, h,
  items, rowH, drawRow)` → кликнутый, `ui.tooltip(lines)`, `ui.block(x, y, w, h)` (область UI — мир не получит клик),
  `ui.mouseIn`, `ui.clicked(x, y, w, h, button)`, `ui.font(size, weight)`, `ui.keyHint(action)` → `'[E]'`,
  `roundRect(ctx, ...)`, тема `THEME` (`game.ui.theme`). `ui.wantsMouse` — мышь над UI (по прошлому кадру).
* Текстовые поля: `game.input.captureText('ui')` … `releaseText()` (§14.1).

---

## 17. События (`js/core/events.js`)

`game.events.on(name, fn(payload, name), owner)` → функция отписки; `once`, `off(name, fn)`, `offOwner(owner)` (снять все
подписки модуля), `emit(name, payload)`, `listenerCount(name)`, `trace` (отладка). Всегда передавайте `owner` = имя
модуля. Исключение в обработчике → `game.errors` (`event:<name>(<owner>)`), остальные обработчики выполняются.
Имена ядра — константы `EVENTS.*`; свои события модуль называет с префиксом модуля (`'combat:hit'`).

### 17.1 Каталог `EVENTS` (полезная нагрузка)

| Имя | Константа | Payload / когда |
|---|---|---|
| `game:init` | `GAME_INIT` | {game} — после register всех модулей и init систем |
| `world:reset` | `WORLD_RESET` | {reason: 'new'\|'load'\|'station'} — мир очищен: сбросьте свои runtime-кэши |
| `colony:started` | `COLONY_STARTED` | {seed, biome, scenarioId, difficulty, opts} — новая колония готова (после scenario.apply) |
| `colony:lost` | `COLONY_LOST` | {day} — не осталось живых поселенцев |
| `station:changed` | `STATION_CHANGED` | {map, train, carried: number, opts} — поезд переехал на новую карту (game.changeStation) |
| `time:speed` | `GAME_SPEED` | {speed, paused} |
| `time:hour` | `TIME_HOUR` | {day, hour} |
| `time:day` | `TIME_DAY` | {day} |
| `map:generated` | `MAP_GENERATED` | {map, biome} |
| `map:changed` | `MAP_CHANGED` | {x, y, w, h} |
| `entity:spawned` | `ENTITY_SPAWNED` | {entity} |
| `entity:removed` | `ENTITY_REMOVED` | {entity, reason} |
| `entity:moved` | `ENTITY_MOVED` | {entity, fromX, fromY} — game.entities.setPosition (НЕ каждый шаг пешки) |
| `item:changed` | `ITEM_CHANGED` | {item, delta} |
| `pawn:spawned` | `PAWN_SPAWNED` | {pawn} |
| `pawn:died` | `PAWN_DIED` | {pawn, corpse, cause, opts} |
| `pawn:ate` | `PAWN_ATE` | {pawn, item, defId, nutrition} |
| `pawn:slept` | `PAWN_SLEPT` | {pawn, bed (entity\|null), onFloor} |
| `pawn:woke` | `PAWN_WOKE` | {pawn} |
| `pawn:said` | `PAWN_SAID` | {pawn, text} |
| `leader:died` | `LEADER_DIED` | {pawn, heir\|null} |
| `leader:changed` | `LEADER_CHANGED` | {from (pawn\|null; null, если прежний лидер погиб), to} |
| `job:started` | `JOB_STARTED` | {pawn, job} |
| `job:ended` | `JOB_ENDED` | {pawn, job, result: 'done'\|'failed'\|'cancelled'} |
| `work:hit` | `WORK_HIT` | {pawn, job, x, y, fx} — удар топором/киркой (для звука/частиц) |
| `work:priority` | `WORK_PRIORITY` | {pawn, workType, value} |
| `plant:cut` | `PLANT_CUT` | {plant, pawn, harvestOnly} |
| `thing:mined` | `THING_MINED` | {thing, pawn} |
| `item:picked` | `ITEM_PICKED` | {pawn, defId, count} |
| `item:dropped` | `ITEM_DROPPED` | {pawn, defId, count, x, y} |
| `designation:added` | `DESIGNATION_ADDED` | {type, x, y, targetId} |
| `designation:removed` | `DESIGNATION_REMOVED` | {type, x, y} |
| `zone:changed` | `ZONE_CHANGED` | {zone} |
| `player:interact` | `PLAYER_INTERACT` | {pawn, interaction} — нажата E (для hold-взаимодействий — начало удержания) |
| `player:interactEnd` | `PLAYER_INTERACT_END` | {pawn, interaction, heldMs} — отпущена E у hold-взаимодействия |
| `player:orderMenu` | `PLAYER_ORDER_MENU` | {leader, target (pawn\|null), x, y} |
| `player:callToArms` | `PLAYER_CALL_TO_ARMS` | {leader} |
| `player:spell` | `PLAYER_SPELL` | {leader, slot (0..3), x, y} |
| `player:attack` | `PLAYER_ATTACK` | {leader, x, y} |
| `player:dash` | `PLAYER_DASH` | {leader, x, y} |
| `train:stamped` | `TRAIN_STAMPED` | {train} — поезд поставлен на карту (стены, полы, фикстуры, зоны готовы) |
| `train:unstamped` | `TRAIN_UNSTAMPED` | {train} |
| `train:carAdded` | `TRAIN_CAR_ADDED` | {train, car} — train.addCar (до restamp) |
| `train:carRemoved` | `TRAIN_CAR_REMOVED` | {train, car} — train.removeCar (до restamp) |
| `ui:notify` | `UI_NOTIFY` | {text, type, x?, y?, pawnId?} |
| `ui:panelOpened` | `UI_PANEL_OPENED` | {id} |
| `ui:panelClosed` | `UI_PANEL_CLOSED` | {id} |
| `ui:menuRequested` | `UI_MENU_REQUESTED` | {} — Esc при отсутствии открытых панелей |
| `settings:changed` | `SETTINGS_CHANGED` | {key, value} |
| `save:before` | `SAVE_BEFORE` | {slot} |
| `save:after` | `SAVE_AFTER` | {slot, bytes, ok} — ok=false: хранилище отказало (квота), сейв только в памяти |
| `load:after` | `LOAD_AFTER` | {slot\|null} — после game.save.restore/fromJSON/loadSlot |
| `av:floatText` | `AV_FLOAT_TEXT` | {x, y, text, color} |
| `game:victory` | `GAME_VICTORY` | {ending, stats} — journey |
| `journey:horn` | `JOURNEY_HORN` | {pattern} — train (гудок) |
| `journey:boarding` | `JOURNEY_BOARDING` | {untilTick, missing: pawn[]} — train (посадка перед отправлением) |
| `journey:leftBehind` | `JOURNEY_LEFT_BEHIND` | {pawn, station} — train (опоздавший остался на станции) |
| `journey:stoke` | `JOURNEY_STOKE` | {pawn, x, y, quality, fuel} — train (заброс топлива в топку) |
| `journey:boiler` | `JOURNEY_BOILER` | {state} — train ('ok'\|'low'\|'high'\|'critical'\|...) |
| `journey:arriving` | `JOURNEY_ARRIVING` | {station} — journey |
| `journey:actChanged` | `JOURNEY_ACT_CHANGED` | {act} — journey |
| `journey:rotBehind` | `JOURNEY_ROT_BEHIND` | {} — journey (Гниль отстала) |
| `mind:social` | `MIND_SOCIAL` | {a, b, kind, glyphs, audible, ticks} — mind |
| `mind:authorityChanged` | `MIND_AUTHORITY_CHANGED` | {value, delta, reason} — mind (заглушка ядра тоже шлёт) |
| `health:lastBreath` | `HEALTH_LAST_BREATH` | {pawn, untilTick} — health |
| `health:lastWords` | `HEALTH_LAST_WORDS` | {pawn, heard, text} — health |
| `health:memoryChanged` | `HEALTH_MEMORY_CHANGED` | {value, delta, reason} — health (заглушка ядра тоже шлёт) |
| `health:funeral` | `HEALTH_FUNERAL` | {record, rite, speechId} — health |
| `orders:refused` | `ORDERS_REFUSED` | {pawn, orderId, reply} — vision (приказы) |
| `vision:noise` | `VISION_NOISE` | {x, y, radius, kind} — vision (заглушка ядра тоже шлёт) |
| `combat:weaponNamed` | `COMBAT_WEAPON_NAMED` | {item, name} — combat |
| `economy:inspectionStarted` | `ECONOMY_INSPECTION_STARTED` | {...opts} — economy |
| `economy:inspectionEnded` | `ECONOMY_INSPECTION_ENDED` | {found, fine} — economy |

Последние 20 строк (от `game:victory`) — события модулей: ядро только объявляет имена, шлёт указанный модуль
(заглушки ядра шлют `mind:authorityChanged`, `health:memoryChanged`, `vision:noise`).

### 17.2 Прочие события модулей (объявлены в спецификациях заглушек)

| Модуль | События |
|---|---|
| build | `build:placed` {entity}, `build:completed` {entity, pawn}, `build:deconstructed` {entity} |
| combat | `combat:hit` {attacker, target, damage, part}, `combat:raidStarted` {faction, count}, `combat:raidEnded` {}, `combat:spellCast` {caster, spellId, x, y}, `combat:levelUp` {pawn, level} |
| economy | `economy:crafted` {pawn, recipeId, products}, `economy:traded` {trader, gave, got}, `economy:ingested` {pawn, defId} |
| health | `health:injured` {pawn, part, type, amount}, `health:downed` {pawn}, `health:healed` {pawn}, `health:buried` {corpse}, `health:deathScene` {pawn, years, lastWords} |
| journey | `journey:departing` {station}, `journey:travelling` {from, to}, `journey:arrived` {station}, `journey:incident` {id}, `journey:rotAdvance` {level}, `journey:factionChanged` {faction, value} |
| mind | `mind:thought` {pawn, id}, `mind:breakStarted` {pawn, kind}, `mind:breakEnded` {pawn}, `mind:skillUp` {pawn, skill, level} |
| vision | `vision:changed` {}, `orders:given` {leader, pawn, orderId}, `orders:completed` {pawn, orderId} |

### 17.3 Жизненный цикл мира

* Новая игра: `world:reset {reason: 'new'}` → `map:generated` → `train:stamped` → `entity:spawned`/`pawn:spawned`… →
  `colony:started`.
* Загрузка: `world:reset {reason: 'load'}` → `load()` сериализаторов (без `entity:spawned`!) → `load:after {slot}`.
* Смена стоянки: `world:reset {reason: 'station'}` → `map:generated` → `train:stamped` → `entity:spawned` → `station:changed`.

Модуль с runtime-кэшами (видимость, индексы, таймеры): сбросить на `world:reset`, перестроить на `colony:started`,
`load:after`, `station:changed`.

---

## 18. Межмодульный API — `game.api`, `game.provide`

```js
game.provide('health', { applyDamage(pawn, amount, opts) { ... }, kill(pawn, cause, opts) { ... } }, 'health');
game.api.health.applyDamage(target, 12, { part: 'head', type: 'cut', source: attacker });   // вызывать в момент использования
```

`provide(ns, impl, owner)` заменяет функции по одной (остальные остаются заглушками), создаёт пространство при
необходимости, записывает владельца в `game.providers[ns][fn]`; замена реализации **другого** модуля — предупреждение
в консоли; не-функция — `game.error` и пропуск. Заглушки детерминированы и безопасны до появления модулей.
Свои пространства (напр. `game.provide('train', {...})`) модули могут заводить свободно.

| Пространство.функция (сигнатура) | Заглушка ядра (поведение по умолчанию) | Предоставляет |
|---|---|---|
| `colony.getLeader()`, `colony.getColonists()` | `game.getLeader()`, `game.colonists()` | ядро |
| `colony.chooseHeir(exclude)` | назначенный `colony.heirId`, иначе макс. сумма навыков | ядро (health/mind могут заменить) |
| `colony.transferLeadership(pawn)` | см. §13.3 | ядро — не заменять |
| `health.applyDamage(pawn, amount, {part, type, source})` → урон | `pawn.health.hp -= amount`; при 0 → `kill` | health |
| `health.heal(pawn, amount)` | `hp += amount` до `maxHp` | health |
| `health.kill(pawn, cause, opts)` → труп | `dead = true`, `endJob`, сброс груза, `corpse`, `entities.remove(pawn, 'died')`, `pawn:died` — **заменяя, сохраните это поведение** | health |
| `health.isDowned(pawn)`, `health.canWork(pawn)` | `!!pawn.downed`; жив и не упал | health |
| `health.moveSpeedFactor(pawn)`, `health.workSpeedFactor(pawn)` | 1 (ядро клампит: 0.05..3 / 0..10, NaN → 1) | health |
| `health.addCondition(pawn, id, opts)`, `health.hasCondition(pawn, id)` | null / false | health |
| `health.getSummary(pawn)` → `{ratio, label}` | по `hp/maxHp` | health |
| `health.getMemory()`, `health.addMemory(delta, reason)` | `colony.memory`; клампит 0..100, шлёт `health:memoryChanged` | health |
| `health.isCarrying(pawn)`, `health.canCarry(pawn)` | false; жив | health |
| `health.recordFallen(pawn, opts)`, `health.createFallen(spec, opts)`, `health.getFallen()` | null, null, [] | health |
| `mind.addThought(pawn, id, {mood, days, source, otherPawnId})`, `mind.removeThought(pawn, id)` | no-op | mind |
| `mind.getMood(pawn)` → 0..1 | `pawn.mood.value ?? 0.6` | mind |
| `mind.learn(pawn, skillId, xp)`, `mind.skillLevel(pawn, skillId)`, `mind.skillFactor(pawn, workTypeId)` | no-op; `skills[id].level ?? 3`; 1 | mind |
| `mind.isInBreak(pawn)`, `mind.hasTrait(pawn, id)` | false; `traits.includes(id)` | mind |
| `mind.say(pawn, text)` | событие `pawn:said` | mind |
| `mind.scheduleAllows(pawn, activity)` | true | mind |
| `mind.getAuthority()`, `mind.addAuthority(delta, reason)` | `colony.authority`; клампит 0..100, шлёт `mind:authorityChanged` | mind |
| `mind.willObey(pawn, orderId, opts)` → `{ok, reply}` | `{ok: true, reply: null}` | mind |
| `mind.addTrait(pawn, id, opts)`, `mind.revealTrait(pawn, id)` | push в `pawn.traits`; no-op | mind |
| `mind.setRelation(a, b, kind, opinion)` | `a.relations[b.id] = {kind, opinion}` | mind |
| `mind.generateCandidate(rng, {gender, role, lang})` → spec | `{name, gender, age, bio: null, traits: [], skills: {}, look: {}, role}` | mind |
| `vision.isVisible(tx, ty)`, `vision.isExplored(tx, ty)`, `vision.canPawnSee(pawn, tx, ty)` | true | vision |
| `vision.report(text, opts)` | `ui.notify(text, opts)` | vision |
| `vision.noise(x, y, radius, kind)` | событие `vision:noise` | vision |
| `vision.canLeaderHear(x, y)` | расстояние до лидера ≤ 8 | vision |
| `vision.lastKnown(entityId)` | null | vision |
| `orders.list(leader, pawn)` → `[{id, label}]`, `orders.give(leader, pawn, orderId, target)` → bool, `orders.openMenu(leader, pawn)` | [], false, no-op | vision |
| `combat.isHostile(a, b)` | враг ↔ не-враг | combat |
| `combat.isDrafted(pawn)`, `combat.setDrafted(pawn, v)` | `pawn.drafted` | combat |
| `combat.attack(attacker, target)` → bool, `combat.spawnRaid({faction, points, kind, edge})`, `combat.getMana(pawn)` | false, null, null | combat |
| `combat.hasStaff(pawn)` | true | combat |
| `economy.itemValue(defId)`, `economy.colonyWealth()` | `def.value`; сумма по предметам | economy |
| `economy.canAfford(cost)`, `economy.consume(cost, x, y)` | `game.items.count/consume` | economy |
| `economy.isAddicted(pawn, kind)`, `economy.startInspection(opts)` | false, false | economy |
| `journey.getBiome()`, `journey.getStation()` → `{index, id, nameKey}`, `journey.isTravelling()`, `journey.depart()` | биом карты, станция 0, false, false | journey |
| `journey.getAmbientTemp()` → °C | 15 | journey |
| `journey.getFuel()` → `{kind, amount, max}` \| null | null | **train** |
| `journey.getTrainState()` | `{engine: 'steam', moving: false, speed: 0, regulator: 0, heat: 0, pressure: 0, boilerState: 'ok', fuel: 0, battery: 0, noise: 0, rotGapHours: null, rotGapExact: false}` | **train** |
| `journey.setRegulator(value 0..1)` → bool | false | **train** |
| `journey.getCarHeat(carIndex)` → °C над наружной | 0 | **train** |
| `journey.isInCab(pawn)` | false | **train** |
| `build.canPlace(defId, x, y, rot)` | границы, свободно, `buildable`/пол, `placeableOn` | build |
| `build.place(defId, x, y, {rot, force})` → сущность | сразу готовая постройка (без чертежа) | build |
| `build.deconstruct(entity)` → bool | удалить | build |
| `ui.notify(text, {type: 'info'\|'good'\|'bad'\|'danger', x, y, pawnId})` | запись в `game.log` + `ui:notify` — **заменяя, сохраните это** | ui |
| `ui.setObjective(id, text, opts)`, `ui.clearObjective(id)` | `game.colony.objectives[id]` | ui |
| `av.shake(amount)`, `av.floatText(x, y, text, color)`, `av.play(sfxId, opts)` | `camera.addShake`, событие `av:floatText`, `audio.play` | av |
| `av.hitStop(ms)` | `game.slowMo(0.05, ms)` (≤ 500 мс) | av |
| `av.flash(entity, ms)` | no-op | av |

Пространство `journey` делят два модуля: функции, помеченные **train**, предоставляет модуль train
(`game.provide('journey', {getTrainState, getFuel, setRegulator, getCarHeat, isInCab}, 'train')`), остальные — journey.

---

## 19. Сохранение (`js/core/save.js`)

Сейв = `{format: 'lasttrain-save', version: 1, gameVersion, meta: {day, hour, colonists, leader, savedAt}, data: {[id]: ...}}`
(JSON в хранилище под ключом `lasttrain.save.<slot>`).

* `game.save.registerSerializer({id, order, save(game) → JSON, load(game, data, snapshot)}, owner)`. Порядок ядра:
  `meta 0` (сид, RNG, `colony`, `stats`), `time 10`, `map 20`, `train 25`, `entities 30`, `zones 40`,
  `designations 50`, `log 60`; модули — 70+ (по умолчанию 100).
* `snapshot()` / `restore(snap, slot)`, `toJSON()` / `fromJSON(json, slot)`, `saveSlot(slot)` → размер или **0**
  (хранилище отказало — сейв только в памяти вкладки, ядро уже уведомило игрока), `loadSlot(slot)` → bool (битый JSON →
  исключение; ловите в UI), `hasSlot`, `deleteSlot`, `listSlots()` → `[{slot, meta}]`.
* `restore`: `resetWorld('load')` → `load` сериализаторов по order (нет данных в сейве — `load` не вызывается: сбросьте
  своё состояние на `world:reset`) → `load:after`. Сейв новее игры — исключение.
* Автоматически сохраняется: все поля сущностей (кроме `_*` и transient), `game.colony`, `game.train` (все поля),
  зоны, пометки, журнал (100 последних). **Не сохраняются** задачи (`pawn.job`) и резервы — после загрузки пешки
  выбирают работу заново (поэтому загруженная игра не повторяет исходную бит-в-бит; повторная загрузка того же сейва
  даёт идентичное состояние). Груз в руках без задачи пешка ИИ кладёт на землю.
* Утилиты: `rleEncode(arr)`, `rleDecode(rle, target)`.

---

## 20. Строки, настройки, случайность

### 20.1 i18n (`js/core/i18n.js`)

`game.i18n.add('ru', {combat: {spell: {fireball: 'Огненный шар'}}})` → ключ `'combat.spell.fireball'` (вложенные объекты
разворачиваются). `game.t(key, vars)` (или `import { t } from 'js/core/i18n.js'` в коде отрисовки): подстановки `{name}`;
строка-массив — вариант `vars.variant` по модулю длины; строка-функция `(vars, i18n) → string`. Нет ключа → вернётся сам
ключ, ключ попадёт в `i18n.missing` (headless печатает предупреждение). Язык — `game.i18n.lang` (= настройка `lang`,
`'ru'|'en'`, запасной — ru). `i18n.has(key)`, `raw(key)`, `plural(n, ['день', 'дня', 'дней'])`.
**Грубая речь**: `game.i18n.tRude(cleanKey, rudeKey, vars)` (или экспорт `tRude`) — при настройке `rudeSpeech` и наличии
`rudeKey` берёт грубый вариант, иначе чистый. Мат изредка, не в момент смерти.

### 20.2 Настройки — `game.settings` (отдельно от сейвов, ключ `lasttrain.settings`)

`get(key)`, `set(key, value)` (сохраняет, шлёт `settings:changed` `{key, value}`), `registerDefault(key, value)` (модуль
объявляет свою: `'av.musicMode'`). Ключи ядра (`DEFAULT_SETTINGS`): `lang` ('ru'), `masterVolume` 0.8, `musicVolume`
0.45, `sfxVolume` 0.8, `rudeSpeech` true, `shake` true, `damageNumbers` true, `showDebug` false (F9), `edgeGlow` true,
`keybinds` {}.

### 20.3 Случайность (`js/core/rng.js`)

`game.rng` (mulberry32): `next()` [0,1), `range(a, b)`, `int(a, b)` (включительно), `chance(p)`, `pick(arr)`,
`weighted(items, weightFn)`, `shuffle(arr)`, `normal(mean, sd)`, `fork(label)`, `getState()/setState()`; `hashString(str)`;
`new RNG(seed)` для своих потоков (например, сид из UI до старта игры). `fork(label)` зависит **только от сида и метки**
(не от состояния): одинаковая метка → одинаковый поток; для повторяемых, но разных потоков добавляйте в метку
номер/тик/id. Основной `game.rng` сохраняется в сейве. В симуляции — никогда `Math.random`.
Косметические хеши без ГСЧ: `hash2(x, y, seed)`, `hash01` (`js/core/math.js`); шум — `valueNoise`, `fbm` (`js/core/noise.js`).
Прочие помощники `js/core/math.js`: `clamp, clamp01, safeNum(v, min, max, def), lerp, damp, approach, dist, dist2, chebyshev,
manhattan, octile, angleTo, wrapAngle, lerpAngle, distToSegment, segmentsIntersect, lineTiles(x0, y0, x1, y1, cb)`
(Брезенхем — линия видимости/выстрела), `rectFromPoints`, `TAU`.

---

## 21. Headless и детерминизм

* В `register()` и в тиковых системах — никакого DOM/Canvas/`window`/`localStorage`/`performance` для логики.
  Канвасы и спрайты — только в `draw()`; `makeCanvas` в Node бросает.
* `game.isHeadless` — для редких ветвлений (звук, частицы уже no-op).
* Один и тот же сид + те же действия → то же состояние (проверяется в `tests/headless.mjs`). Источник случайности —
  `game.rng`/`fork`. Порядок итерации — `entities.ofKind` (порядок создания). Не завязывайте логику на
  `performance.now()`, реальное время, `game.timeScale`, частоту кадров.
* Время в тиковых системах — `game.time.tick`/`dt`, не кадры.

---

## 22. Тесты

| Тест | Что проверяет |
|---|---|
| `node tests/headless.mjs --days N --seed S` | N дней с ботом-лидером (WASD, E, пометки), без исключений; сохранение → загрузка → полдня игры; детерминизм; контракт; конфликты клавиш; минимум выполненных работ |
| `node tests/contract.mjs` | таблица клавиш = регистрации ядра; все заглушки API (`API_CONTRACT`); новая игра без перезагрузки = свежая игра; сценарии (roster/look/flags/items/silver); `addCar`+`restamp` (мебель, пометки, фильтр склада, предметы), `removeCar`; `changeStation` + сохранение полей поезда + двойная загрузка; NaN-множители модулей; `slowMo`; удержание E; наследование власти и `colony:lost` |
| `node tests/browser.mjs` | Chromium 1600×900: старт, WASD, E-рубка, C+перетаскивание, скорость, зум, ночь, F9, пауза, потеря фокуса, ресайз, сохранение в localStorage, `game.newGame` без перезагрузки; ошибки консоли/страницы → провал; скриншоты `tests/screens/01..10` |

Модулям: свои проверки держите в своей папке и запускайте сами; обязательное условие — `tests/headless.mjs` (3 сида × 20
дней), `tests/contract.mjs` и `tests/browser.mjs` зелёные, `game.errors` и `game.input.conflicts` пусты.

---

## 23. Владение: кто чем владеет

| Модуль | defs (свои реестры и записи) | Клавиши | Панели / HUD | API (`provide`) | Состояние |
|---|---|---|---|---|---|
| **ядро** | `terrain, floors, items` (базовые), `zoneTypes, plants, buildings` (природа, поезд), `biomes` (`forest`), `wagonTypes` (9 базовых), `workTypes, jobTypes, toils, designations, interactions, sfx, fxPresets, scenarios` (`standard`), `difficulties` | §14.3 «ядро» (в т.ч. на владельцев vision/combat/train) | HUD `core:*`, тултипы `core:things`, `core:tile` | `colony.*`, заглушки всех остальных | `game.colony` (базовые поля), `game.train` (поля `cars, nextCarId, railY, x0, stamped`), карта, сущности |
| **build** | постройки (≥ 25), полы, `blueprint`-вид (опц.), задачи `deliver/construct/deconstruct`, взаимодействие `build:construct`, типы зон | B `panel:build`, G `build:rotate`, Z `build:zones`, X `build:clear`, C (`player:designate`, ядро) | `build`, слой `build:ghost` (98) | `build.*` | `map.room` на земле (< 10000), `map.roof = 2` |
| **mind** | `thoughts, traits, skills`, узлы ИИ `eat/sleep` (override), `joy, social, mentalBreak` | I `panel:character`, F7 `panel:schedule` | `character`, `schedule`, тултип `mind` | `mind.*` | на пешке: `needs, mood, skills, traits, relations, schedule, bio, dream, inspiration`; `colony.authority` |
| **health** | `bodyParts, conditions`, задачи `tend/rescue/feedPatient/bury`, могила | F2 `panel:health`, F8 `panel:fallen` | `health`, `fallen`, тултип `health` | `health.*` (+ может `colony.chooseHeir`) | `pawn.health, dying`; трупы; `colony.memory`; «Павшие» (свой сериализатор) |
| **combat** | оружие (items `category: 'weapon'`), `enemies`, узлы ИИ врагов, `callToArms` (97), турели | ЛКМ/1–4/Shift/R (ядро), F `combat:draft` | HUD маны/слотов (bottom-center), слой снарядов (70) | `combat.*` | `pawn.mana, perks, nameless, drafted, equipment.weapon` |
| **economy** | предметы (еда, ткань, зелья, вещества, `silver`), `recipes`, зона `grow`, растения-культуры, задачи `doBill/ingest/sow` | T `panel:trade`, K `panel:bills` | `trade`, `bills` | `economy.*` | `pawn.drugPolicy`, зависимости (через health) |
| **journey** | биомы `ash/ice`, растения биомов, `incidents`, параметры `difficulties` | F4 `panel:route` | `route`, слой пути/Гнили (85) | `journey.getBiome/getStation/isTravelling/depart/getAmbientTemp` | маршрут, станции, Гниль, фракции (сериализатор `journey`); вызывает `game.changeStation` |
| **train** | `scenarios` (данные старта), `wagonTypes` `tender/salon`, фикстуры (топка, котёл, двигатели), тип работ `stoking`, задача `stoke`, виды топлива | L `panel:train`, H `journey:horn`, `]`/`[` `journey:regUp/regDown` (ядро) | `train`, HUD котла | `journey.getTrainState/getFuel/setRegulator/getCarHeat/isInCab` | `game.train.*` (engine, fuel, heat, pressure, regulator…), `car.data`; события `journey:horn/boarding/leftBehind/stoke/boiler` |
| **vision** | источники обзора (`buildings.vision`), колокол, узел ИИ `order` (85) | Q `player:orders` (ядро), V `vision:cameras` | меню приказов | `vision.*`, `orders.*` | `game.vision` (enabled/version), `pawn.order` |
| **ui** | — | Esc (через `ui:menuRequested`), F1 `panel:work`, F3 `panel:log`, F5 `ui:quicksave`, F6 `ui:quickload`, F10 `panel:settings`, Tab `panel:inventory` | главное меню/новая игра, пауза, настройки, работы, журнал, инвентарь, конец игры; может заменять HUD `core:*`; оверлей облачков | `ui.notify/setObjective/clearObjective` | настройки, слоты сейвов; вызывает `game.newGame` |
| **av** | `sfx`, `fxPresets`, музыка | M `av:mute` | слои погоды (85), экранные эффекты (150), оверлеи пешек | `av.*` | — |

Разделение journey ↔ train: **train** — локомотив и двигатели (паровой/рунный), котёл/тепло/давление, регулятор, топка и
кочегар, топливо и расход, гудок/посадка/отставшие, температура вагонов, вагоны «тендер»/«салон», покупки в депо, панель L,
сценарии старта. **journey** — карта маршрута, фаза в пути и прокрутка, станции и генерация биомов, фронт Гнили,
рассказчик и колода событий (включая встречи на путях), сюжет/лор/Серый путник, концовки и победа.
Имена API и событий поезда остаются в пространстве `journey` (без переименований), их предоставляет и шлёт train.

---

## 24. Рецепты «как добавить…»

**Постройку** (build):
```js
game.defs.buildings.add({ id: 'bed_wood', nameKey: 'build.bed_wood', size: [1, 2], rotatable: true, passable: true,
  bed: true, restEffect: 1.2, materials: { wood: 30 }, workToBuild: 600, category: 'furniture', placeableOn: 'both',
  color: '#ffb86b', draw(ctx, e, game, view, def) { /* мировые пиксели: e.x * TILE ... */ } }, 'build');
game.i18n.add('ru', { build: { bed_wood: 'Деревянная кровать' } });
```

**Предмет** (economy): `game.defs.items.add({id: 'herbs', nameKey: 'economy.item.herbs', category: 'material', stackLimit: 50,
value: 2, color: '#7dff9a', icon: 'bag'}, 'economy')`.

**Работу (тип задачи) и шаг**:
```js
game.jobs.registerWorkType({ id: 'stoking', nameKey: 'train.work.stoking', order: 25, skill: null, defaultPriority: 2 }, 'train');
game.jobs.registerToil({ id: 'train:shovel', tick(game, pawn, toil, job, dt) { /* ... */ return 'done'; } }, 'train');
game.jobs.registerJobType({ id: 'stoke', workType: 'stoking', labelKey: 'train.job.stoke', adjacent: true,
  findJob(game, pawn) { const box = findFirebox(game); return box ? { targetId: box.id, x: box.x, y: box.y } : null; },
  makeToils: (game, pawn, job) => [{ type: 'goto', targetId: job.targetId, adjacent: true }, { type: 'train:shovel' }] }, 'train');
```

**Узел мышления**: `game.ai.registerThinkNode({id: 'joy', priority: 40, factions: ['colony'], evaluate(game, pawn) { ... }}, 'mind')`.

**Мысль** (mind):
```js
const thoughts = game.defs.create('thoughts');
thoughts.add({ id: 'slept_on_floor', nameKey: 'mind.thought.slept_on_floor', mood: -4, days: 1 }, 'mind');
game.provide('mind', { addThought(pawn, id, opts = {}) { (pawn.thoughts ||= []).push({ id, until: game.time.tick + ... }); } }, 'mind');
```

**Панель с клавишей**:
```js
game.ui.registerPanel({ id: 'health', title: 'health.panel.title', key: 'F2', width: 560, height: 460, anchor: 'right',
  draw(ctx, game, ui, r) { ui.text(game.t('health.panel.title'), r.x, r.y); } }, 'health');   // → действие 'panel:health'
```

**Клавишу**: добавить строку в `MODULE_KEYS` (`js/core/keymap.js`) через запрос к ядру, затем
`game.input.registerKey('vision:cameras', 'KeyV', 'vision', {label: 'vision.key.cameras'})` и `game.input.pressed('vision:cameras')`.

**Слой**: `game.render.registerLayer({id: 'av:weather', order: 85, space: 'screen', draw(ctx, game, view) { ... }}, 'av')`.
**Оверлей пешки**: `game.render.registerPawnOverlay({id: 'ui:bubbles', order: 50, draw(ctx, pawn, view, game) { ... }}, 'ui')`.

**Функцию API**: `game.provide('combat', { hasStaff: (pawn) => !!pawn.equipment?.staff }, 'combat')`; новую — в своё
пространство или согласуйте с ядром добавление заглушки (и строку в `API_CONTRACT`).

**Данные в сейв**: в полях сущностей / `game.colony.<поле>` / `game.train.<поле>` — автоматически; иначе
```js
let state = { stationIndex: 0 };
game.events.on('world:reset', () => (state = { stationIndex: 0 }), 'journey');
game.save.registerSerializer({ id: 'journey', order: 70, save: () => state, load: (g, d) => (state = d) }, 'journey');
```

**Сценарий** (train): `game.defs.scenarios.add({id: 'naked_alone', nameKey: 'train.scen.naked.name', descKey:
'train.scen.naked.desc', difficulty: 'brutal', order: 30, rerolls: 0, colonists: 0, items: [], silver: 0, rotGapHours: 24,
engine: 'steam', flags: {naked: true}, apply(game, opts, ctx) { ctx.leader.naked = true; ctx.leader.equipment = {}; }}, 'train')`.

**Вагон и фикстуру** (train): `game.defs.wagonTypes.add({id: 'tender', nameKey: 'train.wagon.tender', length: 8, color:
'#c9a46b', light: '#ffe0a0', fixtures: [{defId: 'coal_bunker', dx: 2, dy: 2}]}, 'train')`, затем
`game.train.addCar('tender', {index: game.train.locomotive.index, restamp: true})`.

---

## 25. Известные ограничения ядра

* Задачи не сохраняются: после загрузки пешки выбирают работу заново (повторная загрузка того же сейва детерминирована).
* Сейв ~330 КБ JSON на стоянку 140×90 (в основном природные сущности); localStorage ≈ 5 МБ → держите ≤ 10 слотов.
* Пометки — только для статичных целей (охота на подвижных — свой механизм модуля).
* `queryRect` находит постройки с началом не дальше 4 клеток от области — постройки крупнее 5×5 могут не находиться по
  дальнему краю.
* `relocate` устарел (пересоздаёт объект) — используйте `setPosition`.
* В headless-Chromium FPS ночью ниже (программная композиция `multiply`); JS-время кадра ≈ 2 мс.
