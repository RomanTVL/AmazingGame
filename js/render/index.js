// Регистрация слоёв отрисовки ядра (безопасно в headless — функции вызываются только в браузере).
import { TileRenderer } from './tiles.js';
import { Lighting } from './lighting.js';
import { FogRenderer } from './fog.js';
import { makeKindLayer, emissiveLayer, registerEntityDrawers } from './entities.js';
import { pawnDrawer } from './pawns.js';
import { waterFxLayer, zonesLayer, designationsLayer, overlayLayer, trainDecoLayer } from './overlays.js';
import { registerCoreHud, cursorLayer } from './hud.js';

export function registerCoreRender(game) {
  const r = game.render;
  registerEntityDrawers(game);
  r.registerDrawer('pawn', pawnDrawer);

  const tiles = new TileRenderer(game);
  const lighting = new Lighting(game);
  const fog = new FogRenderer(game);
  r.tiles = tiles;
  r.lighting = lighting;
  r.fog = fog;

  r.registerLayer({ id: 'ground', order: 0, draw: (ctx, g, v) => tiles.draw(ctx, g, v) });
  r.registerLayer(waterFxLayer());
  r.registerLayer(zonesLayer());
  r.registerLayer(makeKindLayer('decals', 30, 'decal'));
  r.registerLayer(makeKindLayer('items', 40, 'item'));
  r.registerLayer(makeKindLayer('plants', 45, 'plant', true, (e, g) => g.defs.plants.get(e.defId)?.bake === false));
  r.registerLayer(makeKindLayer('buildings', 50, 'building', true, (e, g) => !g.defs.buildings.get(e.defId)?.bake));
  r.registerLayer(makeKindLayer('corpses', 55, 'corpse'));
  r.registerLayer(makeKindLayer('pawns', 60, 'pawn', true));
  r.registerLayer(trainDecoLayer());
  r.registerLayer(makeKindLayer('projectiles', 70, 'projectile'));
  r.registerLayer({ id: 'particles', order: 80, draw: (ctx, g, v) => g.fx.draw(ctx, v, false) });
  r.registerLayer({ id: 'tint', order: 88, space: 'screen', draw: (ctx, g, v) => lighting.drawTint(ctx, g, v) });
  r.registerLayer({ id: 'lighting', order: 90, space: 'screen', draw: (ctx, g, v) => lighting.drawDarkness(ctx, g, v) });
  r.registerLayer(emissiveLayer());
  r.registerLayer({ id: 'particles-glow', order: 93, draw: (ctx, g, v) => g.fx.draw(ctx, v, true) });
  r.registerLayer({ id: 'fog', order: 95, draw: (ctx, g, v) => fog.draw(ctx, g, v) });
  r.registerLayer(designationsLayer());
  r.registerLayer(overlayLayer());
  r.registerLayer({ id: 'ui', order: 200, space: 'screen', draw: (ctx, g, v) => g.ui.drawAll(ctx, g, v.w, v.h) });
  r.registerLayer(cursorLayer());

  // свет поезда
  r.registerLightSource({
    id: 'train',
    collect(game, view, out) {
      const train = game.train;
      if (!train?.stamped) return;
      for (const L of train.lights()) {
        if (L.x < view.x0 - 8 || L.x > view.x1 + 8 || L.y < view.y0 - 8 || L.y > view.y1 + 8) continue;
        out.push(L);
      }
    },
  });

  registerCoreHud(game);
}
