import { describe, expect, it } from 'vitest';
import {
  advanceRun,
  createStageState,
  roundSecondsFor,
  regularVisits,
  stageMultiplier,
  twoBeanChance,
  twoBeanFromRound,
  MAX_FAILS,
  STAGE_CUSTOMERS,
} from './run';

describe('stage loop', () => {
  it('caps rounds per stage at 20 and escalates difficulty', () => {
    expect(STAGE_CUSTOMERS).toBe(20);
    expect(roundSecondsFor(1)).toBe(20);
    expect(roundSecondsFor(5)).toBe(16);
    expect(roundSecondsFor(99)).toBe(12); // floor
    expect(twoBeanFromRound(1)).toBe(4);
    expect(twoBeanFromRound(3)).toBe(2);
    expect(stageMultiplier(1)).toBe(1);
    expect(stageMultiplier(3)).toBeCloseTo(1.3);
    expect(twoBeanChance(1)).toBe(0.5);
    expect(twoBeanChance(10)).toBe(0.8); // capped
  });

  it('ends the run after three fails', () => {
    let s = createStageState();
    for (let i = 0; i < 2; i++) {
      const v = advanceRun(s, 'fail', 0, false);
      expect(v.kind).toBe('next');
      s = v.state;
    }
    const v = advanceRun(s, 'fail', 0, false);
    expect(v.kind).toBe('gameOver');
    expect(v.state.fails).toBe(MAX_FAILS);
  });

  it('clears the stage after 20 customers and resets fails', () => {
    let s = createStageState();
    for (let i = 0; i < STAGE_CUSTOMERS - 1; i++) {
      const v = advanceRun(s, i % 10 === 0 ? 'fail' : 'success', 100, false);
      expect(v.kind).toBe('next');
      s = v.state;
    }
    expect(s.fails).toBe(2); // i = 0, 10
    const v = advanceRun(s, 'perfect', 200, false);
    expect(v.kind).toBe('stageClear');
    expect(v.state.stage).toBe(2);
    expect(v.state.served).toBe(0);
    expect(v.state.fails).toBe(0);
    expect(v.state.runScore).toBeGreaterThan(0);
  });

  it('regular pardon converts a fail into a pass', () => {
    const v = advanceRun(createStageState(), 'fail', 0, true);
    expect(v.state.fails).toBe(0);
    expect(v.kind).toBe('next');
  });

  it('regular visit chance scales with owned regulars and never fires with none', () => {
    expect(regularVisits(0, () => 0)).toBe(false);
    expect(regularVisits(1, () => 0.19)).toBe(true);
    expect(regularVisits(1, () => 0.21)).toBe(false);
    expect(regularVisits(3, () => 0.39)).toBe(true); // chance = 0.4
    expect(regularVisits(3, () => 0.41)).toBe(false);
    expect(regularVisits(9, () => 0.55)).toBe(false); // capped at 0.5
  });
});
