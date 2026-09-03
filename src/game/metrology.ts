/**
 * Joseon Dynasty Volume Metrology Engine.
 *
 * All quantities are tracked internally in the base integer unit of 1 hop (홉).
 * The radices are historically strict:
 *   1 seom (섬) = 15 mal (말)   -- 15-radix roll-over, NOT 10
 *   1 mal  (말) = 10 doe (되)   -- 10-radix
 *   1 doe  (되) = 10 hop (홉)   -- 10-radix
 *
 * Therefore: 1 seom = 1500 hop, 1 mal = 100 hop, 1 doe = 10 hop.
 */

export const HOP_PER_DOE = 10;
export const DOE_PER_MAL = 10;
export const MAL_PER_SEOM = 15;
export const HOP_PER_MAL = HOP_PER_DOE * DOE_PER_MAL; // 100
export const HOP_PER_SEOM = HOP_PER_MAL * MAL_PER_SEOM; // 1500

/** A decomposed Joseon volume. */
export interface Volume {
  seom: number;
  mal: number;
  doe: number;
  hop: number;
}

/** Convert a decomposed volume into base hop units. */
export function toHop(v: Volume): number {
  return (
    v.seom * HOP_PER_SEOM +
    v.mal * HOP_PER_MAL +
    v.doe * HOP_PER_DOE +
    v.hop
  );
}

/**
 * Decompose a base hop amount into seom/mal/doe/hop using the strict
 * 15-radix and 10-radix roll-overs. Negative inputs clamp to zero.
 */
export function fromHop(totalHop: number): Volume {
  let rest = Math.max(0, Math.round(totalHop));
  const seom = Math.floor(rest / HOP_PER_SEOM);
  rest -= seom * HOP_PER_SEOM;
  const mal = Math.floor(rest / HOP_PER_MAL);
  rest -= mal * HOP_PER_MAL;
  const doe = Math.floor(rest / HOP_PER_DOE);
  const hop = rest - doe * HOP_PER_DOE;
  return { seom, mal, doe, hop };
}

const UNIT_LABELS: Array<[keyof Volume, string]> = [
  ['seom', '섬'],
  ['mal', '말'],
  ['doe', '되'],
  ['hop', '홉'],
];

/**
 * Format a hop amount as a Korean order string, e.g. "1섬 4말 2되".
 * Zero-valued units are omitted; zero total renders as "0홉".
 */
export function formatHop(totalHop: number): string {
  const v = fromHop(totalHop);
  const parts = UNIT_LABELS.filter(([k]) => v[k] > 0).map(
    ([k, label]) => `${v[k]}${label}`
  );
  return parts.length > 0 ? parts.join(' ') : '0홉';
}

/** Scoring tolerance bands (in hop). */
export const PERFECT_TOLERANCE_HOP = 2;
export const SUCCESS_TOLERANCE_HOP = 7;

export type Grade = 'perfect' | 'success' | 'fail';

/** Absolute error between target and poured amount, in hop. */
export function errorBetween(targetHop: number, currentHop: number): number {
  return Math.abs(targetHop - currentHop);
}

/** Grade an absolute error: 0~2 perfect, 3~7 success, 8+ fail. */
export function gradeForError(errorHop: number): Grade {
  if (errorHop <= PERFECT_TOLERANCE_HOP) return 'perfect';
  if (errorHop <= SUCCESS_TOLERANCE_HOP) return 'success';
  return 'fail';
}

/** Apply a pour delta, clamping so the basin never goes below zero. */
export function applyPour(currentHop: number, deltaHop: number): number {
  return Math.max(0, currentHop + deltaHop);
}

/** Score awarded for a round: closeness plus remaining-time bonus. */
export function scoreRound(
  grade: Grade,
  errorHop: number,
  secondsLeft: number
): number {
  const base =
    grade === 'perfect' ? 300 : grade === 'success' ? 150 : 0;
  const closeness = Math.max(0, 50 - errorHop * 5);
  const timeBonus = Math.max(0, Math.round(secondsLeft)) * 5;
  return grade === 'fail' ? 0 : base + closeness + timeBonus;
}

export type Bean = 'yellow' | 'black';

export interface OrderSpec {
  targetHop: number;
  label: string;
  /** Two-bean orders split the volume between yellow and black beans. */
  beans?: { bean: Bean; hop: number; label: string }[];
  /**
   * Historical weight reading for this volume of hulled soybeans
   * (되당 약 1.2근, 1근 = 600g — Joseon 근/냥 reckoning), e.g. "36근 4냥".
   */
  weightLabel: string;
}

// --- Historical weight reckoning -------------------------------------------
// 1 doe of hulled soybeans ≈ 1.2 geun (근). 1 geun = 600 g = 16 nyang (냥).
// So 1 doe ≈ 19.2 nyang; a hop ≈ 1.92 nyang ≈ 7.2 g.
export const NYANG_PER_GEUN = 16;
export const HOP_PER_GEUN_APPROX = 100 / 1.2; // ≈ 83.33 hop per geun

