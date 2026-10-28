/**
 * МОДУЛЬ ui — интерфейс MVP: главное меню, новая игра, пауза (Esc), сохранения/загрузка (+ автосохранение по прибытии
 * на станцию), настройки, экран конца игры (colony:lost), экран победы (game:victory), обучение на первой станции.
 * Владелец: js/modules/ui/** . Контракт ядра: docs/ARCHITECTURE.md (§16 UI, §19 сейвы, §20 настройки).
 *
 * КАК УСТРОЕНО
 *  • Экраны — стек R.screen ('main' | 'new' | 'load' | 'save' | 'settings' | 'pause' | 'over' | 'victory'), рисуются
 *    своим экранным слоем 'ui:screens' (order 850, поверх HUD и панелей). Пока экран открыт: игра на паузе, открыта
 *    пустая модальная панель 'ui_screen' (game.ui.modalOpen → лидер стоит), клавиатура захвачена (captureText —
 *    игровые клавиши молчат), клики/колесо забирает кадровая система 'ui:capture' (order 1) для Kit (режим 'screen').
 *  • Старт в браузере: main.js запускает колонию-фон, ui в первом кадре открывает главное меню поверх неё.
 *    Параметры адреса seed / scenario / difficulty / autostart — сразу в игру (отладка и тесты), ?menu — меню всегда.
 *  • Новая игра: game.newGame({seed, scenarioId: 'three_survivors', difficulty, colonyName, leaderName}).
 *  • Сохранения: ячейки slot1..slot3 (из паузы), 'auto' (по 'journey:arrived'), 'quick' (ядро/F5 — после MVP).
 *  • Победа: journey открывает свою панель 'journey_victory'; ui показывает поверх неё полный экран итогов и
 *    закрывает панель вместе с экраном.
 *  • Обучение: tutorial.js, настройка 'ui.tutorial' (по умолчанию вкл.), HUD 'ui:tutorial' (слот bottom-left, над
 *    карточкой лидера; прячется под панелью слева). Пока оно идёт, стартовый тост ядра 'hint.start' не показывается.
 *  • HUD ядра 'core:controls' заменён: та же строка клавиш, но ужимается/обрезается, чтобы не залезать на панель
 *    заклинаний внизу по центру.
 *
 * API (game.api.ui, свои функции): screen() → id верхнего экрана | null, openScreen(id), closeScreens(),
 *   menuAction(name, arg) — то же, что кнопки (new/start/loadSlot/saveSlot/back/exit/resume), newGameForm() → форма,
 *   widgetRect(id) → прямоугольник виджета (CSS px) для тестов, tutorial() → {step, done, finished, active}.
 */
import { EVENTS } from '../../core/events.js';
import { Kit } from './kit.js';
import { registerStrings } from './strings.js';
import { createSaved, createRuntime, wireState, trackPeak, sampleLeg } from './state.js';
import { drawScreens, SCREEN_IDS, slotName } from './screens.js';
import { wireTutorial, tutorialFrame, tutorialActive, tutorialHeight, drawTutorial, currentStep, TUTORIAL_SETTING } from './tutorial.js';

const OWNER = 'ui';
const PANEL = 'ui_screen';
const DEFAULT_SCENARIO = 'three_survivors';
const SKIP_MENU_PARAMS = ['seed', 'scenario', 'difficulty', 'autostart'];

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

/** Показывать ли меню при загрузке страницы (только браузер). */
function menuAtBoot() {
  try {
    const p = new URLSearchParams(globalThis.location?.search || '');
    if (p.has('menu')) return true;
    return !SKIP_MENU_PARAMS.some((k) => p.has(k));
  } catch {
    return false;
  }
}

