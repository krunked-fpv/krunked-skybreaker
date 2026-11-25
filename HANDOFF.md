# KRUNKED SKYBREAKER — Sprint Handoff

## 1. Shipped Capabilities & Verified Parity Metrics
- **100% Original Default Brand & Assets (`KRUNKED SKYBREAKER`):**
  - Fresh launches and web deployments boot directly into `'skybreaker'` (`ASSETS: skybreaker-original`) with upgraded original handcrafted procedural pixel-art sprite atlases, original 8-color `SKYBREAKER` palette + 11 unlockable palettes (`inverted`, `synthdusk`, `overdrive`, etc.), 126 original aircraft callsigns (`APEX OMEGA` at `[5,5,5]`), clean original part names/descriptions, and original phase-locked Web Audio synth stems & SFX.
  - Zero copyrighted third-party binaries or verbatim creative text tracked in git; enforced continuously by `tools/parity-audit.ts`.
- **Full Roster Immediately Accessible & Legacy Save Migration (`src/ui/profile-storage.ts`, `src/ui/hangar-ui.ts`, `src/render/renderer.ts`, `src/main.ts`):**
  - Fresh browser sessions default to Free-Play (`allUnlocked: true` unless `krunked_skybreaker_progression_lock_v1 === 'true'`), exposing all **6** core weapons/bodies/engines (`126` combos including `APEX OMEGA`), all **12** core palettes, and `OVERDRIVE` (`SFMT`) immediately while keeping mission progress cleanly at `0/90` (and expanding to **9** weapons/bodies/engines = `729` combos and **17** palettes including 4 bonus + Custom Studio when Modded Arsenal is enabled).
  - Hangar rows display live slot index counters (`WEAPON 1/6`..`1/9`, `BODY 1/6`..`1/9`, `ENGINE 1/6`..`1/9`, `PALETTE 1/12`..`1/17`) with horizontal overlap protection and no false `[LOCKED]` footer badge in Free-Play mode.
  - Pressing `U` in Hangar toggles cleanly between `ALL UNLOCKED` (`U:ALL`) and `CAMPAIGN LOCKS` (`U:LOCK`, persisted in `krunked_skybreaker_progression_lock_v1`); `createDefaultProfile()` in `src/sim/` and `HangarController` default `allUnlocked: false` remain untouched so Act I progression unit tests stay 100% locked.
  - Legacy `krunked_luftrausers_{profile,act2_mods,act2_custom_palette,act2_pb_ghost}_v1` browser saves (including legacy palette aliases) automatically migrate to `krunked_skybreaker_*` on load.
- **Live Hangar Asset Vault Toggle (`ASSETS` Row & `V` Shortcut):**
  - Optionally detects a read-only local Steam install (`SKYBREAKER_STEAM_DIR` / `LUFTRAUSERS_STEAM_DIR` / Windows default) via `VaultLoader.isSteamAvailable()`.
  - Players can hot-swap between `SKYBREAKER` and `STEAM LOCAL` directly inside the Hangar (no page reload!) via the `ASSETS` row, `V` key, or `window.__SKYBREAKER_DEBUG__.setAssetMode(...)`, cleanly running `sim.setGameData(...)`, `renderer.reloadVault(...)`, and `audio.init(...)` with `0` GL errors, `< 1ms` audio drift, and persistence in `krunked_skybreaker_asset_mode_v1`.
- **Act I Core Lock (`VANILLA_1TO1_PROFILE`):** Default profile locks `ModRegistry` (`vanillaLocked = true`) so flight controls, 60Hz `Mulberry32` aerodynamics, 126 aircraft loadouts, 10 Normal/SFMT enemies, 90 missions, `600x400` `NEAREST` palette/water/health shaders, and phase-locked 3-stem Web Audio remain deterministic and regression-locked.
- **Skybreaker Mod Packs (Hangar `Tab` -> `SKYBREAKER MOD DECK`):**
  1. **Expanded Arsenal & Mega-Bosses (`src/sim/mod-packs.ts`):** Custom weapons (`6` Railgun, `7` Flak 6-shard airburst, `8` Chain Lightning 3-target arc), bodies (`6` Aegis shield, `7` Vampire lifesteal, `8` Overclock), engines (`6` Afterburner, `7` Vector, `8` Ion), original modded callsigns (`RAILBREAKER`, `FLAKBREAKER`, `AEGIS BREAKER`, etc.), and Mega-Bosses (`Dreadnought`, `SkyCarrier`, `AceSquadron`).
  2. **Deterministic Replay Ghost & Daily Seed (`src/sim/replay-ghost.ts`):** Isolated-PRNG `GhostRunner` rendering your Personal Best silhouette & trail, UTC `YYYYMMDD` Daily Seed sorties, and fuzz-hardened replay JSON export/import.
  3. **Custom Shader & Live Palette Studio (`src/render/shaders.ts`, `src/ui/palette-studio.ts`):** Toggleable CRT Scanlines, Phosphor Bloom, Speed-Warp Vignette, and Screen-Space Shockwaves in `outpass` (strictly zeroed in Vanilla 1:1), 4 bonus neon palettes, and an 8-slot live RGB Palette Studio.
  4. **Local 2P Co-op & 1v1 Dogfight Arena (`src/sim/simulation.ts`, `src/main.ts`):** Co-op waves with 300-tick partner respawn and Best-of-5 1v1 Dogfight Arena (Bot wingman/rival or split-keyboard `WASD+F/Space` vs `Arrows+M/Num0` & dual Gamepad).
- **Empirical Verification:** `npm run typecheck` (`0` errors), `npm test` (`101/101`), `npm run test:playtesters` (`100/100`, including live `SKYBREAKER` ↔ `STEAM LOCAL` hot-swap in `PT-081`), `npm run test:parity` (`25/25`), `npm run audit:parity` (`21/21`, `0` git-hygiene violations, `0` trademark leaks, `0` numeric diffs), and `npm run build` clean.

## 2. Runtime Operation & CLI
- `npm start` boots into `SKYBREAKER` original procedural art & synth by default and exposes optional read-only local Steam data (`SKYBREAKER_STEAM_DIR`, fallback `LUFTRAUSERS_STEAM_DIR`) when toggled via Hangar `ASSETS` / `V`.
- **CLI:** `npm start` | `npm run build` | `npm run typecheck` | `npm test` | `npm run test:playtesters` | `npm run test:parity` | `npm run audit:parity`.

## 3. Ready-to-Sprint Seams (Next Sprint Cold-Boot)
- **Cold-Boot Anchor:** Read only `ARCHITECTURE.md`, `SPEC.md`, and `HANDOFF.md`; keep `VANILLA_1TO1_PROFILE` and clean-room IP hygiene regression-locked (`npm run typecheck`, `npm test`, `npm run test:playtesters`, `npm run test:parity`, `npm run audit:parity`, `npm run build`).
- **FPV / Acro Flight Mutators:** Wire optional Betaflight-style rate/airmode `FlightMutator`s behind `ModRegistry`.
- **Online Netplay & Leaderboards:** Feed deterministic `ReplayFrame` bitmasks over WebRTC/WebSocket rollback or submit verified Daily Seed replays.
- **Content Expansion:** Add new weapons/bodies/engines/bosses/palettes cleanly inside `src/sim/mod-packs.ts` and `src/render/palettes.ts` while keeping default assets 100% original.
