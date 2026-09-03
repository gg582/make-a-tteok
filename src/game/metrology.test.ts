import { describe, it, expect } from 'vitest';
import {
  HOP_PER_SEOM,
  HOP_PER_MAL,
  HOP_PER_DOE,
  MAL_PER_SEOM,
  toHop,
  fromHop,
  formatHop,
  errorBetween,
  gradeForError,
  applyPour,
  scoreRound,
  randomOrder,
  randomHardOrder,
  randomTwoBeanOrder,
  formatWeight,
  NYANG_PER_GEUN,
} from './metrology';
import { pretextFor } from './pretexts';

describe('Joseon metrology constants', () => {
  it('uses the strict historical 15-radix for seom->mal', () => {
    expect(MAL_PER_SEOM).toBe(15);
    expect(HOP_PER_SEOM).toBe(1500);
  });

  it('uses 10-radix for mal->doe and doe->hop', () => {
    expect(HOP_PER_MAL).toBe(100);
    expect(HOP_PER_DOE).toBe(10);
  });
});

describe('toHop', () => {
  it('converts 1 seom to exactly 1500 hop', () => {
    expect(toHop({ seom: 1, mal: 0, doe: 0, hop: 0 })).toBe(1500);
  });

  it('converts a mixed order "1섬 4말 2되" to 1920 hop', () => {
    expect(toHop({ seom: 1, mal: 4, doe: 2, hop: 0 })).toBe(1920);
  });

  it('sums all four units including hop remainder', () => {
    expect(toHop({ seom: 0, mal: 3, doe: 7, hop: 5 })).toBe(375);
  });
});

describe('fromHop (15-radix roll-over)', () => {
  it('rolls 15 mal over into exactly 1 seom', () => {
    expect(fromHop(15 * HOP_PER_MAL)).toEqual({ seom: 1, mal: 0, doe: 0, hop: 0 });
  });

  it('keeps 14 mal below the seom boundary', () => {
    expect(fromHop(14 * HOP_PER_MAL)).toEqual({ seom: 0, mal: 14, doe: 0, hop: 0 });
  });

  it('rolls 1499 hop into 14말 9되 9홉, never 15 mal', () => {
    expect(fromHop(1499)).toEqual({ seom: 0, mal: 14, doe: 9, hop: 9 });
  });

  it('rolls 10 doe into 1 mal and 10 hop into 1 doe', () => {
    expect(fromHop(100)).toEqual({ seom: 0, mal: 1, doe: 0, hop: 0 });
    expect(fromHop(10)).toEqual({ seom: 0, mal: 0, doe: 1, hop: 0 });
  });

  it('round-trips with toHop across the full radix range', () => {
    for (const n of [0, 1, 9, 10, 99, 100, 1499, 1500, 1501, 2345, 4499]) {
      expect(toHop(fromHop(n))).toBe(n);
    }
  });

  it('clamps negative input to zero', () => {
    expect(fromHop(-50)).toEqual({ seom: 0, mal: 0, doe: 0, hop: 0 });
  });
});

describe('formatHop', () => {
  it('formats the spec example "1섬 4말 2되"', () => {
    expect(formatHop(1920)).toBe('1섬 4말 2되');
  });

  it('omits zero units but keeps hop remainders', () => {
    expect(formatHop(305)).toBe('3말 5홉');
    expect(formatHop(1500)).toBe('1섬');
    expect(formatHop(0)).toBe('0홉');
  });
});

describe('error and grading boundaries', () => {
  it('computes absolute error in hop', () => {
    expect(errorBetween(1000, 1003)).toBe(3);
    expect(errorBetween(1000, 995)).toBe(5);
  });

  it('grades 0~2 hop error as perfect (inclusive boundaries)', () => {
    expect(gradeForError(0)).toBe('perfect');
    expect(gradeForError(2)).toBe('perfect');
  });

  it('grades 3~7 hop error as success (inclusive boundaries)', () => {
    expect(gradeForError(3)).toBe('success');
    expect(gradeForError(7)).toBe('success');
  });

  it('grades 8+ hop error as fail', () => {
    expect(gradeForError(8)).toBe('fail');
    expect(gradeForError(500)).toBe('fail');
  });
});

describe('applyPour', () => {
  it('adds and subtracts deltas', () => {
    expect(applyPour(100, 1500)).toBe(1600);
    expect(applyPour(1600, -100)).toBe(1500);
  });

  it('never lets the basin drop below zero when scooping out', () => {
    expect(applyPour(5, -1500)).toBe(0);
  });
});

describe('scoreRound', () => {
  it('awards zero points on failure regardless of time', () => {
    expect(scoreRound('fail', 20, 15)).toBe(0);
  });

  it('pays perfect rounds more than sloppy successes', () => {
    expect(scoreRound('perfect', 0, 10)).toBeGreaterThan(scoreRound('success', 7, 10));
  });

  it('adds a remaining-time bonus', () => {
    expect(scoreRound('perfect', 0, 12)).toBeGreaterThan(scoreRound('perfect', 0, 2));
  });
});

