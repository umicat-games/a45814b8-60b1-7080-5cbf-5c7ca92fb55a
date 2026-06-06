import Phaser from 'phaser';

/**
 * UIScene — intentionally minimal for this game.
 * All HUD is rendered directly in GameScene.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // HUD rendered in GameScene directly
  }
}
