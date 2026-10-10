# BLOCKOUT — Asset Manifest & Licences

Runtime-loaded assets referenced by the game code. Appearance is separate from
abilities: nothing here grants gameplay stats.

| Asset | Path | Used by | Licence | Author / Source |
| --- | --- | --- | --- | --- |
| Soccer player rig | `3d/soap_soccer_player.glb` | `js/realplayer.js`, `js/models.js` | CC-BY-4.0 | luccacatalan (Sketchfab) |

## Player base model

- **File:** `3d/soap_soccer_player.glb`
- **Licence:** Creative Commons Attribution 4.0 International (CC-BY-4.0)
- **Author:** luccacatalan (https://sketchfab.com/luccacatalan)
- **Source:** https://sketchfab.com/3d-models/soap-soccer-player-5ae4bf9d6a324cfda79ce1298ea2d333
- **Attribution:** Required. Retained here and in the in-game credits path.
- **Usage:** Base mesh for all eight roster characters. Skinned (7 meshes /
  6152 tris / 48 bones), tinted per-character by `js/cosmetics.js` and
  `js/config.js` palettes. Cosmetic outfits, faces, hairstyles and accessories
  are procedural box/cylinder overlays baked onto the bones at load; they change
  appearance only.

## Custom / original content (no third-party licence)

All streetwear outfits, boots, faces, hairstyles, accessories, courts, crowd,
buildings, HUD and UI art are original BLOCKOUT content authored in code
(procedural geometry) or as local source files. They carry no external licence
obligation.

## Untracked / not loaded at runtime

These files exist in the working tree but are **not referenced by any game
code** and are not shipped. They carry their own upstream licences and must not
be redistributed without checking them:

- `3d/Fast Run.fbx`, `3d/Running.fbx`, `3d/Running Slide.fbx` — Mixamo-style
  animation sources (not loaded; the GLB ships its own `PlayerRig` clips).
- `3d/kenney_city-kit-roads.zip` — Kenney City Kit roads (CC0 / Kenney
  licence); not extracted or loaded.
- `environment/overview.png`, `environment/other view.png` — reference
  screenshots, not loaded.

## Guarantees

- No club kits, badges, logos or unlicensed real-world football IP.
- No paid assets, external APIs or runtime network fetches for assets.
- No gameplay/stat advantage from any cosmetic.
