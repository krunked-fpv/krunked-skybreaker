# krunkedLUFTRAUSERS — Architecture

## 1. Mission & Clean-Room IP Boundary

`krunkedLUFTRAUSERS` is a clean-room TypeScript + Raw WebGL2 + Web Audio API recreation of **LUFTRAUSERS** built around a strict two-act design:

- **Act I (1:1 Vanilla Parity):** Empirically 1:1 flight feel, ballistics, 126 aircraft loadouts, enemy AI and wave budgets (Normal + SFMT), 90 missions, virtual `600x400` (`NEAREST`) WebGL2 palette/water/health shaders, and sample-accurate phase-locked 3-stem dynamic audio.
- **Act II (Modability Readiness):** All verified Act I physics and rendering invariants are locked behind `VANILLA_1TO1_PROFILE` (`src/contracts/mod.ts`), while `ModRegistry`, deterministic input replay recording, and the live backtick (`` ` ``) Telemetry HUD provide zero-overhead extension seams for future FPV/acro flight mutators, custom parts, custom palettes, bosses, and netplay.

### IP Hygiene Invariant
- **Zero proprietary Steam files are ever copied, vendored, or tracked in git.**
- At dev/preview runtime, `tools/steam-bridge/vite-plugin.ts` mounts `LUFTRAUSERS_STEAM_DIR` (defaulting on Windows to `C:\Program Files (x86)\Steam\steamapps\common\Luftrausers\data`) strictly **read-only** under `/steam-vault/*` with path-traversal protection and on-the-fly format bridging.
- **Asset Format Bridging (verified empirically on local Steam install):**
  - `data/res/*.json`, `data/gfx/*.json`: JSONCPP plaintext (`//` and `/* */` comments, mixed casing, `original` inheritance) normalized cleanly into typed schemas.
  - `data/gfx/textures/diffuse/sheet1grey.png`: Uncompressed 32-bit BGRA TGA (`2048x1024`, top-left origin, 8-level luminance values `0, 32, 64, 96, 128, 160, 192, 224` mapping `int(diffuse.x * 8)` to palette indices `0..7`). Decoded on-the-fly to raw RGBA8 bytes by the vault loader.
  - `data/gfx/textures/diffuse/sheet2grey.png`, `nuke.png`, `data/gfx/fonts/fnt*_0.png`: Proprietary `PCP\0`-packed `IMTX` blobs. Detected cleanly via magic bytes (`50 43 50 00`); never reverse-cracked or bundled—replaced cleanly at runtime with crisp clean-room procedural 8-level greyscale textures matching `menusprites.json`, `nukesprites.json`, and the real AngelCode `.fnt` glyph geometry parsed from `data/gfx/fonts/*.fnt`.
  - `data/bgm/*.ogg` (20 stems) & `data/sfx/*.wav` (52 cues): Standard `OggS` and `RIFF WAVE` streams served read-only and decoded via Web Audio `decodeAudioData`.
- Whenever `LUFTRAUSERS_STEAM_DIR` is missing (CI, headless tests, non-Steam machines), `src/vault/` seamlessly activates `vaultSource: 'procedural-fallback'` with deterministic clean-room vector atlases (using the exact 8-level luminance encoding so the identical WebGL2 palette shader renders both), procedural pixel bitmap fonts, and procedural Web Audio synth stems & SFX.

## 2. Subsystem Topology & Ownership

```
┌──────────────────────────────────────────────────────────────────────┐
│                       src/main.ts + index.html                       │
│  Fixed 60Hz Loop (maxSubSteps=5) · Input/Gamepad · Persistence · HUD │
│                    window.__RAUSER_DEBUG__ Bridge                    │
└───────┬──────────────────┬──────────────────┬──────────────────┬─────┘
        │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────────┐ ┌──────────────┐  ┌──────────────┐
│  src/vault/  │  │     src/sim/     │ │ src/render/  │  │  src/audio/  │
│ tools/steam- │  │ (Pure, Zero-DOM) │ │   src/ui/    │  │  Web Audio   │
│   bridge/    │  │                  │ │   WebGL2     │  │  3-Stem Bus  │
│              │  │ • Mulberry32 RNG │ │ • 600x400    │  │ • Epoch Lock │
│ • Read-only  │  │ • Aerodynamics   │ │   NEAREST    │  │   (< 1ms     │
│   Middleware │  │ • 126 Loadouts   │ │   FBOs       │  │   drift)     │
│ • JSONCPP    │  │ • Projectiles    │ │ • batch /    │  │ • 125-Combo  │
│   Normalizer │  │ • 10 Enemy AIs   │ │   post /     │  │   Stem Mix   │
│ • TGA Decode │  │ • Spawn Director │ │   font /     │  │ • Critical   │
│ • .fnt Parse │  │ • 90 Missions    │ │   combofont /│  │   Alarm Stem │
│ • Procedural │  │ • Ace Pilot Bot  │ │   pauselines │  │ • Spatial +  │
│   Fallback   │  │ • Replay + Mods  │ │ • Hangar UI  │  │   *dist SFX  │
└──────────────┘  └──────────────────┘ └──────────────┘  └──────────────┘
        ▲                  ▲                  ▲                  ▲
        └──────────────────┴──────────────────┴──────────────────┘
                           src/contracts/**
```

## 3. Dataflow & 60Hz Determinism

1. **Boot:** `VaultLoader.load()` probes `/steam-vault/manifest.json` (provided by `tools/steam-bridge/vite-plugin.ts`). If available, loads Steam JSONCPP data, TGA gameplay atlas, `.fnt` metrics, and audio manifest (`vaultSource: 'steam-local'`); otherwise initializes the procedural fallback bundle (`vaultSource: 'procedural-fallback'`).
2. **Fixed-Timestep Simulation (`dt = 1 / 60s`):** `src/main.ts` accumulates real `requestAnimationFrame` delta time (clamped to `<= 0.25s`), advancing `Simulation.step(input)` up to `maxSubSteps = 5` ticks per render frame. Every random decision inside `src/sim/` draws strictly from an explicit seeded PRNG (`Mulberry32`) so identical `(seed, loadout, mode, inputStream)` yields bit-identical trajectories across 60Hz, 120Hz, 240Hz, and headless Vitest runs.
3. **Render Interpolation:** `Renderer.render(currSnapshot, prevSnapshot, alpha, hangarUi, elapsedSec)` interpolates entity positions/angles across `[prevSnapshot, currSnapshot]` by `alpha = accumulator / (1/60)`, executes the multi-pass `600x400` WebGL2 pipeline (`colorpass` -> `reflectpass` -> `combopass` (`post.shader` health circle + water remap) -> `hudpass` -> `pausePass`/`menuPass` -> `outpass` aspect-correct `NEAREST` upscale).
4. **Audio Synchronization:** `AudioEngine.syncFromSnapshot(snapshot)` consumes `snapshot.audioEvents` for pooled spatial SFX (auto-selecting `*dist` variants beyond viewport range with stereo pan) and manages phase-locked looping stems anchored to a single `AudioContext.currentTime` epoch.

## 4. Act II Extension Seams

- **`ModRegistry` (`src/sim/mod-registry.ts`):** Defaults to `vanillaLocked = true` (`VANILLA_1TO1_PROFILE`). Unlocking allows registering `FlightMutator`s (e.g., FPV acro rate curves, thrust vectoring), custom parts, and custom palettes without modifying a single line of Act I physics.
- **Deterministic Replay (`ReplayRecording`):** Captures compact bitmask inputs per tick with seed/loadout/mode for replay playback, ghost runs, and parity regression fixtures.
- **Live Telemetry Overlay (`src/ui/telemetry-hud.ts`):** Hidden by default during vanilla play; toggled via backtick (`` ` ``) at bottom-left (`bottom: 8px; left: 8px`) to inspect live FPS/p95 frame delta, draw calls, GL/console errors, speed/angle/altitude, active enemies/difficulty, audio drift (`ms`), and vault mode. Optional QA hotkeys (`F3/F4/F6/F7/F8/F9`) in `src/main.ts` are strictly gated to when the overlay is visible.
