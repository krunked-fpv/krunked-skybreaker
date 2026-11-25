import type { SimSnapshot } from './sim';
import type { VaultAssetBundle } from './vault';

export type AudioCueId =
  | 'sndacespawn'
  | 'sndacespawndist'
  | 'sndadd1'
  | 'sndadd2'
  | 'sndadd3'
  | 'sndboatdie'
  | 'sndboost'
  | 'sndbullet'
  | 'sndcannon'
  | 'sndcannonexplo'
  | 'sndcannonfail'
  | 'sndcannonreload'
  | 'sndcombodrop'
  | 'sndcombowarn'
  | 'snddeny'
  | 'sndebullet'
  | 'sndebullet2'
  | 'sndebullet2dist'
  | 'sndebulletdist'
  | 'sndexplom'
  | 'sndgungine'
  | 'sndhangar'
  | 'sndheal'
  | 'sndhealed'
  | 'sndhit1'
  | 'sndhit2'
  | 'sndhit3'
  | 'sndhit4'
  | 'sndjetdie'
  | 'sndlaser'
  | 'sndlaunch'
  | 'sndmaxcombo'
  | 'sndmessage'
  | 'sndmisempty'
  | 'sndmissile'
  | 'sndmisspawn'
  | 'sndmisspawndist'
  | 'sndmove'
  | 'sndnuke'
  | 'sndplanedie'
  | 'sndplayerdie'
  | 'sndplayerhit'
  | 'sndpopup'
  | 'sndprojector'
  | 'sndprojectorstart'
  | 'sndsfmt'
  | 'sndsplashl'
  | 'sndsplashm'
  | 'sndspread'
  | 'sndswap'
  | 'snduboost'
  | 'sndunboost';

export type MusicState = 'hangar' | 'combat' | 'pause' | 'unknown' | 'urauser';

export interface AudioSyncMetrics {
  unlocked: boolean;
  source: 'steam-ogg' | 'synth-fallback';
  musicState: MusicState;
  activeStems: string[];
  epochTime: number;
  contextTime: number;
  interStemDriftMs: number;
  alarmActive: boolean;
  sfxPoolActive: number;
  muted: boolean;
}

export interface IAudioEngine {
  init(vault: VaultAssetBundle): Promise<void>;
  unlock(): Promise<void>;
  syncFromSnapshot(snapshot: SimSnapshot): void;
  playSfx(
    cue: AudioCueId,
    worldX?: number,
    listenerX?: number,
    volume?: number,
  ): void;
  setMuted(muted: boolean): void;
  getSyncMetrics(): AudioSyncMetrics;
  dispose(): void;
}