describe('randomHardOrder (mental-arithmetic mode)', () => {
  it('states orders as a single flat unit ("40말" style)', () => {
    for (let i = 0; i < 500; i++) {
      const { label } = randomHardOrder();
      expect(label).toMatch(/^(\d+)(말|되)$/);
    }
  });

  it('flat-mal orders overflow the 15-radix exactly one step (16..44말)', () => {
    for (let i = 0; i < 500; i++) {
      const { label, targetHop } = randomHardOrder();
      const n = parseInt(label, 10);
      if (label.endsWith('말')) {
        expect(n).toBeGreaterThanOrEqual(16);
        expect(n).toBeLessThanOrEqual(44);
        expect(targetHop).toBe(n * 100);
      }
    }
  });

  it('flat-doe orders stay below the seom boundary (one step only)', () => {
    for (let i = 0; i < 500; i++) {
      const { label, targetHop } = randomHardOrder();
      if (label.endsWith('되')) {
        const n = parseInt(label, 10);
        expect(n).toBeGreaterThanOrEqual(11);
        expect(n).toBeLessThanOrEqual(99); // < 100 doe ⇒ never needs 섬
        expect(n % 10).not.toBe(0); // exact mal multiples would be zero-step
        expect(targetHop).toBe(n * 10);
      }
    }
  });

  it('still decomposes correctly under the 15-radix engine', () => {
    // "40말" must equal 2섬 10말 — the single mental step the player does.
    expect(fromHop(40 * HOP_PER_MAL)).toEqual({ seom: 2, mal: 10, doe: 0, hop: 0 });
    expect(fromHop(24 * HOP_PER_DOE)).toEqual({ seom: 0, mal: 2, doe: 4, hop: 0 });
  });
});

describe('randomTwoBeanOrder', () => {
  it('splits the target into yellow + black bean parts summing exactly', () => {
    for (let i = 0; i < 300; i++) {
      const o = randomTwoBeanOrder();
      expect(o.beans).toHaveLength(2);
      const [y, b] = o.beans!;
      expect(y.bean).toBe('yellow');
      expect(b.bean).toBe('black');
      expect(y.hop + b.hop).toBe(o.targetHop);
      expect(o.label).toContain('누런 콩');
      expect(o.label).toContain('검은 콩');
    }
  });

  it('hard mode uses flat-unit labels for each bean', () => {
    for (let i = 0; i < 300; i++) {
      const o = randomTwoBeanOrder(Math.random, true);
      for (const part of o.beans!) {
        expect(part.label).toMatch(/^(\d+)(말|되)$/);
      }
    }
  });
});

describe('randomOrder', () => {
  it('never emits a mal count that violates the 15-radix', () => {
    for (let i = 0; i < 500; i++) {
      const { targetHop } = randomOrder();
      const v = fromHop(targetHop);
      expect(v.mal).toBeLessThan(15);
      expect(v.doe).toBeLessThan(10);
      expect(v.hop).toBeLessThan(10);
      expect(targetHop).toBeGreaterThanOrEqual(300);
      expect(targetHop).toBeLessThan(3000);
    }
  });

  it('is deterministic under a seeded rng', () => {
    let s = 42;
    const rng = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const a = randomOrder(rng);
    expect(a.label).toBe(formatHop(a.targetHop));
  });
});

describe('historical weight reckoning (근/냥)', () => {
  it('1말(100홉) of soybeans weighs ≈1.2근', () => {
    expect(formatWeight(100)).toBe('1근 3냥'); // 19.2 → 19냥
  });
  it('1섬(1500홉) weighs 18근', () => {
    expect(formatWeight(1500)).toBe('18근');
  });
  it('sub-geun amounts render in 냥 only', () => {
    expect(formatWeight(47)).toBe('9냥');
  });
  it('16냥 make a 근', () => {
    expect(NYANG_PER_GEUN).toBe(16);
  });
});

describe('order pretexts (명분)', () => {
  const rng = () => 0.1;
  it('sack-scale orders always cite a feast or rite with weight', () => {
    const line = pretextFor(1500, '1섬', rng);
    expect(line).toContain('1섬');
    expect(line).toContain('18근');
    expect(line.length).toBeGreaterThan(20);
  });
  it('guild-scale orders name an official errand', () => {
    const line = pretextFor(1200, '12말', () => 0.9);
    expect(line).toContain('12말');
    expect(line).toContain('근');
  });
  it('household orders still carry a reason and weight', () => {
    const line = pretextFor(400, '4말', rng);
    expect(line).toContain('4말');
    expect(line).toContain('4근');
  });
  it('every generated order carries a weight label', () => {
    expect(randomOrder(() => 0.42).weightLabel).toMatch(/근|냥/);
    expect(randomHardOrder(() => 0.1).weightLabel).toMatch(/근|냥/);
    expect(randomTwoBeanOrder(() => 0.3).weightLabel).toMatch(/근|냥/);
  });
});
