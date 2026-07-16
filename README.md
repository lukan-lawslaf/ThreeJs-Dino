# ISLA NUBLAR — A Jurassic Park–Inspired Survival Exploration Game

A cinematic, browser-based 3D survival exploration game built with **Three.js** (ES modules, no build step).
Explore a fog-drenched tropical island: the abandoned Visitor Center, a derelict laboratory,
broken electric fences, dinosaur paddocks, a winding river, hidden caves and a mountain radio tower.

## Run it

Any static file server works (ES modules + import maps require HTTP, not `file://`):

```bash
# Option A
npx serve .
# Option B
python -m http.server 8000
```

Open http://localhost:8000 (or the printed URL) in a modern desktop browser (Chrome/Edge/Firefox).

Append `?debug` to the URL for a free OrbitControls camera.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Shift | Sprint (drains stamina) |
| Space | Jump |
| C | Crouch (quieter — dinosaurs detect you less) |
| F | Flashlight |
| E | Interact |
| Tab | Inventory |
| Esc | Pause |

## Gameplay

1. Land on the southern beach and head inland to the **Visitor Center**.
2. Search the **wrecked staff jeep** for the park map.
3. Take the **LAB keycard** from the fossil display, unlock the **Laboratory**.
4. Find the **SECURITY keycard** inside the lab.
5. Restore the **LAB** and **PADDOCK** power grids at their generators.
6. Open the **summit gate**, climb the mountain, and **transmit the rescue signal**.

Avoid the escaped **T-rex**, the **raptor pen**, and **Dilophosaurus** near the river.
Herbivores (Triceratops, Parasaurolophus, Gallimimus, Brachiosaurus) flee or ignore you.
Crouching reduces your detection radius; sprinting increases it. Checkpoints auto-save
(objectives, keycards, power state, position) to `localStorage`.

## Dinosaur models (GLB drop-in pipeline)

The game ships with **procedural animated dinosaurs** (articulated rigs with code-driven
walk/run/attack/roar cycles) so it runs with zero downloads.

For higher-fidelity models, drop animated GLB files into `assets/models/` with these names —
they are detected automatically and their animation clips (names containing
`idle`, `walk`, `run`, `attack`, `roar`) are mapped to the AI state machine:

```
assets/models/trex.glb
assets/models/velociraptor.glb
assets/models/triceratops.glb
assets/models/brachiosaurus.glb
assets/models/dilophosaurus.glb
assets/models/parasaurolophus.glb
assets/models/gallimimus.glb
```

Good sources (check each model's license before use):
- Sketchfab Jurassic Park tag (login required to download): https://sketchfab.com/tags/jurassic-park
  — filter by **Downloadable** + **CC license**, prefer models with animations.
- Quaternius **Animated LowPoly Dinosaurs** (CC0): https://quaternius.itch.io/animated-lowpoly-dinosaurs
  (FBX/OBJ/Blend — convert to GLB via Blender: File → Export → glTF 2.0).
- poly.pizza CC0 dinosaur models: https://poly.pizza

DRACO-compressed GLBs are supported (decoder loads from CDN).

## Architecture

```
index.html            UI shell, import map, HUD/menus (pure DOM)
src/main.js           Orchestrator: boot, menus, frame loop, dino spawns
src/core/
  noise.js            Deterministic gradient noise + fBM
  heightmap.js        Island height function — single source of truth
  Settings.js         Quality presets + persistence
  Input.js            Keyboard/mouse + pointer lock
  AudioManager.js     100% procedural WebAudio (ambience, roars, music…)
src/world/
  Sky.js              Shader sky dome, clouds, sun/hemisphere lighting
  Terrain.js          Vertex-colored terrain + trails + shader water
  Vegetation.js       Instanced trees/ferns/grass/rocks/vines, wind shader
  Weather.js          Storm cycle, GPU rain, lightning, ambient motes
  Structures.js       Visitor Center, lab, paddocks, fences, cave, tower
src/dinos/
  DinoFactory.js      GLB loader (auto-detect) + procedural dino builder
  Dinosaur.js         AI state machine, locomotion, animation
src/player/Player.js  FPS controller, stamina/health, collisions, footsteps
src/game/
  Interact.js         Proximity/facing interaction prompts
  GameState.js        Inventory, objectives, flags, checkpoints
src/fx/PostFX.js      EffectComposer: SAO + bloom + tonemapped output
src/ui/HUD.js         Bars, compass, prompts, notices, inventory
```

### Performance notes
- All vegetation is `InstancedMesh` (4 draw calls for ~100k+ instances).
- Dinosaurs beyond 350 m tick at quarter rate.
- Shadow frustum follows the player; map size set by quality preset.
- Quality presets scale pixel ratio, instance counts, draw distance, SAO/bloom.
