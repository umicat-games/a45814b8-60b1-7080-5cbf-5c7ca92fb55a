import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const GROUND_Y = GAME_HEIGHT - 80;
const PLAYER_SIZE = 38;
const SCROLL_SPEED = 540; // px/s
const JUMP_VEL = -680;    // higher jump (~110px peak ≈ 2.9 player heights)
const GRAVITY = 2100;     // steeper arc; horizontal jump distance reduced to ~350px
const SPIKE_W = 40;
const SPIKE_H = 40;

// Jump physics (defaults): peak ≈ 110px, airtime ≈ 0.65s, horizontal reach ≈ 350px.
// The level below has been rescaled for these numbers.

type Rect = { x: number; y: number; w: number; h: number };

interface Obstacle {
  x: number; // left edge, world coords
  gfx: Phaser.GameObjects.Graphics;
  spikes: Rect[]; // triangles — touch = death
  solids: Rect[]; // rectangles — landable platforms; only a side hit kills
}

// Repeating, hand-tuned level. `k` = pattern, `adv` = distance to the next base.
// adv ≥ ~460 so the player lands (~233px past takeoff) with reaction room before
// the next obstacle. Multi-spike patterns sit inside ONE jump arc (≤120px span,
// jump clears 40px-tall spikes over a ~294px window). 'b'/'P' are platforms:
// jump ONTO them (or over) — running into the side is fatal, the top is safe.
const LEVEL: { k: string; adv: number }[] = [
  { k: 's', adv: 425 }, // single spike
  { k: 's', adv: 435 },
  { k: 'd', adv: 495 }, // double spike (one jump)
  { k: 's', adv: 425 },
  { k: 'b', adv: 475 }, // 50px block — jump onto or over
  { k: 's', adv: 420 },
  { k: 't', adv: 540 }, // triple spike (one jump)
  { k: 's', adv: 435 },
  { k: 'P', adv: 600 }, // wide low platform — land, ride, drop off the left
  { k: 's', adv: 435 },
  { k: 'd', adv: 510 },
  { k: 'b', adv: 475 },
];

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
  private levelIndex = 0;
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
  private menuObjects: Phaser.GameObjects.GameObject[] = [];
  private settingsObjects: Phaser.GameObjects.GameObject[] = [];
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
    this.nextObstacleX = 760; // first obstacle ~1s in — reaction room
    this.levelIndex = 0;

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
    // Keep the level filled ~1.5 screens ahead by walking the LEVEL loop.
    while (this.nextObstacleX - this.worldX < GAME_WIDTH + 400) {
      const step = LEVEL[this.levelIndex % LEVEL.length];
      this.buildPattern(this.nextObstacleX, step.k);
      this.nextObstacleX += step.adv;
      this.levelIndex++;
    }
  }

  private buildPattern(baseX: number, key: string): void {
    const g = this.add.graphics().setDepth(3);
    const spikes: Rect[] = [];
    const solids: Rect[] = [];
    // Spike hitbox is inset 4px each side of the 40px triangle so a graze near
    // the tip/base isn't an unfair kill; the visual triangle stays full-width.
    const spike = (lx: number) =>
      spikes.push({ x: baseX + lx + 4, y: GROUND_Y - SPIKE_H, w: SPIKE_W - 8, h: SPIKE_H });
    const block = (lx: number, w: number, h: number) =>
      solids.push({ x: baseX + lx, y: GROUND_Y - h, w, h });

    switch (key) {
      case 's': // single spike
        spike(0);
        break;
      case 'd': // two contiguous spikes — one jump clears both
        spike(0);
        spike(SPIKE_W);
        break;
      case 't': // three contiguous spikes (~120px span, still one jump)
        spike(0);
        spike(SPIKE_W);
        spike(SPIKE_W * 2);
        break;
      case 'b': // a 50px cube — jump onto the top or over it
        block(0, 50, 50);
        break;
      case 'P': // wide low platform — land on top, ride, drop off the left edge
        block(0, 150, 46);
        break;
    }

    this.obstacles.push({ x: baseX, gfx: g, spikes, solids });
  }

  private renderObstacle(obs: Obstacle): void {
    const g = obs.gfx;
    g.clear();
    // Platforms first (so spikes sitting on the ground draw on top).
    for (const s of obs.solids) {
      this.drawBlock(g, s.x - this.worldX, GROUND_Y, s.w, s.h);
    }
    // Spike hitbox is inset 4px; recover the visual triangle's left edge.
    for (const hb of obs.spikes) {
      this.drawSpike(g, hb.x - 4 - this.worldX, GROUND_Y);
    }
  }

  // ── Start menu + settings UI (rexUI) ─────────────────────────────────────
  private get rex(): any {
    return (this as unknown as { rexUI: any }).rexUI;
  }

  private startRun(): void {
    if (this.started) return;
    this.started = true;
    this.menuObjects.forEach((o) => (o as Phaser.GameObjects.Components.Visible).setVisible(false));
    this.closeSettings();
  }

  private openSettings(): void {
    this.settingsObjects.forEach((o) => (o as Phaser.GameObjects.Components.Visible).setVisible(true));
  }

  private closeSettings(): void {
    this.settingsObjects.forEach((o) => (o as Phaser.GameObjects.Components.Visible).setVisible(false));
  }

  /** rexUI Label button (whole area clickable) with hover. */
  private makeButton(
    x: number, y: number, w: number, h: number, label: string, color: number, onClick: () => void,
  ): Phaser.GameObjects.GameObject {
    const bg = this.rex.add.roundRectangle(0, 0, w, h, 12, color).setStrokeStyle(3, 0xffffff, 0.6);
    bg.setFillStyle(color, 0.85);
    const btn = this.rex.add.label({
      x, y, width: w, height: h,
      background: bg,
      text: this.add.text(0, 0, label, { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff' }),
      align: 'center',
      space: { left: 12, right: 12, top: 10, bottom: 10 },
    }).layout();
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => bg.setFillStyle(color, 1));
    btn.on('pointerout', () => bg.setFillStyle(color, 0.85));
    btn.on('pointerdown', onClick);
    return btn;
  }

  /** rexUI Slider + a value label. Returns objects (for show/hide) + a refresh. */
  private makeSlider(
    x: number, y: number, w: number, min: number, max: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string,
  ): { objects: Phaser.GameObjects.GameObject[]; refresh: () => void } {
    const valText = this.add.text(x, y - 24, fmt(get()), {
      fontFamily: 'monospace', fontSize: '16px', color: '#cfe8ff',
    }).setOrigin(0, 0.5);
    const slider = this.rex.add.slider({
      x: x + w / 2, y, width: w, height: 10, orientation: 'x',
      track: this.rex.add.roundRectangle(0, 0, w, 8, 4, 0x22324f),
      thumb: this.rex.add.roundRectangle(0, 0, 24, 24, 12, 0x00eaff).setStrokeStyle(2, 0xffffff),
      value: Phaser.Math.Clamp((get() - min) / (max - min), 0, 1),
      valuechangeCallback: (v: number) => { set(min + v * (max - min)); this.refreshSettings(); },
      space: { top: 4, bottom: 4 },
    }).layout();
    const refresh = () => valText.setText(fmt(get())); // only the label (peak depends on gravity)
    return { objects: [valText, slider], refresh };
  }

  private refreshSettings(): void {
    this.settingsRefreshers.forEach((r) => r());
  }

  private buildMenu(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const title = this.add.text(cx, cy - 120, 'GEOMETRY RUSH', {
      fontFamily: 'monospace', fontSize: '48px', color: '#00eaff', stroke: '#003366', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(12);
    const start = this.makeButton(cx, cy - 16, 240, 64, 'START', 0x00aa66, () => this.startRun());
    const settings = this.makeButton(cx, cy + 70, 240, 50, 'SETTINGS', 0x444a6e, () => this.openSettings());
    (start as Phaser.GameObjects.Components.Depth).setDepth(12);
    (settings as Phaser.GameObjects.Components.Depth).setDepth(12);
    this.menuObjects = [title, start, settings];
  }

  private buildSettings(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const pw = 580, ph = 400;
    const backdrop = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setOrigin(0, 0).setInteractive().setDepth(24); // swallow clicks behind the panel
    const panel = this.add.graphics().setDepth(25);
    panel.fillStyle(0x12203a, 0.98); panel.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    panel.lineStyle(3, 0x00eaff, 0.8); panel.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    const title = this.add.text(cx, cy - ph / 2 + 30, 'SETTINGS', {
      fontFamily: 'monospace', fontSize: '28px', color: '#00eaff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(26);
    const hint = this.add.text(cx, cy - ph / 2 + 62, 'GD ref: 1x=11.4  2x=13.9  3x=15.7 blk/s', {
      fontFamily: 'monospace', fontSize: '13px', color: '#88aacc',
    }).setOrigin(0.5).setDepth(26);
    const sx = cx - 180, sw = 360;
    const s1 = this.makeSlider(sx, cy - 40, sw, 300, 800,
      () => this.scrollSpeed,
      (v) => { this.scrollSpeed = Math.round(v); this.registry.set('dbgSpeed', this.scrollSpeed); },
      (v) => `Speed:  ${Math.round(v)} px/s  (${(v / PLAYER_SIZE).toFixed(1)} blk/s)`);
    const s2 = this.makeSlider(sx, cy + 30, sw, 350, 800,
      () => -this.jumpVel,
      (v) => { this.jumpVel = -Math.round(v); this.registry.set('dbgJump', this.jumpVel); },
      (v) => `Jump:  peak ${Math.round((v * v) / (2 * this.gravity))}px`);
    const s3 = this.makeSlider(sx, cy + 100, sw, 1000, 3000,
      () => this.gravity,
      (v) => { this.gravity = Math.round(v); this.registry.set('dbgGrav', this.gravity); },
      (v) => `Fall speed (gravity):  ${Math.round(v)}`);
    this.settingsRefreshers = [s1.refresh, s2.refresh, s3.refresh];
    const back = this.makeButton(cx, cy + ph / 2 - 34, 150, 46, 'BACK', 0x2244aa, () => this.closeSettings());
    const sliderObjs = [...s1.objects, ...s2.objects, ...s3.objects, back];
    sliderObjs.forEach((o) => (o as Phaser.GameObjects.Components.Depth).setDepth(26));
    this.settingsObjects = [backdrop, panel, title, hint, ...sliderObjs];
    this.closeSettings();
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
      for (const hb of obs.spikes) {
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

  // A platform is fatal only from the side: the player horizontally overlaps it
  // while their feet are below its top (i.e. they ran into the wall instead of
  // landing on it). Landing-on-top is resolved in update() before this runs, so
  // a clean landing has feet == top and is not flagged. Insets keep edge-grazes
  // and exact-edge landings fair.
  private hitsSolidSide(): boolean {
    const left = this.playerX + 6;
    const right = this.playerX + PLAYER_SIZE - 6;
    const bottom = this.playerY + PLAYER_SIZE;
    for (const obs of this.obstacles) {
      for (const s of obs.solids) {
        const ssx = s.x - this.worldX;
        const horiz = right > ssx && left < ssx + s.w;
        const intoSide = bottom > s.y + 6 && this.playerY < s.y + s.h;
        if (horiz && intoSide) return true;
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

    // Gravity (remember where the player's feet were so we can tell a clean
    // landing-on-top from a crash into a platform's side).
    const prevBottom = this.playerY + PLAYER_SIZE;
    this.playerVY += this.gravity * dt;
    this.playerY += this.playerVY * dt;

    // Support surface = the ground, plus the top of any solid platform the
    // player is horizontally over AND was descending onto (feet at/above its
    // top last frame). Pick the highest such surface.
    let floorY = GROUND_Y;
    for (const obs of this.obstacles) {
      for (const s of obs.solids) {
        const ssx = s.x - this.worldX;
        const horiz = this.playerX + PLAYER_SIZE > ssx && this.playerX < ssx + s.w;
        if (horiz && prevBottom <= s.y + 4 && s.y < floorY) {
          floorY = s.y;
        }
      }
    }
    const floorPlayerY = floorY - PLAYER_SIZE;
    if (this.playerY >= floorPlayerY) {
      this.playerY = floorPlayerY;
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

    // Collision check: spikes are lethal on touch; a platform kills only when
    // the player runs into its side (feet below the top, not resting on it).
    if (this.checkCollision() || this.hitsSolidSide()) {
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
