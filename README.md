# krunkedLUFTRAUSERS

Clean-room, 1:1 playable recreation of **LUFTRAUSERS** built in TypeScript + Raw WebGL2 + Web Audio API + Vite + Vitest, backed by a strictly read-only local Steam asset vault bridge, a deterministic Procedural Vector & Synth Fallback Pack, and modular **Act II Mod Packs** behind `ModRegistry`.

## Quickstart

```bash
npm install
npm start
```

Open `http://127.0.0.1:5173/`.

- **Vanilla 1:1 by Default:** Boots locked to `VANILLA_1TO1_PROFILE` with 1:1 Steam physics, 126 aircraft loadouts, 90 missions, `600x400` `NEAREST` palette/water/health shaders, and phase-locked 3-stem dynamic audio.
- **Act II Mod Deck (`Tab` in Hangar):** Toggle `VANILLA 1:1 / MODDED` and enable any combination of:
  - **Expanded Arsenal & Mega-Bosses:** Railgun, Flak, Chain Lightning, Aegis, Vampire, Overclock, Afterburner, Vector, Ion + Dreadnought, Sky Carrier, and Ace Squadron bosses.
  - **Replay Ghost & Daily Seed:** Race against your live Personal Best ghost silhouette and deterministic UTC `YYYYMMDD` Daily Seed sorties.
  - **Shader FX & Live Palette Studio:** Toggle CRT Scanlines, Phosphor Bloom, Speed-Warp Vignette, and Screen-Space Shockwaves, plus edit all 8 palette channels live.
  - **Local 2P Co-op & 1v1 Dogfight Arena:** Play Co-op waves or Best-of-5 1v1 Aerial Dogfights with an AI Bot partner/rival or 2 players on split-keyboard / dual gamepads.
- **Clean-Room Steam Vault vs. Procedural Fallback:** Automatically mounts `C:\Program Files (x86)\Steam\steamapps\common\Luftrausers\data` read-only (`LUFTRAUSERS_STEAM_DIR` override) without tracking any copyrighted assets in git, or runs seamlessly via `procedural-fallback` when Steam is unavailable.

## Controls

| Context | Solo / Vanilla / 2P-Bot | 2P Human Split-Keyboard (`P2 PILOT: HUMAN`) | Gamepad (`XInput`) |
|---|---|---|---|
| **Thrust** | `Up` / `W` | P1 `W` · P2 `Up` | `A` / `RT` / D-Pad Up |
| **Pitch Left / Right** | `Left` / `Right` or `A` / `D` | P1 `A`/`D` · P2 `Left`/`Right` | Left Stick X / D-Pad |
| **Fire** | `Z` / `Space` / `J` | P1 `F`/`Space`/`LShift` · P2 `M`/`Num0`/`/`/`Enter` | `X` / `B` / `RB` |
| **Hangar & Mod Deck** | `Up`/`Down` rows, `Left`/`Right` cycle, `C` palette, `M` mode, `Tab` Mod Deck, `Enter`/`X` launch | Same | D-Pad + `A`/`Start` (`Select` Mod Deck) |
| **Palette Studio** | `Up`/`Down` slot, `Q`/`E`/`Tab` R/G/B, `Left`/`Right` tune, `1`–`4` presets, `R` reset, `Enter` save, `Esc` back | Same | — |
| **Pause / Telemetry** | `P` / `Esc` pause (`H` Hangar), `` ` `` Parity Telemetry HUD | Same | `Start` |

## Verification Scripts

```bash
npm run typecheck        # Strict TypeScript check (tsc --noEmit)
npm test                 # Act I + Act II subsystem unit tests (89 tests)
npm run test:playtesters # 100-Playtester adversarial chaos gauntlet (PT-001..PT-100)
npm run test:parity      # Live Steam E2E 1:1 parity proofs + 12 x 3,600-tick sorties (25 tests)
npm run audit:parity     # Clean-room IP git hygiene + Steam JSON diff scorecard (19 checks)
npm run build            # Production TypeScript + Vite bundle
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [SPEC.md](./SPEC.md), and [HANDOFF.md](./HANDOFF.md) for full contracts and extension details.