/**
 * Render a hop amount as Joseon market weight, rounded to the nearest nyang.
 * E.g. 1000 hop (1말) ≈ 12근, 47 hop ≈ 9냥.
 */
export function formatWeight(totalHop: number): string {
  const totalNyang = Math.round((totalHop * NYANG_PER_GEUN) / HOP_PER_GEUN_APPROX);
  const geun = Math.floor(totalNyang / NYANG_PER_GEUN);
  const nyang = totalNyang - geun * NYANG_PER_GEUN;
  if (geun > 0 && nyang > 0) return `${geun}근 ${nyang}냥`;
  if (geun > 0) return `${geun}근`;
  return `${Math.max(1, nyang)}냥`;
}

/**
 * Generate a random customer order. Mixes all four units so every vessel
 * stays relevant; 30% of orders include a hop-level remainder to demand
 * spoon work. Minimum 300 hop so orders never feel trivial.
 */
export function randomOrder(rng: () => number = Math.random): OrderSpec {
  for (let attempt = 0; attempt < 64; attempt++) {
    const seom = rng() < 0.45 ? 1 : 0;
    const mal = 1 + Math.floor(rng() * 14); // 1..14 (strictly below 15-radix)
    const doe = Math.floor(rng() * 10); // 0..9
    const hop = rng() < 0.3 ? 1 + Math.floor(rng() * 5) : 0; // 0 or 1..5
    const targetHop = toHop({ seom, mal, doe, hop });
    if (targetHop >= 300) {
      return { targetHop, label: formatHop(targetHop), weightLabel: formatWeight(targetHop) };
    }
  }
  // Fallback can only trigger on a pathological RNG; still valid.
  return { targetHop: 1500, label: formatHop(1500), weightLabel: formatWeight(1500) };
}

/**
 * Hard-mode order: the volume is stated in a single flat unit so the player
 * converts ONE radix step mentally — e.g. "40말" means 2섬 10말 (말→섬),
 * or "24되" means 2말 4되 (되→말). Two-step conversions like 159되→1섬 9되
 * are deliberately excluded: the player only ever jumps one unit level.
 */
export function randomHardOrder(rng: () => number = Math.random): OrderSpec {
  const flavor = rng();
  if (flavor < 0.6) {
    // Flat mal → 섬: 16..44 (always overflows the 15-radix boundary once).
    const mal = 16 + Math.floor(rng() * 29);
    const targetHop = mal * HOP_PER_MAL;
    return { targetHop, label: `${mal}말`, weightLabel: formatWeight(targetHop) };
  }
  // Flat doe → 말: 11..99, avoiding exact mal multiples (that would be
  // zero-step) — a single 말→섬 step is never required below 100 doe.
  for (let attempt = 0; attempt < 64; attempt++) {
    const doe = 11 + Math.floor(rng() * 89);
    if (doe % 10 === 0) continue;
    const targetHop = doe * HOP_PER_DOE;
    return { targetHop, label: `${doe}되`, weightLabel: formatWeight(targetHop) };
  }
  return { targetHop: 240, label: '24되', weightLabel: formatWeight(240) };
}

/**
 * Two-bean order (late-game): "누런 콩 X말, 검은 콩 Y되" style.
 * Each part is generated from the normal/hard generator and the label
 * is composed per bean. The combined target is their sum.
 */
export function randomTwoBeanOrder(
  rng: () => number = Math.random,
  hard = false
): OrderSpec {
  const gen = () => (hard ? randomHardOrder(rng) : randomOrder(rng));
  const yellow = gen();
  const black = gen();
  const beans: OrderSpec['beans'] = [
    { bean: 'yellow', hop: yellow.targetHop, label: yellow.label },
    { bean: 'black', hop: black.targetHop, label: black.label },
  ];
  return {
    targetHop: yellow.targetHop + black.targetHop,
    label: `누런 콩 ${yellow.label}, 검은 콩 ${black.label}`,
    beans,
    weightLabel: formatWeight(yellow.targetHop + black.targetHop),
  };
}

/** The four pouring vessels, their hop deltas, and bound SFX. */
export interface Vessel {
  id: 'seom' | 'mal' | 'doe' | 'hop';
  deltaHop: number;
  label: string;
  sub: string;
  sfx: 'thud_sack' | 'pour_grain' | 'clatter_wood' | 'coin_tick';
  shake: number;
}

export const VESSELS: Vessel[] = [
  { id: 'seom', deltaHop: HOP_PER_SEOM, label: '1섬 가마니', sub: '+1,500홉', sfx: 'thud_sack', shake: 1.0 },
  { id: 'mal', deltaHop: HOP_PER_MAL, label: '1말 바가지', sub: '+100홉', sfx: 'pour_grain', shake: 0.5 },
  { id: 'doe', deltaHop: HOP_PER_DOE, label: '1되 됫박', sub: '+10홉', sfx: 'clatter_wood', shake: 0.25 },
  { id: 'hop', deltaHop: 1, label: '1홉 숟가락', sub: '+1홉', sfx: 'coin_tick', shake: 0.08 },
];
