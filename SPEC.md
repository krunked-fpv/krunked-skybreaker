# KRUNKED SKYBREAKER — Technical Specification

All shared TypeScript interfaces live in `src/contracts/`. Every subsystem MUST strictly conform to the equations, normalization rules, shader uniforms, IP boundaries, and tolerances specified here.

---

## 1. Dual Asset Vault & JSONCPP Normalization Rules (`src/vault/`)

### 1.1 Dual Asset Pack Modes (`AssetPackMode = 'skybreaker' | 'steam-local'`)
- **`'skybreaker'` (Default):** Always returns `createProceduralFallbackBundle()` immediately with zero Steam fetches. Ships 100% original handcrafted procedural pixel-art sprite sheets (using 8-level greyscale luminance indices `0..7` so the identical WebGL2 palette shader renders both packs), original pixel bitmap fonts, original part names/descriptions, 125 distinct original Skybreaker callsigns + `[5,5,5]` **`APEX OMEGA`**, and original Web Audio synth stems & SFX.
- **`'steam-local'` (Optional Read-Only Local Bridge):** Probes `/steam-vault/manifest.json` served read-only by `tools/steam-bridge/vite-plugin.ts` from `SKYBREAKER_STEAM_DIR` (fallback `LUFTRAUSERS_STEAM_DIR`, then default Windows Steam path). Cleanly falls back to `'skybreaker'` if unavailable (e.g., CI, headless tests, or public static web hosts like `*.github.io`).
- **`VaultLoader.isSteamAvailable(): Promise<boolean>`:** Probes `/steam-vault/manifest.json` without mutating state so the Hangar `ASSETS` row and `V` shortcut know whether live toggling to `STEAM LOCAL` is available.

### 1.2 Optional Steam JSONCPP & Binary Bridge Rules
When loading optional local Steam JSONCPP files (`res/*.json`, `gfx/*.json`), the clean-room parser (`parseJsonCpp`) MUST:
1. Strip `// ...` single-line comments (respecting string literals so URLs/strings remain intact).
2. Strip `/* ... */` multi-line block comments (present in `fxparticle.json`).
3. Remove trailing commas before `}` and `]`.
4. Canonicalize object property keys case-insensitively where JSON mixes casing (e.g., `fireInterval` vs `fireinterval`, `reactionseaHeightB` vs `reactionseaheightB`, `environmentalYforce` vs `environmentalyforce`).
5. **Stat Inheritance (`player.json`):** Every engine (`1..5`), body (`1..5`), and weapon (`1..5`) inherits ALL omitted fields from its category's `id: 0` entry before applying its overrides.
   - Secret tier (`id: 5`) inherits base stats; for Body `5`, `maxhealth: 120` and `healingspd: 0.01` override defaults.
   - When all three slots equal `5` (`[5, 5, 5]`), the aircraft resolves to `planenames[125].name` (**`APEX OMEGA`** in `skybreaker` mode, or the local JSON entry in `steam-local` mode) with the `416x300` silhouette sprite and apex audio theme. When only 1 or 2 slots equal `5`, audio plays the mystery/unknown theme and name displays `"???"`.
6. **TGA & PCP Handling:**
   - Detect uncompressed 32-bit TGA (`header[2] === 2 && header[16] === 32`): decode BGRA -> RGBA honoring top-left origin flag (`header[17] & 0x20`).
   - Detect `PCP\0` magic (`0x50 0x43 0x50 0x00`): do not pass raw bytes to `<img>` decode; synthesize clean-room procedural 8-level greyscale RGBA textures conforming to the matching JSON atlas or AngelCode `.fnt` metrics.

---

## 2. Deterministic 60Hz Flight & Combat Physics (`src/sim/`)

