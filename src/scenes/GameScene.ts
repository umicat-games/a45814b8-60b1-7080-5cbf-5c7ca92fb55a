import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const GROUND_Y = GAME_HEIGHT - 80;
const PLAYER_SIZE = 38;
const SCROLL_SPEED = 540; // px/s
const JUMP_VEL = -550;    // lower jump (~98px peak ≈ 2.6 player heights) — more Geometry-Dash-like
const GRAVITY = 1550;     // snappier arc; horizontal jump distance kept ~383px so obstacles still clear
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

  private deathOverlay!: Phaser.GameObjects.Container;

  private jumpKey!: Phaser.Input.Keyboard.Key;
  private wKey!: Phaser.Input.Keyboard.Key;

  private trailPoints: { x: number; y: number; alpha: number }[] = [];
  private trailGfx!: Phaser.GameObjects.Graphics;

  private playerAngle = 0;

  // Live-tunable (debug): adjustable in-game + persisted across deaths via the
  // game registry. Defaults come from the SCROLL_SPEED / JUMP_VEL constants.
  private scrollSpeed = SCROLL_SPEED;
  private jumpVel = JUMP_VEL;
  private gravity = GRAVITY;
  private menuContainer?: Phaser.GameObjects.Container;
  private settingsContainer?: Phaser.GameObjects.Container;
  private settingsRefreshers: (() => void)[] = [];

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

    // Start menu (title + START + SETTINGS) and the settings slider panel are
    // built in buildSettings()/buildMenu() below.

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

    // Raw screen taps only jump/retry while playing or dead — on the menu the
    // START/SETTINGS buttons handle their own clicks (so a button tap doesn't
    // also start the run). SPACE/W/UP still start from the menu (keyboard).
    this.input.on('pointerdown', () => { if (this.started || this.dead) this.handleJump(); });
    this.jumpKey.on('down', () => this.handleJump());
    this.wKey.on('down', () => this.handleJump());
    this.input.keyboard!.on('keydown-UP', () => this.handleJump());

    // Restore tuned values (persisted across deaths via the game registry),
    // then build the start menu + settings slider panel.
    this.scrollSpeed = (this.registry.get('dbgSpeed') as number) ?? SCROLL_SPEED;
    this.jumpVel = (this.registry.get('dbgJump') as number) ?? JUMP_VEL;
    this.gravity = (this.registry.get('dbgGrav') as number) ?? GRAVITY;
    this.buildSettings();
    this.buildMenu();

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
      g.fillStyle(0x00eaff, pt.alpha * 0.6);
      const sz = hs * (0.4 + 0.6 * pt.alpha); // gentler shrink so far points aren't tiny specks
      // pt.x is a WORLD coord — subtract the current worldX so older points
      // streak left behind the (screen-fixed) player as the world scrolls.
      const screenX = pt.x - this.worldX;
      g.fillRect(screenX - sz, pt.y - sz, sz * 2, sz * 2);
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

  // ── Start menu + settings UI ─────────────────────────────────────────────
  private startRun(): void {
    if (this.started) return;
    this.started = true;
    this.menuContainer?.setVisible(false);
    this.settingsContainer?.setVisible(false);
  }

  /** Rounded-rect button with hover. Returns a container (add it to a parent). */
  private makeButton(
    x: number, y: number, w: number, h: number, label: string, color: number, onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(color, hover ? 1 : 0.85);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      g.lineStyle(3, 0xffffff, hover ? 0.95 : 0.5);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    };
    draw(false);
    const t = this.add.text(0, 0, label, {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);
    c.add([g, t]);
    c.setSize(w, h);
    c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => draw(true));
    c.on('pointerout', () => draw(false));
    c.on('pointerdown', onClick);
    return c;
  }

  /**
   * Draggable slider added to `parent`. get/set read/write the live value;
   * fmt renders the label. Returns a refresh fn (re-reads value → repositions
   * handle + relabels) so other sliders can update when a shared input changes.
   */
  private makeSlider(
    parent: Phaser.GameObjects.Container, x: number, y: number, w: number,
    min: number, max: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string,
  ): () => void {
    const trackG = this.add.graphics();
    trackG.fillStyle(0x22324f, 1);
    trackG.fillRoundedRect(x, y - 4, w, 8, 4);
    const label = this.add.text(x, y - 26, '', {
      fontFamily: 'monospace', fontSize: '16px', color: '#cfe8ff',
    }).setOrigin(0, 0.5);
    const handle = this.add.circle(x, y, 11, 0x00eaff).setStrokeStyle(2, 0xffffff);
    const refresh = () => {
      const t = Phaser.Math.Clamp((get() - min) / (max - min), 0, 1);
      handle.x = x + t * w;
      label.setText(fmt(get()));
    };
    handle.setInteractive({ draggable: true, useHandCursor: true });
    handle.on('drag', (_p: Phaser.Input.Pointer, dragX: number) => {
      const t = Phaser.Math.Clamp((dragX - x) / w, 0, 1);
      set(min + t * (max - min));
      this.refreshSettings();
    });
    parent.add([trackG, label, handle]);
    refresh();
    return refresh;
  }

  private refreshSettings(): void {
    this.settingsRefreshers.forEach((r) => r());
  }

  private buildMenu(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const c = this.add.container(0, 0).setDepth(12);
    this.menuContainer = c;
    const title = this.add.text(cx, cy - 120, 'GEOMETRY RUSH', {
      fontFamily: 'monospace', fontSize: '48px', color: '#00eaff', stroke: '#003366', strokeThickness: 8,
    }).setOrigin(0.5);
    const start = this.makeButton(cx, cy - 16, 240, 64, 'START', 0x00aa66, () => this.startRun());
    const settings = this.makeButton(cx, cy + 70, 240, 50, 'SETTINGS', 0x444a6e,
      () => this.settingsContainer?.setVisible(true));
    c.add([title, start, settings]);
  }

  private buildSettings(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const pw = 580, ph = 400;
    const c = this.add.container(0, 0).setDepth(25).setVisible(false);
    this.settingsContainer = c;
    const backdrop = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setOrigin(0, 0).setInteractive(); // swallow clicks behind the panel
    const pg = this.add.graphics();
    pg.fillStyle(0x12203a, 0.98); pg.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    pg.lineStyle(3, 0x00eaff, 0.8); pg.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    const title = this.add.text(cx, cy - ph / 2 + 30, 'SETTINGS', {
      fontFamily: 'monospace', fontSize: '28px', color: '#00eaff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);
    const hint = this.add.text(cx, cy - ph / 2 + 62, 'GD ref: 1x=11.4  2x=13.9  3x=15.7 blk/s', {
      fontFamily: 'monospace', fontSize: '13px', color: '#88aacc',
    }).setOrigin(0.5);
    c.add([backdrop, pg, title, hint]);
    const sx = cx - 180, sw = 360;
    const r1 = this.makeSlider(c, sx, cy - 40, sw, 300, 800,
      () => this.scrollSpeed,
      (v) => { this.scrollSpeed = Math.round(v); this.registry.set('dbgSpeed', this.scrollSpeed); },
      (v) => `Speed:  ${Math.round(v)} px/s  (${(v / PLAYER_SIZE).toFixed(1)} blk/s)`);
    const r2 = this.makeSlider(c, sx, cy + 30, sw, 350, 800,
      () => -this.jumpVel,
      (v) => { this.jumpVel = -Math.round(v); this.registry.set('dbgJump', this.jumpVel); },
      (v) => `Jump:  peak ${Math.round((v * v) / (2 * this.gravity))}px`);
    const r3 = this.makeSlider(c, sx, cy + 100, sw, 1000, 3000,
      () => this.gravity,
      (v) => { this.gravity = Math.round(v); this.registry.set('dbgGrav', this.gravity); },
      (v) => `Fall speed (gravity):  ${Math.round(v)}`);
    this.settingsRefreshers = [r1, r2, r3];
    const back = this.makeButton(cx, cy + ph / 2 - 34, 150, 46, 'BACK', 0x2244aa,
      () => c.setVisible(false));
    c.add(back);
  }

  private handleJump(): void {
    if (!this.started) {
      this.startRun(); // begin the run (also reachable via the START button)
      return;          // the start press only begins the run — don't also jump
    }

    if (this.dead) {
      this.restartGame();
      return;
    }

    if (this.onGround) {
      this.playerVY = this.jumpVel;
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
          py < hb.y + hb.h &&
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
    this.worldX += this.scrollSpeed * dt;
    this.distance = Math.floor(this.worldX / 100);
    this.scoreText.setText(`${this.distance} m`);
    this.bestText.setText(`Best: ${this.bestDistance} m`);

    // Gravity
    this.playerVY += this.gravity * dt;
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
      x: this.worldX + this.playerX + PLAYER_SIZE / 2, // WORLD coord so the trail streaks behind
      y: this.playerY + PLAYER_SIZE / 2,
      alpha: 0.7,
    });
    // Longer + slower-fading so the streak clearly extends LEFT past the
    // player block (the brightest points sit under the player and are hidden;
    // a short fast-fading tail was only visible at game-over when the player
    // turns invisible).
    if (this.trailPoints.length > 18) this.trailPoints.pop();
    for (const pt of this.trailPoints) pt.alpha *= 0.9;

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
