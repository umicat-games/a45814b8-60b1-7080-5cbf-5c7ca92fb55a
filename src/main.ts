import { createUmicatGame } from '@umicat/phaser-sdk';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

createUmicatGame({
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scenes: [BootScene, GameScene, UIScene],
});
