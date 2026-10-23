import { DepthSensingSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { loadBrandFonts } from './brand.js';
import { mountHud } from './hud.js';
import './hud.css';
import { installPerfProbe } from './perf.js';
import { ThyraSystem } from './thyra-system.js';

void loadBrandFonts();

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.renderer.setClearColor(0x000000, 0);
  // Real-world occlusion when the runtime offers depth (Quest 3, IWER SEM): your hand in front
  // of a door hides the world behind it. Depth is requested as optional; without it nothing breaks.
  world.registerSystem(DepthSensingSystem, {
    configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true, blurRadius: 20 },
  });
  world.registerSystem(ThyraSystem);
  installPerfProbe(world);
  mountHud(world);
});
