import type {
  AudioCueId,
  AudioSyncMetrics,
  IAudioEngine,
  MusicState,
} from '../contracts/audio';
import type { SimAudioEvent, SimSnapshot } from '../contracts/sim';
import type { AudioAssetManifest, VaultAssetBundle } from '../contracts/vault';
import {
  computePhaseOffset,
  resolveActiveStems,
  resolveSpatialSfx,
} from './stem-matrix';
import { synthesizeMusicStem, synthesizeSfxCue } from './synth-fallback';

const DEFAULT_FADE_DURATION_SEC = 0.04;
const DEFAULT_EPOCH_LEAD_SEC = 0.02;
const DEFAULT_MAX_SFX_VOICES = 24;
const DEFAULT_SFX_COOLDOWN_MS = 25;

export interface AudioEngineOptions {
  context?: AudioContext;
  createContext?: () => AudioContext;
  fetchFn?: typeof fetch;
  fadeDurationSec?: number;
  maxSfxVoices?: number;
  sfxCooldownMs?: number;
}

interface ActiveStemNode {
  stemId: string;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  startTime: number;
  startOffset: number;
  duration: number;
}

interface FadingStemNode {
  stemId: string;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  stopTime: number;
}

interface ActiveSfxVoice {
  cue: AudioCueId;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  pannerNode: StereoPannerNode | null;
  endTime: number;
}

function resolveDefaultAudioContextConstructor():
  | (new () => AudioContext)
  | null {
  const g = globalThis as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function isNativeAudioContextInstance(ctx: AudioContext): boolean {
  const nativeCtor = (globalThis as { AudioContext?: unknown }).AudioContext;
  return typeof nativeCtor === 'function' && ctx instanceof (nativeCtor as new () => AudioContext);
}

function safeSetParam(param: AudioParam | undefined, value: number, time: number): void {
  if (!param) return;
  if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(value, time);
  }
  param.value = value;
}

function safeRampParam(
  param: AudioParam | undefined,
  startValue: number,
  endValue: number,
  startTime: number,
  endTime: number,
): void {
  if (!param) return;
  if (typeof param.cancelScheduledValues === 'function') {
    param.cancelScheduledValues(startTime);
  }
  if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(startValue, startTime);
  }
  if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(endValue, endTime);
  } else {
    param.value = endValue;
  }
}

function safeDisconnect(node: { disconnect?: () => void } | null | undefined): void {
  if (!node || typeof node.disconnect !== 'function') return;
  try {
    node.disconnect();
  } catch {
    // Ignore already disconnected nodes
  }
}

function safeStop(
  source: AudioBufferSourceNode | null | undefined,
  when?: number,
): void {
  if (!source || typeof source.stop !== 'function') return;
  try {
    if (when !== undefined) {
      source.stop(when);
    } else {
      source.stop();
    }
  } catch {
    // Ignore if node was never started or already stopped
  }
}

/**
 * Sample-accurate Web Audio 3-stem mixer and spatial SFX engine.
 * Never uses HTMLAudioElement loops; all music stems share a single AudioContext
 * master epoch for < 1ms inter-stem phase drift.
 */
export class AudioEngine implements IAudioEngine {
  private readonly options: AudioEngineOptions;
  private readonly fadeDurationSec: number;
  private readonly maxSfxVoices: number;
  private readonly sfxCooldownSec: number;

  private ctx: AudioContext | null = null;
  private ownsContext = false;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  private unlocked = false;
  private muted = false;
  private disposed = false;
  private initGeneration = 0;

  private epochTime = 0;
  private startedEpoch = false;

  private currentMusicState: MusicState = 'hangar';
  private currentAlarmActive = false;
  private pendingStemIds: string[] = [];

  private readonly bgmBuffers = new Map<string, AudioBuffer>();
  private readonly sfxBuffers = new Map<AudioCueId, AudioBuffer>();
  private readonly steamBgmIds = new Set<string>();
  private readonly steamSfxIds = new Set<AudioCueId>();

