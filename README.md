# Marketline

A single-player, offline 4v4 tactical FPS set in the Al Marfa market district. Deploy with three allied bots against four opponents. Reach 30 eliminations or lead when the ten-minute timer runs out. A short death view leads to automatic respawn.

## Run

Use a desktop browser with WebGL2 and Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
npm run build
npm run preview
```

The production build contains `dist/index.html` and `dist/marketline.js`. Geometry, textures, fonts, shaders, and audio synthesis are bundled for offline play. Keep the two files together.

## Controls

| Input | Action |
| --- | --- |
| W A S D, mouse | Move and look |
| Shift, Ctrl or C | Sprint and crouch |
| Space | Jump or mantle a nearby low ledge |
| Left and right mouse buttons | Fire and aim down sights |
| R, I, B | Reload, inspect, toggle automatic and semi-automatic fire |
| Q, G | Throw smoke or a frag |
| Esc | Pause |
| Tab, backtick | Toggle telemetry and cycle renderer debug views |

Blue nameplates identify visible allies. A red ENEMY marker appears when the crosshair lines up with an exposed opponent. The minimap shows allies in blue and revealed enemies in red.

Settings include input sensitivity, FOV, ADS multiplier, invert-Y, rebindable keyboard controls, bot difficulty, sound, and graphics quality. Click **Deploy** to capture the pointer and unlock audio.

## Test and profile

```sh
npx playwright install chromium
npm test
npm run benchmark
```

The browser harness runs the production build, captures gameplay checkpoints, and reports frame timings and render counters at 1920×1080 and 2192×1080. Reports and screenshots go to `test-results/`. The browser tests cover offline launch, input, firing, reloading, an elimination, death and respawn, and both match-end conditions.

## Implementation

- `main.js` owns the 120 Hz fixed-step match, input, and damage. `physics.js` provides a binned BVH, continuous shape casts, and the capsule controller. `rigid-world.js` resolves reactive prop contacts with sequential impulses. `effects.js` owns pooled projectiles and debris effects.
- The default Al Marfa map loads three Blender-exported sectors. `world.js` supplies collision, spawn locations and moving scenery. It also builds the visual map for alternate development seeds. `bots.js` uses a clearance-checked A* grid with cover, hearing, vision, and delayed squad reports. `bot-rig.js` poses the limbs and simulates non-graphic falls. The gait keeps stance feet fixed in world space and emits footsteps on landing. Render poses blend between simulation samples.
- `render.js` and `shaders.js` own the HDR and post-processing graph. It combines cascaded sun shadows, depth-derived normals, camera and moving-mesh velocity, horizon AO, temporal reprojection, a separately composited viewmodel, bloom, exposure adaptation, and an AgX-style LUT composite.
- `world-materials.js` builds the scanned PBR surfaces. Cobbles and stone blocks use relief mapping from the scans' height maps. Large surfaces blend a second, coarser sample of the scan to hide tiling. The Low and Medium presets halve the 2K textures at load, and Low skips the relief march.
- Sun shadows use a blocker search for contact-hardening penumbrae. `sky-occlusion.js` also bakes a map of sunlit paving at load, and every lit surface samples it for warm ground bounce.
- `street-dressing.js` scatters scanned weeds, stones, crates and street clutter along walls and kerbs, and swaps the map's placeholder rubble for scanned stones. The props have no collision and are culled by distance.
- `weapon.js` models and animates the carbine. `audio.js` generates gunshots, mechanics, footsteps, ambience, reverb, and HUD sounds with Web Audio. `ui.js` owns the menus and HUD.

Collision uses analytic box proxies and ground. Reactive box contacts use conservative bounds, and ragdolls use position-based distance and bend constraints. This leaves triangle-mesh sweeps, general convex manifolds, and explicit ragdoll twist constraints unimplemented. The temporal passes track world camera motion and bot and prop transforms. The viewmodel composites after world TAA, and transparent effects use an approximate reactive history weight.

## Al Marfa in Blender

Open [Al-Marfa.blend](art/Al-Marfa.blend) with Blender 5.3. The file contains the district at meter scale, packed textures, the modeled street and room details, and player-height cameras. Enable the reference collection to see the game's collision boxes and spawn points.

The twelve central market frontages use measured opening coordinates from the layout. The Blender scripts replace their visible doors, window assemblies and balcony rails. The layout retains the structural wall openings and the game's collision proxies. The façade cameras are named `facade-market`, `facade-epicerie`, `facade-tea`, `facade-atelier` and `facade-housing`.

To reproduce the authored scene and its three Draco GLBs from the baseline layout and the Blender scene scripts, run these commands from the repository:

```sh
node scripts/extract-al-marfa.mjs
blender -b --factory-startup --python-exit-code 1 -P scripts/build-al-marfa.py
blender -b art/Al-Marfa.blend --python-exit-code 1 -P scripts/render-al-marfa.py -- market arch tea pickup --out .blender-work/renders
npm test
```

The web build bundles the GLBs and their decoder so it can launch offline. The Blender cameras use Cycles and their own scene lighting. The game applies its real-time materials and lighting to the exported geometry.

After editing and saving the `.blend`, re-export the game map with `blender -b art/Al-Marfa.blend --python-exit-code 1 -P scripts/build-al-marfa.py -- --export-only`. Put new playable-map visual meshes in the `Exterior | ...` or `Interiors | ...` collections. Update the game's collision proxies separately when changing traversable geometry.

## Asset credits

- The map uses [photographic surface scans](src/assets/world-textures/CREDITS.md) and [Kloofendal 38d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_38d_partly_cloudy_puresky) by Greg Zaal and Jarod Guest from Poly Haven, all CC0. The sky is re-exposed, rotated to match the map sun, and bundled as WebP.
- The weeds, stones and street clutter are [Poly Haven models](src/assets/world-textures/CREDITS.md#street-dressing-models), CC0.
- The market's produce trays, woven baskets, ceramics, and shop lanterns are modeled in Blender and bundled as a single glTF asset.
- Barlow Condensed is distributed under the [SIL Open Font License](src/fonts/OFL.txt).
