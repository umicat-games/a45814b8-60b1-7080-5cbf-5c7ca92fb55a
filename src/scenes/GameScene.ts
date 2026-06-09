import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const GROUND_Y = GAME_HEIGHT - 80;
const PLAYER_SIZE = 38;
const SCROLL_SPEED = 480; // px/s
const JUMP_VEL = -620;
const GRAVITY = 1400;
const SPIKE_W = 40;
const SPIKE_H = 40;

interface Obstacle {
  type: 'spike' | 'block' | 'double_spike' | 'gap_platform';
  x: number;
  gfx: Phaser.GameObjects.Graphics;
  hitboxes: { x: number; y: number; w: number; h: number }[];
}

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Graphics;
  private playerY = 0;
  private playerVY = 0;
  private playerX = 220;
  private onGround = false;
  private dead = false;
  private started = false;

  private worldX = 0; // how far world has scrolled
  private nextObstacleX = 900;
  private obstacles: Obstacle[] = [];

  private groundGfx!: Phaser.GameObjects.Graphics;
  private bgGfx!: Phaser.GameObjects.Graphics;
  private deathParticles: { x: number; y: number; vx: number; vy: number; life: number; color: number }[] = [];
  private particleGfx!: Phaser.GameObjects.Graphics;

  private scoreText!: Phaser.GameObjects.Text;
  private distance = 0;
  private bestDistance = 0;
  private bestText!: Phaser.GameObjects.Text;

  private promptText!: Phaser.GameObjects.Text;
  private deathOverlay!: Phaser.GameObjects.Container;

  private jumpKey!: Phaser.Input.Keyboard.Key;
  private wKey!: Phaser.Input.Keyboard.Key;

  private trailPoints: { x: number; y: number; alpha: number }[] = [];
  private trailGfx!: Phaser.GameObjects.Graphics;

  private playerAngle = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.dead = false;
    this.started = false;
    this.worldX = 0;
    this.distance = 0;
    this.playerY = GROUND_Y - PLAYER_SIZE;
    this.playerVY = 0;
    this.onGround = true;
    this.obstacles = [];
    this.deathParticles = [];
    this.trailPoints = [];
    this.playerAngle = 0;
    this.nextObstacleX = 800;

    // Load best distance
    try {
      const stored = localStorage.getItem('gd_best');
      if (stored) this.bestDistance = parseInt(stored, 10);
    } catch (_) {}

    // Background
    this.bgGfx = this.add.graphics().setDepth(0);
    this.drawBackground();

    // Ground
    this.groundGfx = this.add.graphics().setDepth(1);
    this.drawGround();

    // Trail
    this.trailGfx = this.add.graphics().setDepth(2);

    // Particle
    this.particleGfx = this.add.graphics().setDepth(5);

    // Player
    this.player = this.add.graphics().setDepth(4);
    this.drawPlayer();

    // Score
    this.scoreText = this.add.text(GAME_WIDTH / 2, 24, '0 m', {
      fontFamily: 'monospace',
      fontSize: '26px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(10);

    this.bestText = this.add.text(GAME_WIDTH / 2, 58, `Best: ${this.bestDistance} m`, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#aaaaff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(10);

    // Prompt
    this.promptText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60,
      'PRESS SPACE OR TAP TO START', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffdd00',
        stroke: '#000000',
        strokeThickness: 5,
      }).setOrigin(0.5).setDepth(10);

    // Title
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, 'GEOMETRY RUSH', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00eaff',
      stroke: '#003366',
      strokeThickness: 8,
    }).setOrigin(0.5).setDepth(10);

    // Death overlay (hidden)
    this.deathOverlay = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(20).setAlpha(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x000000, 0.7);
    panel.fillRoundedRect(-200, -80, 400, 180, 16);
    const dTitle = this.add.text(0, -50, 'YOU CRASHED!', {
      fontFamily: 'monospace', fontSize: '32px', color: '#ff4444', stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5);
    const dSub = this.add.text(0, 10, '', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffffff', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setName('sub');
    const dRestart = this.add.text(0, 60, '[ SPACE / TAP to retry ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaffaa', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.deathOverlay.add([panel, dTitle, dSub, dRestart]);

    // Input
    this.jumpKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);

    this.input.on('pointerdown', () => this.handleJump());
    this.jumpKey.on('down', () => this.handleJump());
    this.wKey.on('down', () => this.handleJump());
    this.input.keyboard!.on('keydown-UP', () => this.handleJump());

    // Spawn initial safe ground section
    this.spawnObstacles();
  }

  private drawBackground(): void {
    const g = this.bgGfx;
    g.clear();
    // Sky gradient via multiple rects
    const colors = [0x0a0a1e, 0x0d1233, 0x10184a, 0x121e5e];
    const segH = GAME_HEIGHT / colors.length;
    colors.forEach((c, i) => {
      g.fillStyle(c);
      g.fillRect(0, i * segH, GAME_WIDTH, segH + 1);
    });

    // Grid lines (moving with worldX)
    const gridSpacing = 80;
    const offsetX = this.worldX % gridSpacing;
    g.lineStyle(1, 0x1a2a6e, 0.5);
    // vertical
    for (let x = -offsetX; x < GAME_WIDTH; x += gridSpacing) {
      g.lineBetween(x, 0, x, GROUND_Y);
    }
    // horizontal
    for (let y = 0; y < GROUND_Y; y += gridSpacing) {
      g.lineBetween(0, y, GAME_WIDTH, y);
    }
  }

  private drawGround(): void {
    const g = this.groundGfx;
    g.clear();

    // Ground body
    g.fillStyle(0x1a1a3e);
    g.fillRect(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);

    // Ground top line highlight
    g.lineStyle(3, 0x00eaff, 1);
    g.lineBetween(0, GROUND_Y, GAME_WIDTH, GROUND_Y);

    // Ground grid pattern
    const segW = 60;
    const offsetX = this.worldX % segW;
    g.lineStyle(1, 0x2a2a6e, 0.7);
    for (let x = -offsetX; x < GAME_WIDTH; x += segW) {
      g.lineBetween(x, GROUND_Y, x, GAME_HEIGHT);
    }
    for (let y = GROUND_Y + 20; y < GAME_HEIGHT; y += 20) {
      g.lineBetween(0, y, GAME_WIDTH, y);
    }

    // Glow under top line
    g.lineStyle(8, 0x00eaff, 0.15);
    g.lineBetween(0, GROUND_Y + 4, GAME_WIDTH, GROUND_Y + 4);
  }

  private drawPlayer(): void {
    const g = this.player;
    g.clear();

    const s = PLAYER_SIZE;
    const hs = s / 2;

    // Translate pivot to center of player, apply rotation
    const cx = this.playerX;
    const cy = this.playerY + hs;

    // Shadow/glow
    g.fillStyle(0x00eaff, 0.2);
    g.fillRect(cx - hs - 4, cy - hs - 4, s + 8, s + 8);

    // Outer square (rotated manually)
    const angle = this.playerAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners = [
      [-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]
    ].map(([lx, ly]) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }));

    // Outer body
    g.fillStyle(0x00eaff);
    g.fillPoints(corners, true);

    // Inner square decoration
    const inner = s * 0.3;
    const innerCorners = [
      [-inner, -inner], [inner, -inner], [inner, inner], [-inner, inner]
    ].map(([lx, ly]) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }));
    g.fillStyle(0x003355);
    g.fillPoints(innerCorners, true);

    // Center dot
    g.fillStyle(0x00eaff);
    g.fillCircle(cx, cy, 4);

    // Border glow lines
    g.lineStyle(2, 0xffffff, 0.8);
    g.strokePoints(corners, true);
  }

  private drawTrail(): void {
    const g = this.trailGfx;
    g.clear();
    const hs = PLAYER_SIZE / 2;
    for (const pt of this.trailPoints) {
      g.fillStyle(0x00eaff, pt.alpha * 0.5);
      const sz = hs * pt.alpha;
      g.fillRect(pt.x - sz, pt.y - sz, sz * 2, sz * 2);
    }
  }

  private drawSpike(g: Phaser.GameObjects.Graphics, screenX: number, groundY: number): void {
    // Single spike triangle
    g.fillStyle(0xff3333);
    g.fillTriangle(
      screenX, groundY,
      screenX + SPIKE_W / 2, groundY - SPIKE_H,
      screenX + SPIKE_W, groundY
    );
    // Highlight edge
    g.lineStyle(2, 0xff8888, 0.8);
    g.strokeTriangle(
      screenX, groundY,
      screenX + SPIKE_W / 2, groundY - SPIKE_H,
      screenX + SPIKE_W, groundY
    );
  }

  private drawBlock(g: Phaser.GameObjects.Graphics, screenX: number, groundY: number, w: number, h: number): void {
    g.fillStyle(0x2244aa);
    g.fillRect(screenX, groundY - h, w, h);
    g.lineStyle(2, 0x4466ff, 1);
    g.strokeRect(screenX, groundY - h, w, h);
    // Inner cross
    g.lineStyle(1, 0x3355cc, 0.6);
    g.lineBetween(screenX, groundY - h, screenX + w, groundY);
    g.lineBetween(screenX + w, groundY - h, screenX, groundY);
  }

  private spawnObstacles(): void {
    // Build a set of obstacles ahead of time
    const patterns: { type: Obstacle['type']; spacing: number }[] = [
      { type: 'spike', spacing: 320 },
      { type: 'spike', spacing: 280 },
      { type: 'double_spike', spacing: 380 },
      { type: 'block', spacing: 350 },
      { type: 'spike', spacing: 260 },
      { type: 'gap_platform', spacing: 420 },
    ];

    for (const p of patterns) {
      this.spawnObstacle(this.nextObstacleX, p.type);
      this.nextObstacleX += p.spacing + Phaser.Math.Between(20, 100);
    }
  }

  private spawnObstacle(worldXPos: number, type: Obstacle['type']): void {
    const g = this.add.graphics().setDepth(3);
    const hitboxes: Obstacle['hitboxes'] = [];

    if (type === 'spike') {
      hitboxes.push({ x: worldXPos + 4, y: GROUND_Y - SPIKE_H, w: SPIKE_W - 8, h: SPIKE_H });
    } else if (type === 'double_spike') {
      hitboxes.push({ x: worldXPos + 4, y: GROUND_Y - SPIKE_H, w: SPIKE_W - 8, h: SPIKE_H });
      hitboxes.push({ x: worldXPos + SPIKE_W + 6, y: GROUND_Y - SPIKE_H, w: SPIKE_W - 8, h: SPIKE_H });
    } else if (type === 'block') {
      const bw = 55, bh = 55;
      hitboxes.push({ x: worldXPos, y: GROUND_Y - bh, w: bw, h: bh });
    } else if (type === 'gap_platform') {
      // A raised platform with spikes on top
      const bw = 80, bh = 80;
      hitboxes.push({ x: worldXPos, y: GROUND_Y - bh, w: bw, h: bh });
      hitboxes.push({ x: worldXPos + 8, y: GROUND_Y - bh - SPIKE_H, w: SPIKE_W - 8, h: SPIKE_H });
    }

    this.obstacles.push({ type, x: worldXPos, gfx: g, hitboxes });
  }

  private renderObstacle(obs: Obstacle): void {
    const g = obs.gfx;
    g.clear();
    const sx = obs.x - this.worldX; // screen x

    if (obs.type === 'spike') {
      this.drawSpike(g, sx, GROUND_Y);
    } else if (obs.type === 'double_spike') {
      this.drawSpike(g, sx, GROUND_Y);
      this.drawSpike(g, sx + SPIKE_W + 2, GROUND_Y);
    } else if (obs.type === 'block') {
      this.drawBlock(g, sx, GROUND_Y, 55, 55);
    } else if (obs.type === 'gap_platform') {
      this.drawBlock(g, sx, GROUND_Y, 80, 80);
      this.drawSpike(g, sx + 8, GROUND_Y - 80);
    }
  }

  private handleJump(): void {
    if (!this.started) {
      this.started = true;
      this.promptText.setVisible(false);
      // Hide title text
      this.children.list
        .filter(c => c instanceof Phaser.GameObjects.Text && (c as Phaser.GameObjects.Text).text === 'GEOMETRY RUSH')
        .forEach(c => c.destroy());
    }

    if (this.dead) {
      this.restartGame();
      return;
    }

    if (this.onGround) {
      this.playerVY = JUMP_VEL;
      this.onGround = false;

      // Jump flash
      this.tweens.add({
        targets: this.player,
        alpha: 0.4,
        duration: 60,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }
  }

  private checkCollision(): boolean {
    const px = this.playerX + 4;
    const py = this.playerY + 4;
    const pw = PLAYER_SIZE - 8;
    const ph = PLAYER_SIZE - 8;

    for (const obs of this.obstacles) {
      for (const hb of obs.hitboxes) {
        const hbScreenX = hb.x - this.worldX;
        if (
          px < hbScreenX + hb.w &&
          px + pw > hbScreenX &&
          py < hb.y &&
          py + ph > hb.y
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private killPlayer(): void {
    this.dead = true;

    // Explosion particles
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const speed = Phaser.Math.Between(80, 260);
      this.deathParticles.push({
        x: this.playerX + PLAYER_SIZE / 2,
        y: this.playerY + PLAYER_SIZE / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 1,
        color: i % 2 === 0 ? 0x00eaff : 0xffffff,
      });
    }

    this.player.setVisible(false);

    // Camera shake effect
    this.cameras.main.shake(300, 0.012);

    // Save best
    if (this.distance > this.bestDistance) {
      this.bestDistance = this.distance;
      try { localStorage.setItem('gd_best', String(this.bestDistance)); } catch (_) {}
    }

    // Show death overlay
    const sub = this.deathOverlay.getByName('sub') as Phaser.GameObjects.Text;
    sub.setText(`Distance: ${this.distance} m   Best: ${this.bestDistance} m`);
    this.tweens.add({
      targets: this.deathOverlay,
      alpha: 1,
      duration: 300,
      ease: 'Quad.easeOut',
    });
  }

  private restartGame(): void {
    this.scene.restart();
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;

    if (!this.started || this.dead) {
      // Still draw bg and player idle
      this.drawBackground();
      this.drawGround();
      this.drawPlayer();
      if (this.dead) {
        this.updateParticles(dt);
        this.drawParticles();
      }
      return;
    }

    // Scroll world
    this.worldX += SCROLL_SPEED * dt;
    this.distance = Math.floor(this.worldX / 100);
    this.scoreText.setText(`${this.distance} m`);
    this.bestText.setText(`Best: ${this.bestDistance} m`);

    // Gravity
    this.playerVY += GRAVITY * dt;
    this.playerY += this.playerVY * dt;

    // Ground collision
    const groundPlayerY = GROUND_Y - PLAYER_SIZE;
    if (this.playerY >= groundPlayerY) {
      this.playerY = groundPlayerY;
      this.playerVY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Rotate player when airborne
    if (!this.onGround) {
      this.playerAngle += 4 * dt;
    } else {
      // Snap to nearest 90°
      const snap = Math.round(this.playerAngle / (Math.PI / 2)) * (Math.PI / 2);
      this.playerAngle += (snap - this.playerAngle) * Math.min(1, dt * 15);
    }

    // Trail
    this.trailPoints.unshift({
      x: this.playerX + PLAYER_SIZE / 2,
      y: this.playerY + PLAYER_SIZE / 2,
      alpha: 0.7,
    });
    if (this.trailPoints.length > 8) this.trailPoints.pop();
    for (const pt of this.trailPoints) pt.alpha *= 0.85;

    // Spawn more obstacles if needed
    if (this.nextObstacleX - this.worldX < GAME_WIDTH + 200) {
      this.spawnObstacles();
    }

    // Remove off-screen obstacles
    this.obstacles = this.obstacles.filter(obs => {
      if (obs.x - this.worldX < -200) {
        obs.gfx.destroy();
        return false;
      }
      return true;
    });

    // Collision check
    if (this.checkCollision()) {
      this.killPlayer();
      return;
    }

    // Render
    this.drawBackground();
    this.drawGround();
    this.drawTrail();

    for (const obs of this.obstacles) {
      this.renderObstacle(obs);
    }

    this.drawPlayer();

    this.updateParticles(dt);
    this.drawParticles();
  }

  private updateParticles(dt: number): void {
    for (const p of this.deathParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt * 1.5;
    }
    this.deathParticles = this.deathParticles.filter(p => p.life > 0);
  }

  private drawParticles(): void {
    const g = this.particleGfx;
    g.clear();
    for (const p of this.deathParticles) {
      const sz = 6 * p.life;
      g.fillStyle(p.color, p.life);
      g.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
  }
}
