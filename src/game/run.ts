/**
 * Stage-based game loop. One stage = up to 20 customers; three failed
 * servings end the run. Clearing all 20 advances to a slightly harder
 * stage (shorter clock, faster two-bean introduction).
 */
import type { Grade } from './metrology';

export const STAGE_CUSTOMERS = 20;
export const MAX_FAILS = 3;
export const BASE_ROUND_SECONDS = 20;

export interface StageState {
  stage: number;
  /** Customers served so far in this stage (1-based once a round starts). */
  served: number;
  fails: number;
  /** Money earned during this run (all stages). */
  runScore: number;
}

export function createStageState(): StageState {
  return { stage: 1, served: 0, fails: 0, runScore: 0 };
}

/** Seconds on the clock for a stage: 20s → −1s per stage, floor 12s. */
export function roundSecondsFor(stage: number): number {
  return Math.max(12, BASE_ROUND_SECONDS - (stage - 1));
}

/** Round within the stage from which two-bean orders may appear. */
export function twoBeanFromRound(stage: number): number {
  return Math.max(2, 4 - (stage - 1));
}

/** Chance a two-bean order is drawn once unlocked. */
export function twoBeanChance(stage: number): number {
  return Math.min(0.8, 0.5 + (stage - 1) * 0.1);
}

/** Stage score multiplier. */
export function stageMultiplier(stage: number): number {
  return 1 + (stage - 1) * 0.15;
}

export type RunVerdict =
  | { kind: 'next'; state: StageState }
  | { kind: 'stageClear'; state: StageState }
  | { kind: 'gameOver'; state: StageState };

/** Fold one finished round into the run state. */
export function advanceRun(
  state: StageState,
  grade: Grade,
  earned: number,
  /** A visiting regular (단골) pardons the failure and counts as a pass. */
  pardonUsed: boolean
): RunVerdict {
  const served = state.served + 1;
  const failed = grade === 'fail' && !pardonUsed;
  const fails = state.fails + (failed ? 1 : 0);
  const runScore = state.runScore + earned;
  const next: StageState = { ...state, served, fails, runScore };
  if (fails >= MAX_FAILS) return { kind: 'gameOver', state: next };
  if (served >= STAGE_CUSTOMERS) {
    return {
      kind: 'stageClear',
      state: { stage: state.stage + 1, served: 0, fails: 0, runScore },
    };
  }
  return { kind: 'next', state: next };
}

/** Whether the current round's customer is a visiting regular. */
export function regularVisits(ownedCount: number, rng: () => number = Math.random): boolean {
  if (ownedCount <= 0) return false;
  return rng() < Math.min(0.1 + ownedCount * 0.1, 0.5);
}
