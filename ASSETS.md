# Available Assets (Kenney CC0)

All assets are served at /assets/kenney/. ALWAYS use these instead of drawing plain rectangles/circles.

## Characters — 24x24px sprites
Individual files: sprites/characters/tile_0000.png through tile_0026.png (27 total, 3 rows of 9)
- Row 0 (0000-0008): Blue alien — idle, walk1, walk2, jump, climb1, climb2, swim, hurt, duck
- Row 1 (0009-0017): Green alien — same poses
- Row 2 (0018-0026): Beige alien — same poses

Load individual sprite:
  this.load.image('player', '/assets/kenney/sprites/characters/tile_0000.png')

Load full sheet for animation (frameWidth=24, frameHeight=24, no spacing):
  this.load.spritesheet('characters', '/assets/kenney/sprites/characters/sheet.png', { frameWidth: 24, frameHeight: 24 })
  this.anims.create({ key: 'walk', frames: this.anims.generateFrameNumbers('characters', { start: 1, end: 2 }), frameRate: 8, repeat: -1 })

## Terrain Tiles — 18x18px sprites
180 individual tiles at sprites/tiles/tile_0000.png through tile_0179.png
Approximate layout: 0000-0019=top terrain, 0020-0039=mid terrain, 0040-0059=bottom/dirt, 0060+=objects/slopes

Load as spritesheet (frameWidth=18, frameHeight=18, no spacing):
  this.load.spritesheet('tiles', '/assets/kenney/sprites/tiles/sheet.png', { frameWidth: 18, frameHeight: 18 })

## 1-Bit Tilesheet — 16x16px, 49 columns x 22 rows (1078 frames), white sprites on transparent
Path: sprites/tiles/1bit-sheet.png — great for any game type, tint any color with sprite.setTint(0xff0000)
  this.load.spritesheet('tiles1bit', '/assets/kenney/sprites/tiles/1bit-sheet.png', { frameWidth: 16, frameHeight: 16 })

## UI Elements
Buttons (blue/red/green/grey):
  /assets/kenney/sprites/ui/blue/button_rectangle_depth_flat.png
  /assets/kenney/sprites/ui/red/button_rectangle_depth_flat.png
  /assets/kenney/sprites/ui/green/button_rectangle_depth_flat.png
  /assets/kenney/sprites/ui/blue/button_round_depth_flat.png
  /assets/kenney/sprites/ui/green/star_outline_depth.png
Various bars, panels, sliders in sprites/ui/

## Fonts
Users import fonts (.ttf / .otf / .woff / .woff2) via the Assets tab. An
imported font lands in `public/uploaded/` and is registered in
`public/uploaded/fonts.json`; `main.ts` loads every entry (FontFace API)
BEFORE the game boots. Use one by its filename stem as the family:
  this.add.text(x, y, 'Score: 0', { fontFamily: 'my_font', fontSize: '24px', color: '#ffffff' })
For a scene-as-data HUD, set the text entity's "fontFamily": "my_font".
Do NOT add your own @font-face and do NOT gate boot yourself — main.ts handles
loading; there is no `this.load.font()`.
