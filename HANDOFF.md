# krunkedLUFTRAUSERS — Act I Sprint Handoff

## 1. Shipped 1:1 Capabilities & Verified Parity Metrics
- **Deterministic 60Hz Core (`src/sim/`):** Pure, zero-DOM fixed-timestep (`1/60s`, `Mulberry32` PRNG) aerodynamics (`turnspeed` vs `turnspeedboost`, laser `1/3` turn divisor), cease-fire-only healing with `fireCooldown` lockout, sea/space hazards, all 6 Weapons / 6 Bodies / 6 Engines, 126 aircraft (`125` named + `[5,5,5]` `URAUSER`), 10 enemy types (Normal + SFMT), spawn budgets, hitstop, `x1..x20 MAX` combo timer, 90-mission progression, Ace Pilot Bot, and bitmask replay recording.
- **WebGL2 `600x400` Pipeline (`src/render/`, `src/ui/`):** Dual `NEAREST` FBOs, GLSL ES 3.00 `batch`/`post`/`font`/`combofont`/`pauselines` shaders (`2x2` health circle, water palette remapping), 12 palettes, projector Hangar, and hidden-by-default backtick (`` ` ``) Telemetry HUD.
- **Phase-Locked 3-Stem Audio (`src/audio/`):** Sample-accurate `AudioBufferSourceNode` epoch mixer (`0.000ms` inter-stem drift), 125-combo bass/drums/lead matrix, low-HP alarm stem, spatial `*dist` SFX bus, and procedural synth fallbacks.
- **Empirical Verification:** `npm run typecheck` (`0` errors), `npm test` (`61/61`), `npm run test:parity` (`25/25` live Steam proofs + 12 × 3,600-tick Ace Bot sorties + bit-identical replays), `npm run audit:parity` (`19/19`, `0` git-hygiene violations, `0` JSON diffs), live browser sortie at `144.0 FPS` (`7.1ms` p95), `0` GL/console errors, reload persistence verified.

## 2. Runtime Operation
- **Steam Vault (`steam-local`):** `npm start` reads `LUFTRAUSERS_STEAM_DIR` (Windows default: `C:\Program Files (x86)\Steam\steamapps\common\Luftrausers\data`) strictly read-only via Vite middleware; zero Steam assets are tracked in git.
- **Procedural Fallback (`procedural-fallback`):** Activates automatically without Steam, providing matching vanilla stats, 8-level vector atlases, bitmap fonts, and synth stems/SFX.
- **CLI:** `npm start` | `npm run build` | `npm run typecheck` | `npm test` | `npm run test:parity` | `npm run audit:parity`.

## 3. Known Edge Nuances
- `sheet1grey.png` is decoded live as 32-bit TGA; proprietary `PCP\0` files (`sheet2grey.png`, `nuke.png`, `fnt*_0.png`) use clean-room procedural 8-level textures aligned to Steam `.json`/`.fnt` metrics.
- `[5,5,5]` `URAUSER` intentionally renders the authentic `416x300` fortress sprite.
- QA hotkeys (`F3/F4/F6/F7/F8/F9`) in `src/main.ts` activate only while the hidden Telemetry HUD is open.

## 4. Act II ("Make It Better") Leverage Points
`VANILLA_1TO1_PROFILE` locks Act I parity inside `ModRegistry` (`vanillaLocked = true`). Unlock `ModRegistry` to build Act II cleanly without vanilla regression:
- **FPV/Acro Flight Mutators:** Register `FlightMutator`s for acro curves, airmode, and thrust vectoring.
- **Custom Parts, Bosses & Modes:** Add `customEngines`/`customBodies`/`customWeapons`, boss waves, `customPalettes`, replay ghost sharing, or co-op/dogfight arenas over the pure 60Hz `Simulation`.
