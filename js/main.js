// Точка входа в браузере: создаёт игру, подключает DOM (канвас, ввод, звук), запускает цикл.
// Фиксированный шаг симуляции 1/60 с, до MAX_STEPS_PER_FRAME шагов за кадр, скорости 0/1/2/3.
// Параметры адреса (для отладки): ?seed=42&scenario=standard&difficulty=normal
import { createGame } from './core/boot.js';
import { DT, MAX_STEPS_PER_FRAME } from './core/constants.js';
import { Renderer } from './render/renderer.js';

async function boot() {
  const canvas = document.getElementById('game');
  const params = new URLSearchParams(location.search);
  const seed = params.has('seed') ? Number(params.get('seed')) || params.get('seed') : Math.floor(Math.random() * 1e9);
  const game = await createGame({ headless: false, seed });
  window.__game = game; // отладка: единственный глобал

  game.input.attach(canvas);
  const renderer = new Renderer(game, canvas);
  game.renderer = renderer;

  // Сцена за главным меню: модуль ui покажет меню поверх и вызовет game.newGame(opts) / game.save.loadSlot(slot).
  if (!game.map) {
    game.newGame({
      seed,
      scenarioId: params.get('scenario') || undefined,
      difficulty: params.get('difficulty') || undefined,
    });
  }

  const perf = (game.perf = { fps: 60, frameMs: 0, steps: 0 });
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let fpsN = 0;

  function loop(now) {
    // следующий кадр планируем сразу: исключение в кадре не должно останавливать игру
    requestAnimationFrame(loop);
    const dtReal = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    try {
      game.frame(dtReal);
      if (!game.paused) {
        acc += dtReal * game.speed * game.timeScale;
        let steps = 0;
        const maxSteps = MAX_STEPS_PER_FRAME;
        while (acc >= DT && steps < maxSteps) {
          game.step();
          acc -= DT;
          steps++;
        }
        if (steps >= maxSteps) acc = Math.min(acc, DT); // не догоняем бесконечно (защита от «спирали смерти»)
        perf.steps = steps;
      } else acc = 0;
      renderer.frame(dtReal);
    } catch (err) {
      game.error(err, 'main.loop');
    } finally {
      game.input.endFrame();
    }
    perf.frameMs = perf.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    fpsT += dtReal;
    fpsN++;
    if (fpsT >= 0.5) {
      perf.fps = fpsN / fpsT;
      fpsT = 0;
      fpsN = 0;
    }
  }
  requestAnimationFrame(loop);
  document.body.classList.add('ready');
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-error');
  if (el) {
    el.textContent = `Ошибка запуска: ${err.message}`;
    el.style.display = 'block';
  }
});
