# KRUNKED SKYBREAKER — Architecture

## 1. Mission & Clean-Room IP Boundary

`krunked-skybreaker` (**KRUNKED SKYBREAKER**) is a clean-room TypeScript + Raw WebGL2 + Web Audio API 60Hz arcade dogfighter built around a strict two-act architecture and a live dual-vault asset system:

- **Act I (Core 60Hz Flight & Combat Lock):** Deterministic stall-and-whip flight feel, ballistics, 126 aircraft loadouts (`APEX OMEGA` at `[5,5,5]`), enemy AI and wave budgets (Normal + Overdrive/SFMT), 90 missions, virtual `600x400` (`NEAREST`) WebGL2 palette/water/health shaders, and sample-accurate phase-locked 3-stem dynamic audio.
- **Act II (Modability Readiness):** All verified Act I physics and rendering invariants are locked behind `VANILLA_1TO1_PROFILE` (`src/contracts/mod.ts`), while `ModRegistry`, deterministic input replay recording, and the live backtick (`` ` ``) Telemetry HUD provide zero-overhead extension seams for expanded arsenal/bosses, replay ghosts, daily seeds, shader FX, Palette Studio, and local 2P Co-op / 1v1 Dogfight Arena.

### IP Hygiene & Dual Asset Vault Invariant
- **100% Original Default Runtime (`SKYBREAKER` Mode):** Fresh launches and web builds boot into `'skybreaker'` (`vaultSource: 'procedural-fallback'`, shown in telemetry as `ASSETS: skybreaker-original`), using handcrafted procedural 8-level greyscale pixel-art sprite atlases, procedural pixel bitmap fonts, original Skybreaker part descriptions & 126 callsigns, original 8-color palettes (`SKYBREAKER` default), and original Web Audio synth stems & SFX.
- **Zero proprietary third-party files or verbatim creative copy are ever tracked in git.** `tools/parity-audit.ts` enforces both a git binary/media hygiene scan and a strict source trademark/verbatim-copy scan across default data, palettes, renderer chrome, mod packs, `index.html`, and `package.json`.
- **Optional Read-Only Local Steam Asset Bridge (`STEAM LOCAL` Mode):** At dev/preview runtime, `tools/steam-bridge/vite-plugin.ts` optionally mounts `SKYBREAKER_STEAM_DIR` (falling back to `LUFTRAUSERS_STEAM_DIR`, then the standard Windows Steam install path) strictly **read-only** under `/steam-vault/*` with path-traversal protection and on-the-fly format bridging:
  - `res/*.json`, `gfx/*.json`: JSONCPP plaintext (`//` and `/* */` comments, mixed casing, `original` inheritance) normalized cleanly into typed schemas.
  - `gfx/textures/diffuse/sheet1grey.png`: Uncompressed 32-bit BGRA TGA (`2048x1024`, top-left origin, 8-level luminance values mapping `int(diffuse.x * 8)` to palette indices `0..7`), decoded on-the-fly to raw RGBA8 bytes.
  - `PCP\0`-packed blobs: Detected cleanly via magic bytes (`50 43 50 00`); never reverse-cracked or bundled — replaced cleanly at runtime with crisp clean-room procedural 8-level greyscale textures matching the atlas and AngelCode `.fnt` glyph geometry.
  - `bgm/*.ogg` (20 stems) & `sfx/*.wav` (52 cues): Standard `OggS` and `RIFF WAVE` streams served read-only and decoded via Web Audio `decodeAudioData`.
- **Live Hangar Hot-Swap (`ASSETS` Row & `V` Key):** Players can toggle between `SKYBREAKER` and `STEAM LOCAL` directly inside the Hangar without reloading the page. Switching calls `vaultLoader.load(mode)`, `sim.setGameData(vault.data)`, `renderer.reloadVault(vault)`, `audio.init(vault)`, updates `hangar.setAssetMode` / `setVaultSource`, and persists `krunked_skybreaker_asset_mode_v1`.

## 2. Subsystem Topology & Ownership

```
┌──────────────────────────────────────────────────────────────────────┐
│                       src/main.ts + index.html                       │
│  Fixed 60Hz Loop (maxSubSteps=5) · Input/Gamepad · Persistence · HUD │
│   Live Asset Vault Hot-Swap · window.__SKYBREAKER_DEBUG__ Bridge     │
└───────┬──────────────────┬──────────────────┬──────────────────┬─────┘
        │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────────┐ ┌──────────────┐  ┌──────────────┐
│  src/vault/  │  │     src/sim/     │ │ src/render/  │  │  src/audio/  │
│ tools/steam- │  │ (Pure, Zero-DOM) │ │   src/ui/    │  │  Web Audio   │
│   bridge/    │  │                  │ │   WebGL2     │  │  3-Stem Bus  │
│              │  │ • Mulberry32 RNG │ │ • 600x400    │  │ • Epoch Lock │
│ • Original   │  │ • Aerodynamics   │ │   NEAREST    │  │   (< 1ms     │
│   Skybreaker │  │ • 126 Loadouts   │ │   FBOs       │  │   drift)     │
│   Pixel Art  │  │ • Projectiles    │ │ • reloadVault│  │ • Live Swap  │
│ • Dual Vault │  │ • 10 Enemy AIs   │ │ • batch/post │  │   Synth <->  │
│   Loader     │  │ • Spawn Director │ │   font/pause │  │   Steam OGG  │
│ • Read-Only  │  │ • 90 Missions    │ │ • 7-Row      │  │ • Critical   │
│   Steam API  │  │ • setGameData    │ │   Hangar UI  │  │   Alarm Stem │
│ • JSONCPP +  │  │ • Ace Pilot Bot  │ │ • ASSETS Row │  │ • Spatial +  │
│   TGA + .fnt │  │ • Replay + Mods  │ │ • Telemetry  │  │   *dist SFX  │
└──────────────┘  └──────────────────┘ └──────────────┘  └──────────────┘
        ▲                  ▲                  ▲                  ▲
        └──────────────────┴──────────────────┴──────────────────┘
                           src/contracts/**
```

## 3. Dataflow & 60Hz Determinism

1. **Boot:** `src/main.ts` probes `vaultLoader.isSteamAvailable()` and reads `krunked_skybreaker_asset_mode_v1` (defaulting strictly to `'skybreaker'`). If stored mode is `'steam-local'` AND `steamAvailable` is `true`, it loads `'steam-local'`; otherwise it loads `'skybreaker'` immediately with zero network fetches to `/steam-vault/*`. `AudioEngine.init(vault)` initializes/decodes audio asynchronously so keyboard handlers, `Backquote`/`~` telemetry, and WebGL2 rendering come online immediately.
2. **Fixed-Timestep Simulation (`dt = 1 / 60s`):** `src/main.ts` accumulates real `requestAnimationFrame` delta time (clamped to `<= 0.25s`), advancing `Simulation.step(input)` up to `maxSubSteps = 5` ticks per render frame. Every gameplay random decision inside `src/sim/` draws strictly from an explicit seeded PRNG (`Mulberry32`), while decorative FX draw from a separate seeded `visualRng` so identical `(seed, loadout, mode, inputStream)` yields bit-identical trajectories across 60Hz, 120Hz, 240Hz, and headless Vitest runs.
3. **Render Interpolation & Vault Reload:** `Renderer.render(currSnapshot, prevSnapshot, alpha, hangarUi, elapsedSec)` interpolates entity positions/angles across `[prevSnapshot, currSnapshot]` by `alpha = accumulator / (1/60)`, executing the multi-pass `600x400` WebGL2 pipeline (`colorpass` -> `reflectpass` -> `combopass` (`post.shader` health circle + water remap) -> `hudpass` -> `pausePass`/`menuPass` -> `outpass` aspect-correct `NEAREST` upscale with a top-HUD `hudSafe` UV protection mask when Act II warp/shockwave FX are enabled). `Renderer.reloadVault(vault)` cleanly swaps GPU atlas & font textures on the active WebGL2 context with `0` GL errors.
4. **Audio Synchronization:** `AudioEngine.syncFromSnapshot(snapshot)` consumes `snapshot.audioEvents` for pooled spatial SFX (auto-selecting `*dist` variants beyond viewport range with stereo pan) and manages phase-locked looping stems anchored to a single `AudioContext.currentTime` epoch. Calling `audio.init(nextVault)` hot-swaps between original Skybreaker synth buffers and local Steam buffers while preserving an already-unlocked `AudioContext`.

## 4. Skybreaker Mod Packs & Extension Seams

- **`ModRegistry` (`src/sim/mod-registry.ts`, `src/sim/mod-packs.ts`):** Defaults to `vanillaLocked = true` (`VANILLA_1TO1_PROFILE`). Unlocking via the Hangar `Tab` `SKYBREAKER MOD DECK` activates four clean modular packs without modifying Act I vanilla behavior:
  - **Expanded Arsenal & Mega-Bosses (`ARSENAL_BOSSES_MOD`):** Custom weapons (`6..8`: Railgun, Flak, Chain Lightning), bodies (`6..8`: Aegis shield, Vampire lifesteal, Overclock), engines (`6..8`: Afterburner, Vector, Ion), modded callsigns (`RAILBREAKER`, `FLAKBREAKER`, `AEGIS BREAKER`, etc.), and bosses (`Dreadnought`, `SkyCarrier`, `AceSquadron`) preserving exact vanilla flight controls.
  - **Deterministic Replay Ghost & Daily Seed (`REPLAY_GHOST_MOD`, `src/sim/replay-ghost.ts`):** Isolated-PRNG `GhostRunner` rendering Personal Best trajectories, UTC `YYYYMMDD` Daily Seed sorties, and fuzz-hardened replay JSON import/export.
  - **Custom Shader & Live Palette Studio (`SHADER_STUDIO_MOD`, `src/ui/palette-studio.ts`):** Optional `outpass` WebGL2 effects (CRT Scanlines, Phosphor Bloom, Speed-Warp Vignette, Screen-Space Shockwaves — strictly forced to `0` on Vanilla 1:1 snapshots), 4 bonus neon palettes, and an 8-slot live RGB Palette Studio.
  - **Local 2P Co-op & 1v1 Dogfight Arena (`MULTIPLAYER_2P_MOD`):** Dual-pilot waves (`coop2p` with 300-tick partner respawn and surviving-pilot audio tracking) and Best-of-5 1v1 aerial dogfights (`dogfight1v1`) supporting Bot partners/rivals, split-keyboard, and dual XInput gamepads.
- **Live Telemetry Overlay (`src/ui/telemetry-hud.ts`):** Hidden by default during vanilla play; toggled via backtick (`` ` ``) at bottom-left (`bottom: 8px; left: 8px`) to inspect live FPS/p95 frame delta, draw calls, GL/console errors, speed/angle/altitude, active enemies/difficulty, audio drift (`ms`), asset source (`ASSETS: skybreaker-original` / `steam-local`), active palette, and active Act II mod state. Optional QA hotkeys (`F2/F3/F4/F6/F7/F8/F9`) in `src/main.ts` are strictly gated to when the overlay is visible.
