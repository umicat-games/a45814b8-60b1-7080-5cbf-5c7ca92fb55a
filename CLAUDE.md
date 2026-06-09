# Geometry Rush

## Game Overview
- **Title:** Geometry Rush
- **Genre:** Auto-runner / rhythm platformer (Geometry Dash clone)
- **Core mechanic:** Press SPACE/tap to make the cube jump over obstacles. The world auto-scrolls right at constant speed. Touch a spike or block = instant death, restart from beginning.

## Features Implemented
- Auto-scrolling world with procedurally generated obstacles
- Player cube with manual rotation math (spins when airborne, snaps to 90° on landing)
- Cyan neon visual style — glowing grid background, neon ground line, glowing cube with inner decoration
- Trail effect behind player (fades over 8 frames)
- 4 obstacle types: spike, double_spike, block, gap_platform (block with spike on top)
- AABB collision detection (slightly inset hitboxes for fairness)
- Death explosion particles (18 square fragments that arc and fade)
- Camera shake on death
- Distance score (meters = worldX / 100)
- Best distance persisted in localStorage (key: `gd_best`)
- Title screen with "PRESS SPACE OR TAP TO START" prompt
- "YOU CRASHED!" overlay with distance/best and retry prompt
- Neon GD-style loading bar in BootScene

## Key Implementation Details
- **GameScene.ts** — entire game logic (no scene-as-data, fully procedural)
- **BootScene.ts** — stripped down, just loading bar → starts GameScene directly (no manifest)
- **UIScene.ts** — intentionally empty (all HUD in GameScene)
- **main.ts** — no renderScripts (not using scene-as-data)
- All rendering via Phaser Graphics API cleared + redrawn each frame
- Obstacle system: worldX-based positions, screen positions computed as `obs.x - this.worldX`
- Obstacle spawning: batches of 6 patterns, re-triggered when next batch is < GAME_WIDTH+200px ahead
- Constants: SCROLL_SPEED=480, JUMP_VEL=-620, GRAVITY=1400, PLAYER_SIZE=38, GROUND_Y=GAME_HEIGHT-80

## Controls
- **SPACE / W / UP arrow / tap** — jump (hold not needed; single tap per jump)

## This Turn
- Tuned feel toward Geometry Dash: SCROLL_SPEED 480→540, JUMP_VEL -620→-550,
  GRAVITY 1400→1550. Jump peak 137→98px (3.6→2.6 player heights), snappier
  arc; horizontal jump distance kept ~383px (was 425) so obstacles still
  clear. Playtest clearability — re-tune jump/spacing if some don't clear.
- (prev) Fixed trail (2 parts): (a) stored WORLD x (`worldX + playerX`), drawn at
  `pt.x - worldX`, so it streaks left instead of piling on the screen-fixed
  player ("shadow block"); (b) made it visible during play — length 8→18,
  fade 0.85→0.9, draw alpha 0.5→0.6, gentler size shrink — the bright near
  points sit under the player block, so a short faint tail was only visible
  at game-over (player turns invisible).
- (prev) Fixed start-jump: added `return` after the start block in handleJump.
- (prev) Fixed collision: `py < hb.y` → `py < hb.y + hb.h` (proper AABB).
- (prev) Set SCROLL_SPEED to 480 px/s (1.5x the original 320)
