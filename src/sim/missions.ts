import type { GameMode, Loadout, MissionProgressState, PartIndex, PilotProfile } from '../contracts/sim';
import type { EnemyKind, MissionSpec } from '../contracts/vault';

export type KillSource =
  | 'bullet'
  | 'laser'
  | 'spread'
  | 'missile'
  | 'cannon'
  | 'bomb'
  | 'gungine'
  | 'melee'
  | 'nuke'
  | 'other';

export interface KillMissionContext {
  enemyKind: EnemyKind;
  killSource: KillSource;
  combo: number;
  comboKillStreak: number;
  underwater: boolean;
  boosting: boolean;
  firing: boolean;
  healthRatio: number;
  stalling: boolean;
  mode: GameMode;
  continuousFireTicks: number;
  aoeOrMultiKill: boolean;
  lastPlayerHitTick: number;
  currentTick: number;
  distinctKindsThisSortie: ReadonlySet<EnemyKind>;
}

const ENEMY_TYPE_MAP: Record<number, EnemyKind | null> = {
  0: null,
  1: 'Fighter',
  2: 'Boat',
  3: 'Jet',
  4: 'BigBoat',
  5: 'Ace',
  6: 'LaserAce',
  7: 'Submarine',
  8: 'AceMarine',
  9: 'Blimp',
};

const PART_UNLOCK_THRESHOLDS: readonly [number, PartIndex][] = [
  [1, 1],
  [3, 2],
  [6, 3],
  [10, 4],
  [15, 5],
];

function isSingleSortieMission(m: MissionSpec): boolean {
  return (
    m.condition === 12 ||
    m.objective === 1 ||
    m.objective === 2 ||
    m.objective === 3 ||
    m.objective === 4
  );
}

function matchesEnemyType(valEnemyId: number, kind: EnemyKind): boolean {
  const expected = ENEMY_TYPE_MAP[valEnemyId] ?? null;
  return expected === null || expected === kind;
}

function matchesCondition(cond: number, ctx: KillMissionContext): boolean {
  switch (cond) {
    case 0:
    case 12:
      return true;
    case 1:
      return ctx.combo >= 20;
    case 2:
      return !ctx.boosting;
    case 3:
      return ctx.firing && ctx.continuousFireTicks >= 30;
    case 4:
      return ctx.killSource === 'melee';
    case 5:
      return (
        ctx.killSource === 'cannon' ||
        ctx.killSource === 'bomb' ||
        ctx.killSource === 'nuke' ||
        ctx.aoeOrMultiKill
      );
    case 6:
      return ctx.stalling;
    case 7:
      return ctx.healthRatio < 0.333333;
    case 8:
      return ctx.boosting;
    case 9:
      return ctx.killSource === 'gungine';
    case 11:
      return ctx.killSource === 'nuke';
    case 13:
      return ctx.mode === 'sfmt';
    default:
      return true;
  }
}

export class MissionTracker {
  private readonly missions: readonly MissionSpec[];
  private readonly missionById = new Map<number, MissionSpec>();
  private progress: Record<number, MissionProgressState> = {};
  private activeMissions: MissionSpec[] = [];
  private completedThisSortie: number[] = [];

  constructor(missions: readonly MissionSpec[], profile: PilotProfile) {
    this.missions = missions;
    for (const m of missions) {
      this.missionById.set(m.id, m);
    }
    this.syncFromProfile(profile);
    this.refreshActiveMissions(profile.lastLoadout, profile);
  }

  syncFromProfile(profile: PilotProfile): void {
    const completedSet = new Set(profile.completedMissions);
    const nextProgress: Record<number, MissionProgressState> = {};
    for (const m of this.missions) {
      const prev = this.progress[m.id];
      const target = Math.max(1, m.val[0] ?? 1);
      const completed = completedSet.has(m.id);
      nextProgress[m.id] = {
        missionId: m.id,
        completed,
        current: completed ? target : prev && !prev.completed ? Math.min(prev.current, target) : 0,
        target,
      };
    }
    this.progress = nextProgress;
  }

  startSortie(loadout: Loadout, profile: PilotProfile): void {
    this.completedThisSortie = [];
    const completedSet = new Set(profile.completedMissions);
    for (const m of this.missions) {
      const state = this.progress[m.id];
      if (!state) continue;
      if (completedSet.has(m.id)) {
        state.completed = true;
        state.current = state.target;
      } else if (isSingleSortieMission(m)) {
        state.current = 0;
      }
    }
    this.refreshActiveMissions(loadout, profile);
  }

  refreshActiveMissions(loadout: Loadout, profile: PilotProfile): void {
    const completedSet = new Set(profile.completedMissions);
    const slots: [number, number][] = [
      [0, loadout.weapon],
      [1, loadout.body],
      [2, loadout.engine],
    ];
    const active: MissionSpec[] = [];
    for (const [cat, part] of slots) {
      const candidates = this.missions
        .filter((m) => m.component[0] === cat && m.component[1] === part)
        .sort((a, b) => a.component[2] - b.component[2]);
      const next = candidates.find((m) => !completedSet.has(m.id));
      if (next) {
        active.push(next);
      }
    }
    this.activeMissions = active;
    profile.activeMissionIds = active.map((m) => m.id);
  }