Coordinate convention (matching `room.json` and `batch.shader`/`post.shader`):
- `+X` right, `+Y` downward (`sealevel = 0`, `spacelevel = -1300`).
- `angleDeg`: `0°` = right (`+X`), `-90°` = straight up (`-Y`), `+90°` = straight down (`+Y`). Forward unit vector `(cos(rad), sin(rad))`.
- Fixed timestep: `dt = 1 / 60s` (1 simulation tick = 1 frame at 60Hz; all physics constants are per-tick units).
- Live hot-swap: `Simulation.setGameData(data)` updates active game data, rebuilds player/mission definitions while preserving profile, loadout, mode, and `modFlags`.

### 2.1 Stall-and-Whip Aerodynamics
1. **Effective Turn Rate:**
   - Base turn speed: `turnRate = boosting ? engine.turnspeedboost : engine.turnspeed` (Standard: `10°/tick` coasting vs `4°/tick` boosting; Superboost/Turbo: `10°` vs `1°`).
   - Continuous beam divisor: If `weapon.id === 1` (`laser`) AND `input.fire === true`, `turnRate = turnRate / 3`.
   - Apply pitch: `angleDeg += (right - left) * turnRate`.
2. **Thrust vs. Gravity & Drag:**
   - Max speed cap: `effectiveMaxSpeed = engine.maximumspeed * body.speedmodifier` (Standard: `8.0`; Armor: `8.0 * 0.8 = 6.4`; Superboost: `11.0`).
   - If `input.thrust`:
     - Add forward acceleration along heading: `accel = engine.acceleration` (plus initial burst impulse `engine.boostadd` on rising thrust edge, e.g. `boostadd: 2`).
     - Velocity alignment (`motionadddirection`, `motionaddimageangle`): blend current velocity direction gently toward facing angle so boost tightens turns smoothly while coasting preserves ballistic momentum.
     - **Gun-Engine (`flags === 'gun-engine'`):** While boosting, fires rear bullets at `angleDeg + 180°` every 3 ticks (`dmg: 4`, `speed: 24`), propelling the craft forward with `acceleration: 5.5` (clamped smoothly to `effectiveMaxSpeed`) and playing `sndgungine`.
   - Always apply gravity (`vy += engine.gravity`, Standard `0.2`, Hover `0.02`) and aerodynamic drag (`speed = max(engine.minimumspeed, speed * (1 - engine.friction))` when coasting, or clamped to `effectiveMaxSpeed` when boosting).
   - **Recoil:** Firing spread/scatter (`id: 2`) applies `recoil: 1.5` impulse opposite facing angle (`vx -= cos(rad)*recoil`, `vy -= sin(rad)*recoil`).
3. **Sea-Level (`y > 0`) & Space-Ceiling (`y < -1300`) Environment Forces:**
   - **Water (`y > sealevel`):**
     - `envWaterFactor = min(1, envWaterFactor + engine.wateracceleration)` (decays by `* engine.environmentfriction` above water, snapped to `0` below `engine.environmentmin`).
     - Upward buoyancy: `vy -= engine.waterforce * (0.5 + envWaterFactor)`.
     - Upward pitch restoration: rotate `angleDeg` smoothly toward `-90°` (up) by `settings.waterrotationforcedegrees` (`3°/tick`) when submerged and not waterproof.
     - Damage: if `!engine.waterproof`, apply `(health / maxHealth < engine.waterlowhpperc ? engine.waterdmglowhp : engine.waterdmg)` per tick (Standard: `0.4`, low HP `0.05` below `33.3%`). Hydro/Underwater engine (`waterproof: true`) takes **0** water damage.
     - Water entry/exit triggers `sndsplashm`/`sndsplashl` and `splashM`/`watertrail` particles.
   - **Space (`y < spacelevel` = `-1300`):**
     - `envSpaceFactor` ramps by `engine.spaceacceleration`; pushes `vy += engine.spaceforce` downward; applies `(health/maxHealth < spacelowhpperc ? spacedmglowhp : spacedmg)` per tick (waterproof engine takes `0.6`/`0.6` space damage).

