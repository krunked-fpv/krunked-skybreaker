# KRUNKED SKYBREAKER

Clean-room 60Hz WebGL2 arcade dogfighter built in TypeScript + Raw WebGL2 + Web Audio API + Vite + Vitest. Ships with 100% original procedural pixel art, phase-locked synth audio, original aircraft callsigns, and modular **Skybreaker Mod Packs** behind `ModRegistry`, plus an optional strictly read-only local Steam asset vault toggle.

## Clean-Room & Non-Affiliation Notice

- **100% Original Default Assets (`SKYBREAKER` Mode):** Fresh launches and public web deployments default to `SKYBREAKER` mode, rendering original procedural pixel-art sprite sheets, original bitmap fonts, original Web Audio synth stems/SFX, original 8-color palettes, and 126 original aircraft callsigns & part descriptions. Zero copyrighted third-party media files, binaries, or verbatim creative text are included in this repository.
- **Optional Read-Only Local Steam Asset Vault (`STEAM LOCAL` Mode):** If you legally own a local Steam installation of LUFTRAUSERS on your machine, the Vite dev bridge (`tools/steam-bridge/vite-plugin.ts`) exposes it strictly **read-only** (`SKYBREAKER_STEAM_DIR`, fallback `LUFTRAUSERS_STEAM_DIR`, fallback Windows default path) so you can hot-swap between `SKYBREAKER` and `STEAM LOCAL` directly inside the Hangar without modifying or copying any game files.
- **Non-Affiliation:** `krunked-skybreaker` is an independent clean-room project and is **not affiliated with, endorsed by, or sponsored by Vlambeer or Devolver Digital**.

## Quickstart

```bash
npm install
npm start
```

Open `http://127.0.0.1:5173/`.

- **Original Skybreaker by Default:** Boots into `SKYBREAKER` asset mode (`ASSETS: skybreaker-original`) locked to `VANILLA_1TO1_PROFILE` with deterministic 60Hz stall-and-whip aerodynamics, 126 aircraft loadouts (`APEX OMEGA` at `[5,5,5]`), 90 missions, `600x400` `NEAREST` palette/water/health shaders, and phase-locked 3-stem dynamic audio.
- **Live Asset Vault Toggle (`ASSETS` Row or `V` in Hangar):** Switch seamlessly between `SKYBREAKER` (original procedural pixel art & synth) and `STEAM LOCAL` (optional read-only local Steam vault, when detected) live in the Hangar with zero page reload, zero WebGL errors, and `< 1ms` audio stem drift. Your preference persists in `krunked_skybreaker_asset_mode_v1` (defaulting to `'skybreaker'`).
- **Skybreaker Mod Deck (`Tab` in Hangar):** Toggle `VANILLA 1:1 / MODDED` and enable any combination of:
  - **Expanded Arsenal & Mega-Bosses:** Railgun, Flak, Chain Lightning, Aegis, Vampire, Overclock, Afterburner, Vector, Ion + Dreadnought, Sky Carrier, and Ace Squadron bosses.
  - **Replay Ghost & Daily Seed:** Race against your live Personal Best ghost silhouette and deterministic UTC `YYYYMMDD` Daily Seed sorties.
  - **Shader FX & Live Palette Studio:** Toggle CRT Scanlines, Phosphor Bloom, Speed-Warp Vignette, and Screen-Space Shockwaves, plus edit all 8 palette channels live.
  - **Local 2P Co-op & 1v1 Dogfight Arena:** Play Co-op waves or Best-of-5 1v1 Aerial Dogfights with an AI Bot partner/rival or 2 players on split-keyboard / dual gamepads.

## Controls

| Context | Solo / Vanilla / 2P-Bot | 2P Human Split-Keyboard (`P2 PILOT: HUMAN`) | Gamepad (`XInput`) |
|---|---|---|---|
| **Thrust** | `Up` / `W` | P1 `W` · P2 `Up` | `A` / `RT` / D-Pad Up |
| **Pitch Left / Right** | `Left` / `Right` or `A` / `D` | P1 `A`/`D` · P2 `Left`/`Right` | Left Stick X / D-Pad |
| **Fire** | `Z` / `Space` / `J` | P1 `F`/`Space`/`LShift` · P2 `M`/`Num0`/`/`/`Enter` | `X` / `B` / `RB` |
| **Hangar & Mod Deck** | `Up`/`Down` rows, `Left`/`Right` cycle, `C` palette, `V` asset vault (`SKYBREAKER` ↔ `STEAM LOCAL`), `M` mode, `Tab` Mod Deck, `Enter`/`X` launch | Same | D-Pad + `A`/`Start` (`Select` Mod Deck) |
| **Palette Studio** | `Up`/`Down` slot, `Q`/`E`/`Tab` R/G/B, `Left`/`Right` tune, `1`–`4` presets, `R` reset, `Enter` save, `Esc` back | Same | — |
| **Pause / Telemetry** | `P` / `Esc` pause (`H` Hangar), `` ` `` Parity Telemetry HUD | Same | `Start` |

## Verification Scripts

```bash
npm run typecheck        # Strict TypeScript check (tsc --noEmit)
npm test                 # Core + Mod subsystem unit tests (101 tests)
npm run test:playtesters # 100-Playtester adversarial chaos gauntlet (PT-001..PT-100)
npm run test:parity      # Live E2E physics/audio/render parity proofs + 12 x 3,600-tick sorties (25 tests)
npm run audit:parity     # Clean-room IP & trademark hygiene scan + Steam JSON numeric scorecard (21 checks)
npm run build            # Production TypeScript + Vite bundle
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [SPEC.md](./SPEC.md), and [HANDOFF.md](./HANDOFF.md) for full contracts and extension details.