export function register(game) {
  registerStrings(game);
  game.settings.registerDefault?.(TUTORIAL_SETTING, true);

  const R = Object.assign(createRuntime(), {
    screen: [],
    wasPaused: false,
    booted: false,
    slotsCache: null,
    ng: null,
    msg: null,
    victory: null,
    lostDay: null,
    focusFor: null,
    tutDoneAt: -1,
    tutDoneShown: -1,
  });
  const M = { game, S: createSaved(), R, kit: new Kit(game), scene: null };

  // ---------- Состояние и сохранение ----------
  game.save.registerSerializer({
    id: 'ui',
    order: 100,
    save: () => clone(M.S),
    load(g, data) {
      M.S = Object.assign(createSaved(), clone(data) || {});
    },
  }, OWNER);
  game.events.on(EVENTS.WORLD_RESET, ({ reason } = {}) => {
    if (reason === 'station') return;
    M.S = createSaved();
    R.breaks.clear();
    R.raid = null;
    R.pendingAutosave = null;
    R.bedPicked = false;
  }, OWNER);
  game.events.on(EVENTS.COLONY_STARTED, () => {
    R.hideStartHint = true;
    R.pendingAutosave = 'start'; // мир за главным меню при запуске не сохраняется (см. кадр)
  }, OWNER);
  game.events.on(EVENTS.LOAD_AFTER, () => {
    R.pendingAutosave = null;
  }, OWNER);
  wireState(game, M);
  wireTutorial(game, M);
  game.systems.add({
    id: 'ui:stats',
    order: 200,
    update(g) {
      if (g.time.tick % 30) return;
      trackPeak(g, M.S);
      sampleLeg(g, M);
    },
  }, OWNER);

  // ---------- Сохранения ----------
  const refreshSlots = () => {
    try {
      R.slotsCache = game.save.listSlots().filter((s) => s && s.meta);
    } catch (err) {
      game.error(err, 'ui.listSlots');
      R.slotsCache = [];
    }
    return R.slotsCache;
  };
  M.slots = () => R.slotsCache || refreshSlots();
  M.latestSave = () => {
    let best = null;
    for (const s of M.slots()) if (!best || (s.meta?.savedAt || 0) > (best.meta?.savedAt || 0)) best = s;
    return best;
  };
  const say = (text, bad = false) => {
    R.msg = { text, bad, until: R.realTime + 3 };
  };

  // ---------- Экраны ----------
  const top = () => R.screen[R.screen.length - 1] || null;
  const panelSync = () => {
    if (game.isHeadless) return;
    const want = R.screen.length > 0;
    if (want && !game.ui.isOpen(PANEL)) game.ui.openPanel(PANEL);
    else if (!want && game.ui.isOpen(PANEL)) game.ui.closePanel(PANEL);
  };
  const pauseFor = () => {
    if (R.screen.length) return;
    R.wasPaused = game.paused;
    if (!game.isHeadless && !game.paused) game.togglePause(true);
  };
  const initForm = () => {
    const scen = game.defs.scenarios.has(DEFAULT_SCENARIO) ? DEFAULT_SCENARIO : game.defs.scenarios.all()[0]?.id;
    const prev = R.ng;
    R.ng = {
      scenarioId: scen,
      colony: prev?.colony || '',
      leader: prev?.leader || '',
      seed: String(Math.floor(Math.random() * 1e9)), // сид UI до старта игры — не симуляция
      difficulty: prev?.difficulty || (game.defs.difficulties.has('normal') ? 'normal' : game.defs.difficulties.all()[0]?.id),
    };
  };

  const act = {
    open(id, replace = false) {
      if (!SCREEN_IDS.includes(id)) return false;
      pauseFor();
      if (replace) R.screen.length = 0;
      if (id === 'main' || id === 'load' || id === 'save') refreshSlots();
      if (id === 'new') initForm();
      M.kit.blurText();
      R.screen.push(id);
      panelSync();
      return true;
    },
    /** Заменить весь стек одним экраном. */
    only: (id) => act.open(id, true),
    back() {
      M.kit.blurText();
      R.screen.pop();
      if (!R.screen.length) act.closeAll();
      else if (top() === 'main') refreshSlots();
    },
    closeAll(resume = null) {
      R.screen.length = 0;
      M.kit.blurText();
      if (game.input.textCapture === 'ui') game.input.releaseText();
      panelSync();
      if (game.ui.isOpen('journey_victory')) game.ui.closePanel('journey_victory');
      if (!game.isHeadless) game.togglePause(resume === null ? R.wasPaused : !resume);
    },
    resume: () => act.closeAll(),
    escape() {
      const id = top();
      if (!id || id === 'main' || id === 'over') return;
      if (id === 'pause' || id === 'victory') act.closeAll();
      else act.back();
    },
    exitToMenu() {
      for (const id of game.ui.open.slice()) if (id !== PANEL) game.ui.closePanel(id);
      act.open('main', true);
    },
    startNewGame(form = R.ng) {
      const F = form || (initForm(), R.ng);
      const raw = String(F.seed ?? '').trim();
      const seed = !raw ? Math.floor(Math.random() * 1e9) : /^-?\d+$/.test(raw) ? Number(raw) : raw;
      const opts = { seed, scenarioId: F.scenarioId || DEFAULT_SCENARIO, difficulty: F.difficulty || 'normal' };
      if (String(F.colony || '').trim()) opts.colonyName = String(F.colony).trim();
      if (String(F.leader || '').trim()) opts.leaderName = String(F.leader).trim();
      try {
        game.newGame(opts);
      } catch (err) {
        game.error(err, 'ui.newGame');
        say(String(err?.message || err), true);
        return false;
      }
      act.closeAll(true);
      return true;
    },
    loadSlot(slot) {
      let ok = false;
      try {
        ok = game.save.loadSlot(slot);
      } catch (err) {
        console.warn('[ui] сейв не загрузился:', err?.message || err);
        ok = false;
      }
      if (!ok) {
        refreshSlots();
        say(game.t('ui.slots.failed'), true);
        return false;
      }
      act.closeAll(true);
      return true;
    },
    saveSlot(slot) {
      const bytes = game.save.saveSlot(slot);
      refreshSlots();
      if (bytes > 0) {
        say(game.t('ui.slots.saved', { slot: slotName(game, slot) }));
        if (top() === 'save') act.back();
      }
      return bytes;
    },
  };
  M.act = act;

  // пустая модальная панель — «экран открыт» для ядра и модулей (лидер стоит, панели модулей не всплывают)
  game.ui.registerPanel({ id: PANEL, title: '', width: 1, height: 1, anchor: 'ui-screen', modal: true, draw() {} }, OWNER);

  // ---------- События ----------
  game.events.on(EVENTS.UI_MENU_REQUESTED, () => {
    if (!R.screen.length && game.map) act.open('pause');
  }, OWNER);
  game.events.on(EVENTS.COLONY_LOST, ({ day } = {}) => {
    R.lostDay = day ?? game.time.day;
    act.only('over');
  }, OWNER);
  game.events.on(EVENTS.GAME_VICTORY, (e = {}) => {
    R.victory = { ending: e.ending || '', stats: { ...(e.stats || {}) } };
    act.only('victory');
  }, OWNER);
  const dropStale = () => {
    const id = top();
    if (id === 'over' || id === 'victory' || id === 'pause') act.closeAll();
  };
  game.events.on(EVENTS.COLONY_STARTED, dropStale, OWNER);
  game.events.on(EVENTS.LOAD_AFTER, dropStale, OWNER);

  // Автосохранение, когда вкладку прячут или закрывают (DOM — только из кадра, не из register()).
  const hookPageHide = (g) => {
    if (R.pageHideHooked || typeof document === 'undefined' || typeof window === 'undefined') return;
    R.pageHideHooked = true;
    const saveNow = () => {
      if (!g.map || g.colony?.lost || R.screen.some((id) => id === 'main' || id === 'over' || id === 'victory')) return;
      try {
        if (g.save.saveSlot('auto') > 0) R.slotsCache = null;
      } catch (err) {
        console.warn('[ui] автосохранение при скрытии вкладки не удалось:', err?.message || err);
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });
    window.addEventListener('pagehide', saveNow);
  };

  // ---------- Кадр: захват ввода экранами, автосохранение, обучение ----------
  game.frameSystems.add({
    id: 'ui:capture',
    order: 1,
    update(g, dt) {
      R.realTime += Number.isFinite(dt) ? dt : 0;
      const inp = g.input;
      const cap = M.kit.cap;
      if (!R.booted) {
        R.booted = true;
        if (!g.isHeadless && menuAtBoot()) act.only('main');
        if (!g.isHeadless) hookPageHide(g);
      }
      if (R.screen.length && !g.isHeadless) {
        if (inp.textCapture === null) inp.captureText('ui');
        cap.click = inp.keyPressed('Mouse0');
        cap.rclick = inp.keyPressed('Mouse2');
        cap.wheel = inp.mouse.wheel;
        inp.mouse.wheel = 0;
        for (const c of ['Mouse0', 'Mouse1', 'Mouse2']) inp.consumeCode(c);
        if (inp.pressed('ui:back')) {
          inp.consume('ui:back');
          if (M.kit.textFocus) M.kit.blurText();
          else act.escape();
        }
        panelSync();
      } else {
        cap.click = cap.rclick = false;
        cap.wheel = 0;
        if (inp.textCapture === 'ui' && !M.kit.textFocus) inp.releaseText();
        if (!g.isHeadless) panelSync();
      }
      // автосохранение: начало игры и прибытие на станцию (за главным меню — не сохраняем: это фон, не игра)
      if (R.pendingAutosave && R.screen.includes('main')) R.pendingAutosave = null;
      if (R.pendingAutosave && g.map && !g.colony.lost && !R.screen.length) {
        R.pendingAutosave = null;
        const bytes = g.save.saveSlot('auto');
        R.slotsCache = null;
        if (bytes > 0) g.api.ui.notify(g.t('ui.slots.autosaved'), { type: 'info' });
      }
      tutorialFrame(g, M);
      // стартовый тост ядра «WASD — идти…» дублирует обучение — не показываем его, пока обучение идёт
      if (R.hideStartHint && g.log.length) {
        R.hideStartHint = false;
        if (tutorialActive(M)) {
          const txt = g.t('hint.start');
          for (const e of g.log.slice(-6)) if (e && e.text === txt) e._shownAt = -1e12;
        }
      }
      if (R.tutDoneAt >= 0 && R.tutDoneShown !== R.tutDoneAt) {
        R.tutDoneShown = R.tutDoneAt;
        g.api.ui.notify(g.t('ui.tut.done'), { type: 'good' });
      }
    },
  }, OWNER);

  // ---------- Отрисовка ----------
  game.render.registerLayer({
    id: 'ui:screens',
    order: 850,
    space: 'screen',
    draw(ctx, g, view) {
      if (R.screen.length) drawScreens(ctx, g, M, view);
      else if (M.kit.tipLines) M.kit.drawTip(ctx, view.w, view.h);
    },
  }, OWNER);
  game.ui.registerHud({
    id: 'ui:tutorial',
    slot: 'bottom-left',
    order: 50,
    height: (g, ui) => tutorialHeight(g, M, ui),
    draw: (ctx, g, ui, box) => drawTutorial(ctx, g, M, box),
  }, OWNER);
  // строка клавиш ядра — та же, но не наезжает на панель заклинаний (bottom-center)
  if (game.ui.hud.has('core:controls')) {
    game.ui.hud.remove('core:controls');
    game.ui.registerHud({
      id: 'core:controls',
      slot: 'bottom-right',
      order: 10,
      height: 18,
      draw(ctx, g, ui, box) {
        const avail = box.x - (ui.w / 2 + 150);
        if (avail < 160) return 18;
        let parts = g.t('hud.controls').split(' · ');
        let size = 11;
        ctx.font = ui.font(size);
        if (ctx.measureText(parts.join(' · ')).width > avail) {
          size = 10;
          ctx.font = ui.font(size);
        }
        while (parts.length > 1 && ctx.measureText(parts.join(' · ')).width > avail) parts = parts.slice(0, -1);
        ui.text(parts.join(' · '), box.x, box.y + 2, { align: 'right', size, color: 'rgba(140,147,184,0.85)' });
        return 18;
      },
    }, OWNER);
  }

  // ---------- API ----------
  game.provide('ui', {
    screen: () => top(),
    openScreen: (id) => act.open(id),
    closeScreens: () => act.closeAll(),
    newGameForm() {
      if (!R.ng) initForm();
      return R.ng;
    },
    menuAction(name, arg) {
      switch (name) {
        case 'new': return act.open('new');
        case 'start': return act.startNewGame(arg ? { ...(R.ng || {}), ...arg } : R.ng);
        case 'loadSlot': return act.loadSlot(arg);
        case 'saveSlot': return act.saveSlot(arg);
        case 'back': return act.back();
        case 'escape': return act.escape();
        case 'exit': return act.exitToMenu();
        case 'resume': return act.closeAll();
        default: return act.open(name);
      }
    },
    widgetRect: (id) => {
      const r = M.kit.rects.get(id);
      return r ? { ...r } : null;
    },
    tutorial: () => ({ step: currentStep(M)?.id ?? null, done: { ...(M.S.tutorial?.done || {}) }, finished: !!M.S.tutorial?.finished, active: tutorialActive(M) }),
  }, OWNER);
}