### 2.2 Health Regeneration & Fire Discipline
- **Invariant:** Health regenerates by `+body.healingspd` per tick (Standard `0.16`, Bomb `0.12`, Apex Omega `0.01`) **ONLY** when `!input.fire` and `fireCooldown <= 0` (brief post-fire delay of 12 ticks before repair sparks `fx_repair` & `sndheal` engage).
- Firing even 1 tick immediately halts regeneration (`healing = false`, resets heal delay). Reaching `100%` HP plays `sndhealed`.

### 2.3 Weapons & Body Specials
| Part Slot | Stats / Behavior |
|---|---|
| Weapon `0` (Standard) | `bullet`: interval `3`, dmg `4`, speed `24`, ttl `60`, random spread `±3°` |
| Weapon `1` (Beam/Laser) | `laser`: interval `1`, dmg `1`/tick, piercing continuous ray (`520px` length), `1/3` turn rate while firing |
| Weapon `2` (Scatter/Spread) | `spreadbullet`: interval `9`, `5` pellets fanned across `spread: 6.0°` step, dmg `2`, speed `20`, ttl `40`, recoil `1.5` |
| Weapon `3` (Seeker/Missiles) | `missile`: interval `5`, **max `4` active**, dmg `6`, initial speed `4` accelerating to `14` while homing onto nearest enemy, ttl `40`; firing at cap plays `sndmisempty` |
| Weapon `4` (Plasma/Cannon) | `plasmaball`: interval `79`, dmg `20` direct + `80px` AOE detonation (`explode-on-destroy`), speed `10`, ttl `60`; plays `sndcannonreload` when ready |
| Body `2` (Ram/Melee) | `maxhealth: 11`, `impactrecvdmgmult: 0`, `impactsleeptime: 0`, `impactcamshake: 0`, `meleedmg: 0` self-damage; rams enemies for lethal impact damage |
| Body `3` (Nova/Nuke) | `flags: 'nuke-on-death'`, `impactdmgmult: 0.25`; on death triggers expanding `420px` radial blast wiping enemies on screen, playing `sndnuke` & `nukesprites` |
| Body `4` (Ordnance/Bomb) | `flags: 'body-drop-bomb'`, `healingspd: 0.12`; while firing/boosting drops gravity-assisted ordnance (`projectile_bomb`, dmg `16`, AOE `48px`) every `24` ticks |
| Body `1` (Bulwark/Armor) | `maxhealth: 28`, `speedmodifier: 0.8` |
| `APEX OMEGA` (`[5,5,5]`) | `maxhealth: 120`, `healingspd: 0.01`, apex silhouette sprite, fires triple spread + heavy beams + nuke blast |

### 2.4 Hitstop, Combo & Scoring
- Colliding with an enemy applies `impactsleeptime` hitstop freeze frames (`10` ticks default, `0` for `melee` body) and `impactcamshake` (`2` default, `0` for `melee`).
- Killing an enemy increments `combo = min(20, combo + 1)` and resets `comboTimer = 180` ticks (`3.0s`). When `comboTimer < 60` (`1.0s`), `comboWarning = true` and `sndcombowarn` cues; hitting `0` resets `combo = 1` and plays `sndcombodrop`. Reaching `x20` plays `sndmaxcombo`.
- Score awarded = `enemy.scoreValue * combo`. Enemy base scores: Fighter `20`, Jet `40`, Boat `50`, BigBoat `250`, Submarine `300`, Ace `150`, LaserAce `300`, AceMarine `600`, Blimp `1000`.

