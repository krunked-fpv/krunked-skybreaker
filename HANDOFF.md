# krunkedLUFTRAUSERS — Act II Sprint Handoff

## 1. Shipped Capabilities & Verified Parity Metrics
- **Act I Vanilla 1:1 Lock (`VANILLA_1TO1_PROFILE`):** Default profile locks `ModRegistry` (`vanillaLocked = true`) so flight controls, 60Hz `Mulberry32` aerodynamics, 126 aircraft (`125` + `[5,5,5]` `URAUSER`), 10 Normal/SFMT enemies, 90 missions, `600x400` `NEAREST` palette/water/health shaders, and phase-locked 3-stem Web Audio remain bit-identically 1:1 with Steam data.
- **Act II Mod Packs (Hangar `Tab` -> `ACT II MOD DECK`):**
  1. **Expanded Arsenal & Mega-Bosses (`src/sim/mod-packs.ts`):** Custom weapons (`6` Railgun, `7` Flak 6-shard airburst, `8` Chain Lightning 3-target arc), bodies (`6` Aegis shield, `7` Vampire lifesteal, `8` Overclock), engines (`6` Afterburner, `7` Vector, `8` Ion), and Mega-Bosses (`Dreadnought`, `SkyCarrier`, `AceSquadron`) with identical vanilla flight controls.
  2. **Deterministic Replay Ghost & Daily Seed (`src/sim/replay-ghost.ts`):** Isolated-PRNG `GhostRunner` rendering your Personal Best silhouette & trail, UTC `YYYYMMDD` Daily Seed sorties, and fuzz-hardened replay JSON export/import.
  3. **Custom Shader & Live Palette Studio (`src/render/shaders.ts`, `src/ui/palette-studio.ts`):** Toggleable CRT Scanlines, Phosphor Bloom, Speed-Warp Vignette, and Screen-Space Shockwaves in `outpass` (strictly zeroed in Vanilla 1:1), 4 bonus neon palettes, and an 8-slot live RGB Palette Studio.
  4. **Local 2P Co-op & 1v1 Dogfight Arena (`src/sim/simulation.ts`, `src/main.ts`):** Co-op waves with 300-tick partner respawn and Best-of-5 1v1 Dogfight Arena (Bot wingman/rival or split-keyboard `WASD+F/Space` vs `Arrows+M/Num0` & dual Gamepad).
- **Empirical Verification:** `npm run typecheck` (`0` errors), `npm test` (`89/89`), `npm run test:playtesters` (**`100/100`** adversarial playtesters `PT-001`..`PT-100`), `npm run test:parity` (`25/25` live Steam E2E proofs), `npm run audit:parity` (`19/19`, `0` git-hygiene violations, `0` JSON diffs), live Chrome WebGL2 playtests at `144.0 FPS` (`7.3ms` p95), `0.000ms` audio drift, `0` GL/console errors, clean reload persistence, and spotless Vanilla 1:1 reset.

## 2. Runtime Operation & CLI
- `npm start` mounts local Steam `data/` read-only (`LUFTRAUSERS_STEAM_DIR`, Windows default) or falls back cleanly to deterministic procedural vector/synth assets.
- **CLI:** `npm start` | `npm run build` | `npm run typecheck` | `npm test` | `npm run test:playtesters` | `npm run test:parity` | `npm run audit:parity`.

## 3. Act III Extension Seams
- **FPV / Acro Flight Mutators:** Wire optional Betaflight-style rate/airmode `FlightMutator`s behind `ModRegistry`.
- **Online Netplay & Leaderboards:** Feed deterministic `ReplayFrame` bitmasks over WebRTC/WebSocket rollback or submit verified Daily Seed replays.
