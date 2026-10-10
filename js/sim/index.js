// Регистрация всего содержимого и систем симуляции ядра (без DOM).
import { registerMapDefs } from './map.js';
import { registerItemDefs, registerHaulJob } from './items.js';
import { registerContentDefs } from './content.js';
import { registerJobDefs } from './jobs.js';
import { registerBiomes } from './worldgen.js';
import { registerTrainDefs } from './train.js';
import { registerPawnSystems } from './pawn.js';
import { registerNeeds } from './needs.js';
import { registerColony } from './colony.js';
import { registerAI } from '../ai/ai.js';

export function registerSim(game) {
  registerMapDefs(game);
  registerItemDefs(game);
  registerContentDefs(game);
  registerBiomes(game);
  registerTrainDefs(game);
  registerJobDefs(game);
  registerHaulJob(game);
  registerAI(game);
  registerNeeds(game);
  registerPawnSystems(game);
  registerColony(game);
}

export { startNewColony } from './colony.js';
