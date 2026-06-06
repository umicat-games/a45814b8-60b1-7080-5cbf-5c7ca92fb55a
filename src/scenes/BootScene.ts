import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    drawLoadingBar(this);
  }

  create(): void {
    this.scene.start('GameScene');
  }
}

function drawLoadingBar(scene: Phaser.Scene): void {
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;
  const barW = Math.min(480, GAME_WIDTH * 0.6);
  const barH = 24;

  const label = scene.add
    .text(cx, cy - 40, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#00eaff',
    })
    .setOrigin(0.5);

  const track = scene.add
    .rectangle(cx, cy, barW, barH, 0x111122)
    .setStrokeStyle(2, 0x00eaff);
  const fill = scene.add
    .rectangle(cx - barW / 2 + 2, cy, 0, barH - 4, 0x00eaff)
    .setOrigin(0, 0.5);

  scene.load.on('progress', (value: number) => {
    fill.width = (barW - 4) * value;
  });
  scene.load.on('complete', () => {
    label.destroy();
    track.destroy();
    fill.destroy();
  });
}
