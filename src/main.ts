import { createUmicatGame } from '@umicat/phaser-sdk';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin.js';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

createUmicatGame({
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scenes: [BootScene, GameScene, UIScene],
  // rexUI scene plugin → `this.rexUI` in scenes (buttons, sliders, etc.).
  plugins: {
    scene: [{ key: 'rexUI', plugin: RexUIPlugin, mapping: 'rexUI' }],
  },
});