  private readonly activeStems = new Map<string, ActiveStemNode>();
  private readonly fadingOutStems: FadingStemNode[] = [];
  private readonly activeSfxVoices: ActiveSfxVoice[] = [];
  private readonly lastCuePlayTime = new Map<AudioCueId, number>();
  private lastAudioEventsRef: readonly SimAudioEvent[] | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.options = options;
    this.fadeDurationSec =
      options.fadeDurationSec ?? DEFAULT_FADE_DURATION_SEC;
    this.maxSfxVoices = options.maxSfxVoices ?? DEFAULT_MAX_SFX_VOICES;
    this.sfxCooldownSec =
      (options.sfxCooldownMs ?? DEFAULT_SFX_COOLDOWN_MS) / 1000;
  }

  async init(vault: VaultAssetBundle): Promise<void> {
    if (this.disposed) {
      this.disposed = false;
    }

    const generation = ++this.initGeneration;
    const wasUnlocked = this.unlocked;

    // Tear down active nodes & cached buffers while preserving a live AudioContext
    // so live Hangar hot-swaps (SKYBREAKER <-> STEAM LOCAL) never lose unlocked playback.
    this.teardownAudioGraph(false);

    const ctx =
      this.ctx && this.ctx.state !== 'closed'
        ? this.ctx
        : this.acquireAudioContext();
    this.ctx = ctx;
    if (!ctx) {
      this.unlocked = false;
      return;
    }

    this.buildRoutingGraph(ctx);
    if (
      wasUnlocked &&
      ctx.state === 'suspended' &&
      typeof ctx.resume === 'function'
    ) {
      try {
        await ctx.resume();
      } catch {
        // Check final context state below.
      }
      if (generation !== this.initGeneration || this.disposed || this.ctx !== ctx) {
        return;
      }
    }

    const currentState: AudioContextState = (this.ctx ?? ctx).state;
    if (currentState === 'running') {
      this.unlocked = true;
    } else if (
      wasUnlocked &&
      !isNativeAudioContextInstance(ctx) &&
      currentState !== 'closed'
    ) {
      this.unlocked = true;
    } else {
      this.unlocked = false;
    }

    // Pre-warm hangar stem so initial transition is instant even before Steam decode finishes.
    this.getOrCreateStemBuffer('luftrauser__hangar');

    // Immediately resume phase-locked music on hot-swap so there is zero dead air
    // while optional Steam OGG stems decode asynchronously.
    if (this.unlocked && this.pendingStemIds.length > 0) {
      this.applyActiveStems(this.pendingStemIds);
    }

    if (vault.audioManifest.source === 'steam-local') {
      await this.loadSteamManifest(vault.audioManifest, generation);
    }

    if (generation !== this.initGeneration || this.disposed) {
      return;
    }

    if (this.unlocked && this.pendingStemIds.length > 0) {
      this.applyActiveStems(this.pendingStemIds);
    }
  }

  async unlock(): Promise<void> {
    if (this.disposed || !this.ctx) {
      return;
    }

    if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      try {
        await this.ctx.resume();
      } catch {
        this.unlocked = false;
        return;
      }
    }

    if (this.disposed || !this.ctx) {
      return;
    }

    const nativeCtx = isNativeAudioContextInstance(this.ctx);
    if (nativeCtx) {
      this.unlocked = this.ctx.state === 'running';
    } else {
      this.unlocked = this.ctx.state !== 'closed';
    }

    if (!this.unlocked) {
      return;
    }

    if (!this.startedEpoch) {
      this.epochTime = this.ctx.currentTime + DEFAULT_EPOCH_LEAD_SEC;
      this.startedEpoch = true;
    }

    if (this.pendingStemIds.length > 0) {
      this.applyActiveStems(this.pendingStemIds);
    }
  }

  syncFromSnapshot(snapshot: SimSnapshot): void {
    if (this.disposed) {
      return;
    }

    const isCoop2p = snapshot.activeMods?.multiplayerMode === 'coop2p';
    const healthSource =
      isCoop2p && !snapshot.player.alive && snapshot.player2?.alive
        ? snapshot.player2
        : snapshot.player;

    const maxHp = healthSource.maxHealth;
    const healthRatio =
      Number.isFinite(maxHp) && maxHp > 0 ? healthSource.health / maxHp : 1;

    const resolution = resolveActiveStems(
      snapshot.phase,
      snapshot.paused,
      healthSource.loadout,
      healthRatio,
    );

    this.currentMusicState = resolution.musicState;
    this.currentAlarmActive = resolution.alarmActive;
    this.pendingStemIds = resolution.stems;

    if (this.ctx && this.unlocked) {
      this.applyActiveStems(resolution.stems);
    }

    if (snapshot.audioEvents !== this.lastAudioEventsRef) {
      this.lastAudioEventsRef = snapshot.audioEvents;
      const listenerX = Number.isFinite(snapshot.cameraTargetX)
        ? snapshot.cameraTargetX
        : snapshot.player.x;
      for (const ev of snapshot.audioEvents) {
        this.playSfxWithPitch(ev.cue, ev.x, listenerX, ev.volume, ev.pitch);
      }
    }
  }

  playSfx(
    cue: AudioCueId,
    worldX?: number,
    listenerX?: number,
    volume = 1,
  ): void {
    this.playSfxWithPitch(cue, worldX, listenerX, volume, 1);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      safeSetParam(this.masterGain.gain, muted ? 0 : 1, this.ctx.currentTime);
    }
  }

  getSyncMetrics(): AudioSyncMetrics {
    this.pruneFinishedSfxVoices();
    const activeStemNames =
      this.activeStems.size > 0
        ? Array.from(this.activeStems.keys())
        : [...this.pendingStemIds];

    return {
      unlocked: this.unlocked,
      source: this.steamBgmIds.size > 0 ? 'steam-ogg' : 'synth-fallback',
      musicState: this.currentMusicState,
      activeStems: activeStemNames,
      epochTime: this.epochTime,
      contextTime: this.ctx ? this.ctx.currentTime : 0,
      interStemDriftMs: this.computeInterStemDriftMs(),
      alarmActive: this.currentAlarmActive,
      sfxPoolActive: this.activeSfxVoices.length,
      muted: this.muted,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.initGeneration++;
    this.teardownAudioGraph(true);
    this.pendingStemIds = [];
    this.lastAudioEventsRef = null;
    this.unlocked = false;
  }

  private playSfxWithPitch(
    cue: AudioCueId,
    worldX?: number,
    listenerX?: number,
    volume = 1,
    pitch = 1,
  ): void {
    if (
      this.disposed ||
      !this.ctx ||
      !this.sfxBus ||
      !this.unlocked ||
      this.muted
    ) {
      return;
    }

    const { resolvedCue, pan, gain } = resolveSpatialSfx(cue, worldX, listenerX);
    const now = this.ctx.currentTime;
    const lastPlayed = this.lastCuePlayTime.get(resolvedCue);
    if (
      lastPlayed !== undefined &&
      now - lastPlayed >= 0 &&
      now - lastPlayed < this.sfxCooldownSec
    ) {
      return;
    }

    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(2, volume)) : 1;
    const finalGain = gain * safeVolume;
    if (finalGain <= 0.001) {
      return;
    }

    const buffer = this.getOrCreateSfxBuffer(resolvedCue);
    if (!buffer) {
      return;
    }

    this.pruneFinishedSfxVoices();
    while (this.activeSfxVoices.length >= this.maxSfxVoices) {
      const oldest = this.activeSfxVoices.shift();
      if (oldest) {
        safeStop(oldest.source);
        safeDisconnect(oldest.source);
        safeDisconnect(oldest.gainNode);
        safeDisconnect(oldest.pannerNode);
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;

    const safePitch =
      Number.isFinite(pitch) && pitch > 0.1 && pitch <= 4 ? pitch : 1;
    if (safePitch !== 1 && source.playbackRate) {
      source.playbackRate.value = safePitch;
    }

    const gainNode = this.ctx.createGain();
    safeSetParam(gainNode.gain, finalGain, now);

    const pannerNode =
      typeof this.ctx.createStereoPanner === 'function'
        ? this.ctx.createStereoPanner()
        : null;

    if (pannerNode) {
      safeSetParam(pannerNode.pan, pan, now);
      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(this.sfxBus);
    } else {
      source.connect(gainNode);
      gainNode.connect(this.sfxBus);
    }

    const voice: ActiveSfxVoice = {
      cue: resolvedCue,
      source,
      gainNode,
      pannerNode,
      endTime: now + buffer.duration / safePitch,
    };

    source.onended = () => {
      const idx = this.activeSfxVoices.indexOf(voice);
      if (idx >= 0) {
        this.activeSfxVoices.splice(idx, 1);
      }
      safeDisconnect(source);
      safeDisconnect(gainNode);
      safeDisconnect(pannerNode);
    };

    this.activeSfxVoices.push(voice);
    this.lastCuePlayTime.set(resolvedCue, now);
    source.start(now);
  }

  private acquireAudioContext(): AudioContext | null {
    if (this.options.context) {
      this.ownsContext = false;
      return this.options.context;
    }
    if (this.options.createContext) {
      this.ownsContext = true;
      return this.options.createContext();
    }
    const Ctor = resolveDefaultAudioContextConstructor();
    if (!Ctor) {
      this.ownsContext = false;
      return null;
    }
    this.ownsContext = true;
    return new Ctor();
  }

  private buildRoutingGraph(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    safeSetParam(masterGain.gain, this.muted ? 0 : 1, now);
    masterGain.connect(ctx.destination);

    let destinationForBuses: AudioNode = masterGain;
    let compressor: DynamicsCompressorNode | null = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      compressor = ctx.createDynamicsCompressor();
      safeSetParam(compressor.threshold, -12, now);
      safeSetParam(compressor.knee, 12, now);
      safeSetParam(compressor.ratio, 4, now);
      safeSetParam(compressor.attack, 0.003, now);
      safeSetParam(compressor.release, 0.15, now);
      compressor.connect(masterGain);
      destinationForBuses = compressor;
    }

    const musicBus = ctx.createGain();
    safeSetParam(musicBus.gain, 0.72, now);
    musicBus.connect(destinationForBuses);

    const sfxBus = ctx.createGain();
    safeSetParam(sfxBus.gain, 0.9, now);
    sfxBus.connect(destinationForBuses);

    this.masterGain = masterGain;
    this.compressor = compressor;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
  }

  private teardownAudioGraph(closeContext = true): void {
    for (const stem of this.activeStems.values()) {
      safeStop(stem.source);
      safeDisconnect(stem.source);
      safeDisconnect(stem.gainNode);
    }
    this.activeStems.clear();

    for (const fading of this.fadingOutStems) {
      safeStop(fading.source);
      safeDisconnect(fading.source);
      safeDisconnect(fading.gainNode);
    }
    this.fadingOutStems.length = 0;

    for (const voice of this.activeSfxVoices) {
      safeStop(voice.source);
      safeDisconnect(voice.source);
      safeDisconnect(voice.gainNode);
      safeDisconnect(voice.pannerNode);
    }
    this.activeSfxVoices.length = 0;
    this.lastCuePlayTime.clear();

    safeDisconnect(this.musicBus);
    safeDisconnect(this.sfxBus);
    safeDisconnect(this.compressor);
    safeDisconnect(this.masterGain);

    this.musicBus = null;
    this.sfxBus = null;
    this.compressor = null;
    this.masterGain = null;

    if (closeContext) {
      if (
        this.ctx &&
        this.ownsContext &&
        this.ctx.state !== 'closed' &&
        typeof this.ctx.close === 'function'
      ) {
        void this.ctx.close().catch(() => {});
      }
      this.ctx = null;
      this.ownsContext = false;
    } else if (this.ctx && this.ctx.state === 'closed') {
      this.ctx = null;
      this.ownsContext = false;
    }

    this.startedEpoch = false;
    this.epochTime = 0;

    this.bgmBuffers.clear();
    this.sfxBuffers.clear();
    this.steamBgmIds.clear();
    this.steamSfxIds.clear();
  }

  private async loadSteamManifest(
    manifest: AudioAssetManifest,
    generation: number,
  ): Promise<void> {
    const fetchImpl =
      this.options.fetchFn ??
      (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (!fetchImpl || !this.ctx) {
      return;
    }

    const tasks: Promise<void>[] = [];

    for (const [stemId, url] of Object.entries(manifest.bgm)) {
      if (!url) continue;
      tasks.push(
        this.fetchAndDecodeBuffer(fetchImpl, url, generation).then((decoded) => {
          if (decoded && generation === this.initGeneration && !this.disposed) {
            this.bgmBuffers.set(stemId, decoded);
            this.steamBgmIds.add(stemId);
            if (this.unlocked && this.activeStems.has(stemId)) {
              this.replaceActiveStem(stemId, decoded);
            }
          }
        }),
      );
    }

    for (const [cueKey, url] of Object.entries(manifest.sfx)) {
      if (!url) continue;
      const cueId = cueKey as AudioCueId;
      tasks.push(
        this.fetchAndDecodeBuffer(fetchImpl, url, generation).then((decoded) => {
          if (decoded && generation === this.initGeneration && !this.disposed) {
            this.sfxBuffers.set(cueId, decoded);
            this.steamSfxIds.add(cueId);
          }
        }),
      );
    }

    await Promise.allSettled(tasks);
  }

  private async fetchAndDecodeBuffer(
    fetchImpl: typeof fetch,
    url: string,
    generation: number,
  ): Promise<AudioBuffer | null> {
    try {
      const response = await fetchImpl(url);
      if (!response.ok || generation !== this.initGeneration || !this.ctx || this.disposed) {
        return null;
      }
      const raw = await response.arrayBuffer();
      if (generation !== this.initGeneration || !this.ctx || this.disposed) {
        return null;
      }
      const decoded = await this.ctx.decodeAudioData(raw);
      if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  private getOrCreateStemBuffer(stemId: string): AudioBuffer | null {
    const existing = this.bgmBuffers.get(stemId);
    if (existing) {
      return existing;
    }
    if (!this.ctx) {
      return null;
    }
    const synthesized = synthesizeMusicStem(this.ctx, stemId);
    this.bgmBuffers.set(stemId, synthesized);
    return synthesized;
  }

  private getOrCreateSfxBuffer(cue: AudioCueId): AudioBuffer | null {
    const existing = this.sfxBuffers.get(cue);
    if (existing) {
      return existing;
    }
    if (!this.ctx) {
      return null;
    }
    const synthesized = synthesizeSfxCue(this.ctx, cue);
    this.sfxBuffers.set(cue, synthesized);
    return synthesized;
  }

  private applyActiveStems(targetStemIds: readonly string[]): void {
    if (!this.ctx || !this.musicBus) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pruneFadingStems(now);

    if (!this.startedEpoch) {
      this.epochTime = now + DEFAULT_EPOCH_LEAD_SEC;
      this.startedEpoch = true;
    }

    const desiredSet = new Set(targetStemIds);

    // Quick path: exact stem set already active
    if (desiredSet.size === this.activeStems.size) {
      let identical = true;
      for (const stemId of desiredSet) {
        if (!this.activeStems.has(stemId)) {
          identical = false;
          break;
        }
      }
      if (identical) {
        return;
      }
    }

    // Fade out stems leaving the active set
    for (const [stemId, entry] of Array.from(this.activeStems.entries())) {
      if (desiredSet.has(stemId)) {
        continue;
      }
      this.fadeOutActiveStem(stemId, entry, now);
    }

    // Start stems entering the active set, phase-locked to master epochTime
    for (const stemId of desiredSet) {
      if (this.activeStems.has(stemId)) {
        continue;
      }
      const buffer = this.getOrCreateStemBuffer(stemId);
      if (!buffer || buffer.duration <= 0) {
        continue;
      }
      this.startActiveStem(stemId, buffer, now);
    }
  }

  private replaceActiveStem(stemId: string, newBuffer: AudioBuffer): void {
    if (!this.ctx || !this.musicBus || newBuffer.duration <= 0) {
      return;
    }
    const existing = this.activeStems.get(stemId);
    if (!existing) {
      return;
    }
    const now = this.ctx.currentTime;
    this.fadeOutActiveStem(stemId, existing, now);
    this.startActiveStem(stemId, newBuffer, now);
  }

  private fadeOutActiveStem(
    stemId: string,
    entry: ActiveStemNode,
    now: number,
  ): void {
    if (now < entry.startTime) {
      safeStop(entry.source);
      safeDisconnect(entry.source);
      safeDisconnect(entry.gainNode);
      this.activeStems.delete(stemId);
      return;
    }
    const fadeProgress =
      this.fadeDurationSec > 0 && now > entry.startTime
        ? Math.min(1, (now - entry.startTime) / this.fadeDurationSec)
        : now >= entry.startTime
          ? 1
          : 0;
    const rawGain = entry.gainNode.gain?.value;
    const currentGain =
      typeof rawGain === 'number' && rawGain > 0 ? Math.min(1, rawGain) : fadeProgress;
    const fadeEnd = now + this.fadeDurationSec;
    safeRampParam(entry.gainNode.gain, currentGain, 0, now, fadeEnd);
    const stopTime = fadeEnd + 0.005;
    safeStop(entry.source, stopTime);
    this.fadingOutStems.push({
      stemId,
      source: entry.source,
      gainNode: entry.gainNode,
      stopTime,
    });
    this.activeStems.delete(stemId);
  }

  private startActiveStem(
    stemId: string,
    buffer: AudioBuffer,
    now: number,
  ): void {
    if (!this.ctx || !this.musicBus) {
      return;
    }
    const startTime = Math.max(now, this.epochTime);
    const startOffset = computePhaseOffset(
      startTime,
      this.epochTime,
      buffer.duration,
    );

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = this.ctx.createGain();
    if (
      startTime > now &&
      gainNode.gain &&
      typeof gainNode.gain.setValueAtTime === 'function'
    ) {
      gainNode.gain.setValueAtTime(0, now);
    }
    safeRampParam(
      gainNode.gain,
      0,
      1,
      startTime,
      startTime + this.fadeDurationSec,
    );

    source.connect(gainNode);
    gainNode.connect(this.musicBus);
    source.start(startTime, startOffset);

    this.activeStems.set(stemId, {
      stemId,
      source,
      gainNode,
      startTime,
      startOffset,
      duration: buffer.duration,
    });
  }

  private pruneFadingStems(now: number): void {
    for (let i = this.fadingOutStems.length - 1; i >= 0; i--) {
      const entry = this.fadingOutStems[i];
      if (!entry) continue;
      if (now >= entry.stopTime) {
        safeDisconnect(entry.source);
        safeDisconnect(entry.gainNode);
        this.fadingOutStems.splice(i, 1);
      }
    }
  }

  private pruneFinishedSfxVoices(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = this.activeSfxVoices.length - 1; i >= 0; i--) {
      const voice = this.activeSfxVoices[i];
      if (!voice) continue;
      if (now >= voice.endTime) {
        safeDisconnect(voice.source);
        safeDisconnect(voice.gainNode);
        safeDisconnect(voice.pannerNode);
        this.activeSfxVoices.splice(i, 1);
      }
    }
  }

  private computeInterStemDriftMs(): number {
    if (!this.ctx || !this.startedEpoch || this.activeStems.size === 0) {
      return 0;
    }

    const now = this.ctx.currentTime;
    let maxDriftMs = 0;

    const phasesByDuration = new Map<
      number,
      Array<{ phase: number; duration: number }>
    >();

    for (const entry of this.activeStems.values()) {
      if (entry.duration <= 0) continue;

      const evalTime = Math.max(now, entry.startTime);
      const actualPhase = computePhaseOffset(
        entry.startOffset + (evalTime - entry.startTime),
        0,
        entry.duration,
      );
      const expectedPhase = computePhaseOffset(
        evalTime,
        this.epochTime,
        entry.duration,
      );
      const rawDiff = Math.abs(actualPhase - expectedPhase);
      const wrappedDiff = Math.min(rawDiff, entry.duration - rawDiff);
      const driftMs = wrappedDiff * 1000;
      if (driftMs > maxDriftMs) {
        maxDriftMs = driftMs;
      }

      const durKey = Math.round(entry.duration * 1_000_000);
      let list = phasesByDuration.get(durKey);
      if (!list) {
        list = [];
        phasesByDuration.set(durKey, list);
      }
      list.push({ phase: actualPhase, duration: entry.duration });
    }

    for (const group of phasesByDuration.values()) {
      if (group.length < 2) continue;
      const first = group[0];
      if (!first) continue;
      for (let i = 1; i < group.length; i++) {
        const other = group[i];
        if (!other) continue;
        const rawDiff = Math.abs(other.phase - first.phase);
        const wrappedDiff = Math.min(rawDiff, first.duration - rawDiff);
        const driftMs = wrappedDiff * 1000;
        if (driftMs > maxDriftMs) {
          maxDriftMs = driftMs;
        }
      }
    }

    return maxDriftMs;
  }
}