### 2.5 Enemy AI, Spawn Director & 90 Missions
- Enemy stats loaded from `enemies` (Normal) and `enemiesSfmt` (SFMT/Overdrive — SFMT `jet` fires with `fireinterval: 5`, `bigboat` fires `36`-bullet salvos at interval `1`, `spawnCoordinatorSfmt` adds `+50` difficulty burst step up to `700`).
- Spawn coordinator tracks `difficulty` (starts at `initialDifficulty: 60`), increments every `60` ticks using `increaseDifficulty` steps where `difficulty < step.max`, picks active tier from `spawnlist`, enforces `maxPercentageBoats (0.5)`, `maxNumAcePerDifficultyPerc (0.002)`, `maxNumBlimpsPerDifficultyPerc (0.001)`, upgrades Ace -> LaserAce at `0.016667`, and upgrades Submarine -> AceMarine at `0.3333333333` after `>= 1` submarine kill.
- **90 Missions:** Each mission has `component: [cat, part, idx]` (`cat`: `0=weapon, 1=body, 2=engine`; `part: 0..5`; `idx: 0..4`), `objective` (`0=kill, 1=survive/variety, 2=score, 3=streak, 4=combo, 5=bombKill, 6=blimpClean, 7=underwaterKill`), `condition` (`0=any, 1=maxCombo, 2=hovering, 3=continuousFire, 4=meleeRam, 5=singleShotOrAoe, 6=stalling, 7=lowHp, 8=boosting, 9=gungine, 11=nuke, 12=singleGame, 13=sfmt`), and `val: [targetCount, enemyTypeId]`. Up to 3 active missions (one per equipped Weapon, Body, Engine) are tracked live; completing missions unlocks new parts and palettes.

---

## 3. WebGL2 `600x400` Pipeline & Shader Contract (`src/render/`, `src/ui/`)

### 3.1 Palette Index Semantics
Greyscale luminance `r` in `[0..255]` maps via `idx = int(diffuse.r * 8.0)`:
- `0`: transparent (`discard`)
- `1`: Player aircraft silhouette (darkest foreground tone)
- `2`: Enemy aircraft, boats, enemy bullet core (dark mid-silhouette)
- `3`: Water reflection tone for `[1, 2]`
- `4`: Distant background props (`bg_boat`, `bg_blimp`)
- `5`: Player bullet core / exhaust highlights / cockpit accents
- `6`: Midground parallax clouds (`parallax_clouds`) & reflection of `[5, 7]`
- `7`: Foreground clouds, explosions, `ocean_line`, `space_clouds`, bullet glow, and shrinking Health Circle exterior
- `uniform_backcol`: Sky/water base fill

### 3.2 `post.shader` Exact Uniforms & Equations (GLSL ES 3.00)
- Offscreen FBO `default` (`600x400`, `RGBA8` + depth, `NEAREST`) and FBO `combo` (`600x400`, `RGBA8` + depth, `NEAREST`).
- World space -> clip space orthographic projection spanning `[camX - 300, camX + 300]` x `[camY - 200, camY + 200]` (`-Y` up).
- `pixelPosition = cameraWorldPosition.xy - ndcPos.xy * vec2(-300.0, 200.0)`.
- **Quantized 2x2 Health Circle:**
  ```glsl
  vec2 p = playerPosition.xy - pixelPosition;
  p = floor(p * 0.5) * 2.0;
  float distanceToPlayer = length(p) / 350.0;
  float healthAmount = healthRadius.x / healthRadius.y;
  if (healthAmount > 0.99) healthAmount = 1000.0;
  ```
- **Water Reflection Remap (`seaExpr = texCoords.y + (cameraYViewSpace - 0.5) > 0.0`):**
  - `[1] -> [3]`, `[2] -> [3]`, `[4] -> backcol`, `[5] -> [6]`, `[6] -> backcol`, `[7] -> [6]`.
- **Health Ring Output:** When `finalColor.a == 0.0 && healthAmount < distanceToPlayer && seaExpr < 0.0`: output `healthRadius.z < 1.0 ? uniform_colors[7] : uniform_colors[6]`; else `uniform_backcol`.
- **Letterboxed `outpass`:** Aspect ratio `targetAr = 400.0 / 600.0`, `ar = viewport.y / viewport.x`, sampled with `gl.NEAREST` (zero blur).
- **Live Vault Reload (`reloadVault(vault)`):** Deletes prior GPU atlas/font textures, uploads new vault textures on the active WebGL2 context, drains GL errors (`GLERR: 0`), and preserves active FBOs, palette, camera, and shader FX.

