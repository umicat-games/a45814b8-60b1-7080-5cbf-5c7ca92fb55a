import { createUmicatGame } from '@umicat/phaser-sdk';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { renderScripts } from './visuals';

function startGame(): void {
  createUmicatGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scenes: [BootScene, GameScene],
    renderScripts,
  });
}

/**
 * Load any user-imported fonts BEFORE Phaser boots.
 *
 * Phaser bakes text into a canvas texture at creation time — if a custom font
 * isn't loaded yet it renders the fallback and never refreshes. So we resolve
 * every font declared in `public/uploaded/fonts.json` (written by the asset
 * import flow) via the FontFace API, then start the game. Any text can then
 * use `fontFamily: '<family>'`.
 *
 * fonts.json shape: [{ "family": "my_font", "file": "my_font.ttf" }]
 * Missing file / parse errors are non-fatal — the game still boots with the
 * system font.
 */
async function loadFontsThenStart(): Promise<void> {
  let entries: Array<{ family: string; file: string }> = [];
  try {
    const res = await fetch('uploaded/fonts.json', { cache: 'no-store' });
    if (res.ok) {
      const parsed: unknown = await res.json();
      if (Array.isArray(parsed)) entries = parsed as Array<{ family: string; file: string }>;
    }
  } catch {
    /* no fonts.json — the common case, nothing to load */
  }

  await Promise.all(
    entries.map(async ({ family, file }) => {
      try {
        const face = new FontFace(family, `url(uploaded/${file})`);
        await face.load();
        (document.fonts as FontFaceSet).add(face);
      } catch (e) {
        console.warn(`[umicat] failed to load font "${family}" (${file})`, e);
      }
    }),
  );
}

loadFontsThenStart().finally(startGame);
