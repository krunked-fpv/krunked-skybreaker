# krunkedLUFTRAUSERS

Clean-room, 1:1 playable recreation of **LUFTRAUSERS** built in TypeScript + Raw WebGL2 + Web Audio API + Vite + Vitest, backed by a strictly read-only local Steam asset vault bridge and a deterministic clean-room Procedural Vector & Synth Fallback Pack.

## Quickstart

```bash
npm install
npm start
```

Open `http://127.0.0.1:5173/`.

- **With local Steam install (Windows default):** Automatically mounts `C:\Program Files (x86)\Steam\steamapps\common\Luftrausers\data` read-only (`vaultSource: "steam-local"`), streaming real JSONCPP configs, `sheet1grey.png` (32-bit TGA), AngelCode `.fnt` metrics, 20 OGG music stems, and 52 WAV SFX cues without copying any proprietary files into this repository. Override the path via `LUFTRAUSERS_STEAM_DIR`.
- **Without Steam install / CI:** Automatically activates `vaultSource: "procedural-fallback"` with zero-drift vanilla tables, 8-level greyscale procedural vector atlases, procedural bitmap fonts, and phase-locked procedural Web Audio synth stems & SFX.

## Controls

| Context | Keys | Gamepad (`XInput`) |
|---|---|---|
| **Thrust** | `Up` / `W` | `A` / `RT` / D-Pad Up |
| **Pitch Left / Right** | `Left` / `Right` or `A` / `D` | Left Stick X / D-Pad Left-Right |
| **Fire** | `Z` / `Space` / `J` | `X` / `B` / `RB` |
| **Hangar Navigation** | `Up` / `Down` (`W` / `S`) rows, `Left` / `Right` (`A` / `D`) cycle, `C` palette, `M` mode, `Enter` / `X` launch | D-Pad / Left Stick + `A` / `Start` |
| **Pause / Hangar** | `P` / `Esc` pause (`H` / `Backspace` return to Hangar) | `Start` |
| **Parity Telemetry HUD** | `` ` `` (Backtick — hidden by default during vanilla play) | — |

## Verification Scripts

```bash
npm run typecheck     # Strict TypeScript check (tsc --noEmit)
npm test              # Subsystem unit tests (vault, sim, render/UI, audio)
npm run test:parity   # Live Steam E2E 1:1 parity proofs + 12 x 3,600-tick Ace Bot sorties
npm run audit:parity  # Clean-room IP git hygiene + Steam JSON diff scorecard
npm run build         # Production TypeScript + Vite bundle
```

## Architecture & Modding

See [ARCHITECTURE.md](./ARCHITECTURE.md), [SPEC.md](./SPEC.md), and [HANDOFF.md](./HANDOFF.md). All Act I 1:1 constants are regression-locked behind `VANILLA_1TO1_PROFILE`, while `ModRegistry` (`src/sim/mod-registry.ts`), deterministic bitmask replays, and `window.__RAUSER_DEBUG__` expose clean Act II extension seams.