### 3.3 Unlockable 8-Color Palettes (12 Original Skybreaker Palettes)
1. `original` ("SKYBREAKER" — crisp sunlit sand-sky `#d6c39c`, deep charcoal-navy player `#162030`, crimson-rust enemies `#8c2630`, hot gold player fire `#ffe066`, ivory clouds/blasts `#f7f3e3`)
2. `inverted` ("INVERTED" — negative high-contrast inversion)
3. `classic` ("CLASSIC" — crisp black/white/sepia monochrome)
4. `gameboy` ("GB POCKET" — 4-step olive green monochrome)
5. `virtual` ("RED ALERT" — crimson/black terminal)
6. `oceanic` ("DEEP SEA" — Prussian blue/cyan/ice)
7. `synthdusk` ("SYNTH DUSK" — dark violet/magenta/gold)
8. `sunset` ("DUSK" — amber/orange/charcoal)
9. `amber` ("CRT AMBER" — phosphor amber terminal)
10. `overdrive` ("OVERDRIVE" — razor high-contrast crimson/obsidian/white, unlocked with SFMT/Overdrive)
11. `noir` ("NOIR" — monochrome silver-screen film)
12. `toxic` ("TOXIC" — industrial acid-green night ops)

### 3.4 Hangar 7-Row Layout (`600x400`)
- Rows: `['weapon', 'body', 'engine', 'palette', 'assets', 'mode', 'launch']`.
- The `ASSETS` row displays `SKYBREAKER` (default), `STEAM LOCAL` (when toggled on), or `SKYBREAKER [STEAM N/A]` (when local Steam vault is not detected, playing `snddeny` on cycle attempts). Pressing `V` in Hangar provides an immediate shortcut for toggling the asset pack.

---

## 4. Phase-Locked 3-Stem Web Audio Contract (`src/audio/`)

- Modular 3-stem combat matrix mapped from equipped loadout `(weapon, body, engine)` (`0..4`), plus critical HP alarm (`health / maxHealth < 0.333333`), `hangar`, `pause`, partial secret (`???`), and apex (`[5,5,5]`) states.
- In `skybreaker` mode, synthesizes punchy original multi-voice Web Audio synth stems & SFX; in optional `steam-local` mode, decodes read-only local `.ogg`/`.wav` assets.
- All active looping `AudioBufferSourceNode`s start at the exact shared `epochTime = ctx.currentTime + 0.02` (or offset `(ctx.currentTime - epochTime) % loopDuration` when swapped mid-song) so measured `interStemDriftMs < 1.0`.
- Calling `AudioEngine.init(nextVault)` at runtime cleanly swaps between synth and local Steam audio banks while preserving an already-unlocked `AudioContext` and `< 1.0ms` inter-stem drift.
- Off-screen SFX (`Math.abs(worldX - listenerX) > 300`) automatically route to `*dist` variants where available with clamped `StereoPannerNode` pan `[-0.85, +0.85]` and distance attenuation.

---

## 5. Acceptance Tolerances

- **Numeric Physics & Tuning Parity:** Exact numeric match across all 6 Engines, 6 Bodies, 6 Weapons, 126 loadout slots, 12 Enemy configs (Normal + SFMT), 6 Projectiles, SpawnCoordinator (Normal + SFMT), and 90 Missions.
- **Determinism:** Two runs with identical seed + inputs match bit-for-bit across 3,600 ticks (`60s`).
- **Audio Sync:** `interStemDriftMs < 1.0` across normal playback and live vault hot-swaps.
- **Rendering & Frame Pacing:** `600x400` `NEAREST` FBO, `0` WebGL errors (including across live `reloadVault`), `0` console errors, sustained `fps >= 58`, `p95FrameDeltaMs <= 18ms`.
- **Clean-Room & IP Hygiene:** Zero proprietary media files in `git ls-files` or `git status`, AND zero leaked trademark/verbatim strings (`luftrauser`, `urauser`, `kozilek`, `equiped`, `bob raus`, `unhealthy boeing`) in default data, palettes, renderer chrome, mod packs, `index.html`, or `package.json`.
