// Сборка игры: ядро → строки → симуляция → игрок → рендер/HUD → модули (манифест) → init.
// Одинаково для браузера и headless (рендер-слои только регистрируются, рисует main.js).
import { Game } from './game.js';
import { registerCoreStrings } from './strings.js';
import { registerSim, startNewColony } from '../sim/index.js';
import { registerPlayer } from '../player/controller.js';
import { registerCoreRender } from '../render/index.js';
import { registerEngineDefs } from '../engine/index.js';
import { registerModules } from '../modules.js';

/**
 * @param {{headless?: boolean, seed?: number|string, storage?: object, modules?: boolean}} [opts]
 * @returns {Promise<Game>}
 */
export async function createGame(opts = {}) {
  const game = new Game(opts);
  registerCoreStrings(game);
  registerEngineDefs(game);
  registerSim(game);
  registerPlayer(game);
  registerCoreRender(game);
  if (opts.modules !== false) await registerModules(game);
  game.init();
  return game;
}

export { startNewColony };
