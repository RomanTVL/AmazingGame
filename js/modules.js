// МАНИФЕСТ МОДУЛЕЙ. Каждый модуль — папка js/modules/<имя>/ с точкой входа index.js,
// экспортирующей register(game). Порядок регистрации важен: модули, чьи API нужны другим,
// регистрируются раньше (но вызовы через game.api.* безопасны в любом порядке — есть заглушки).
//
// Правила (подробно — docs/ARCHITECTURE.md):
//  - модуль правит ТОЛЬКО файлы в своей папке;
//  - в register() нельзя трогать DOM (headless-тесты); DOM — только лениво в draw/handleInput;
//  - расширение — через реестры (game.defs.*, game.systems, game.render, game.ui, game.input, game.save),
//    события (game.events) и межмодульный API (game.provide / game.api).
import * as vision from './modules/vision/index.js';
import * as mind from './modules/mind/index.js';
import * as health from './modules/health/index.js';
import * as economy from './modules/economy/index.js';
import * as build from './modules/build/index.js';
import * as combat from './modules/combat/index.js';
import * as journey from './modules/journey/index.js';
import * as ui from './modules/ui/index.js';
import * as av from './modules/av/index.js';

export const MODULES = [
  ['vision', vision],
  ['mind', mind],
  ['health', health],
  ['economy', economy],
  ['build', build],
  ['combat', combat],
  ['journey', journey],
  ['ui', ui],
  ['av', av],
];

export async function registerModules(game) {
  for (const [id, mod] of MODULES) {
    try {
      await mod.register(game);
      game.modules.push(id);
    } catch (err) {
      game.error(err, `module:${id}`);
    }
  }
}