  onKill(ctx: KillMissionContext, loadout: Loadout, profile: PilotProfile): number[] {
    const newlyCompleted: number[] = [];

    for (const m of [...this.activeMissions]) {
      const st = this.progress[m.id];
      if (!st || st.completed) continue;

      let updated = false;
      switch (m.objective) {
        case 0: {
          if (matchesEnemyType(m.val[1] ?? 0, ctx.enemyKind) && matchesCondition(m.condition, ctx)) {
            st.current = Math.min(st.target, st.current + 1);
            updated = true;
          }
          break;
        }
        case 1: {
          st.current = Math.min(st.target, Math.max(st.current, ctx.distinctKindsThisSortie.size));
          updated = true;
          break;
        }
        case 3: {
          st.current = Math.min(st.target, Math.max(st.current, ctx.comboKillStreak));
          updated = true;
          break;
        }
        case 5: {
          if (ctx.killSource === 'bomb' && matchesEnemyType(m.val[1] ?? 0, ctx.enemyKind)) {
            st.current = Math.min(st.target, st.current + 1);
            updated = true;
          }
          break;
        }
        case 6: {
          if (
            ctx.enemyKind === 'Blimp' &&
            (ctx.lastPlayerHitTick < 0 || ctx.currentTick - ctx.lastPlayerHitTick > 180)
          ) {
            st.current = Math.min(st.target, st.current + 1);
            updated = true;
          }
          break;
        }
        case 7: {
          if (ctx.underwater && matchesEnemyType(m.val[1] ?? 0, ctx.enemyKind)) {
            st.current = Math.min(st.target, st.current + 1);
            updated = true;
          }
          break;
        }
        default:
          break;
      }

      if (updated && st.current >= st.target) {
        this.completeMission(m, st, profile, newlyCompleted);
      }
    }

    if (newlyCompleted.length > 0) {
      this.refreshActiveMissions(loadout, profile);
    }
    return newlyCompleted;
  }

  onScoreAndCombo(
    score: number,
    combo: number,
    loadout: Loadout,
    profile: PilotProfile,
  ): number[] {
    const newlyCompleted: number[] = [];

    for (const m of [...this.activeMissions]) {
      const st = this.progress[m.id];
      if (!st || st.completed) continue;

      let updated = false;
      if (m.objective === 2) {
        if (score > st.current) {
          st.current = Math.min(st.target, score);
          updated = true;
        }
      } else if (m.objective === 4) {
        if (combo > st.current) {
          st.current = Math.min(st.target, combo);
          updated = true;
        }
      }

      if (updated && st.current >= st.target) {
        this.completeMission(m, st, profile, newlyCompleted);
      }
    }

    if (newlyCompleted.length > 0) {
      this.refreshActiveMissions(loadout, profile);
    }
    return newlyCompleted;
  }

  private completeMission(
    m: MissionSpec,
    st: MissionProgressState,
    profile: PilotProfile,
    newlyCompleted: number[],
  ): void {
    st.completed = true;
    st.current = st.target;
    if (!profile.completedMissions.includes(m.id)) {
      profile.completedMissions.push(m.id);
    }
    if (!this.completedThisSortie.includes(m.id)) {
      this.completedThisSortie.push(m.id);
    }
    newlyCompleted.push(m.id);
    this.evaluateUnlocks(profile);
  }

  evaluateUnlocks(profile: PilotProfile): void {
    const completedSet = new Set(profile.completedMissions);
    const countsByCat = [0, 0, 0];
    for (const id of completedSet) {
      const m = this.missionById.get(id);
      if (!m) continue;
      const cat = m.component[0];
      if (cat === 0 || cat === 1 || cat === 2) {
        countsByCat[cat] = (countsByCat[cat] ?? 0) + 1;
      }
    }

    const applyCatUnlocks = (targetList: PartIndex[], completedInCat: number): void => {
      if (!targetList.includes(0)) targetList.push(0);
      for (const [req, part] of PART_UNLOCK_THRESHOLDS) {
        if (completedInCat >= req && !targetList.includes(part)) {
          targetList.push(part);
        }
      }
      targetList.sort((a, b) => a - b);
    };

    applyCatUnlocks(profile.unlockedWeapons, countsByCat[0] ?? 0);
    applyCatUnlocks(profile.unlockedBodies, countsByCat[1] ?? 0);
    applyCatUnlocks(profile.unlockedEngines, countsByCat[2] ?? 0);

    const hasAllStandard =
      [0, 1, 2, 3, 4].every((p) => profile.unlockedWeapons.includes(p as PartIndex)) &&
      [0, 1, 2, 3, 4].every((p) => profile.unlockedBodies.includes(p as PartIndex)) &&
      [0, 1, 2, 3, 4].every((p) => profile.unlockedEngines.includes(p as PartIndex));

    if (
      completedSet.size >= 15 ||
      (profile.totalKills['Blimp'] ?? 0) > 0 ||
      hasAllStandard
    ) {
      profile.sfmtUnlocked = true;
    }
  }

  getActiveMissions(): readonly MissionSpec[] {
    return this.activeMissions;
  }

  getCompletedThisSortie(): readonly number[] {
    return this.completedThisSortie;
  }

  getProgressSnapshot(): Record<number, MissionProgressState> {
    const copy: Record<number, MissionProgressState> = {};
    for (const [k, v] of Object.entries(this.progress)) {
      copy[Number(k)] = { ...v };
    }
    return copy;
  }
}
