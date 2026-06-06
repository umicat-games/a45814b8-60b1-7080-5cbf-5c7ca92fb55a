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
- Constants: SCROLL_SPEED=320, JUMP_VEL=-620, GRAVITY=1400, PLAYER_SIZE=38, GROUND_Y=GAME_HEIGHT-80

## Controls
- **SPACE / W / UP arrow / tap** — jump (hold not needed; single tap per jump)

## This Turn
- Built the entire game from scratch — GameScene, BootScene, UIScene, main.ts all rewritten
