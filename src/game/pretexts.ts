/**
 * Order pretexts (명분) — historically grounded reasons a Joseon customer
 * would buy a given volume of tteok flour. Small orders feed a household;
 * sack-scale orders always name a banquet, rite, or guild affair so the
 * quantity never feels arbitrary. Weights follow the 근/냥 reckoning in
 * metrology.ts (1되 ≈ 1.2근).
 */
import { HOP_PER_SEOM, HOP_PER_MAL, formatWeight } from './metrology';

export interface Pretext {
  /** Test predicate on the order volume. */
  when: (targetHop: number) => boolean;
  lines: Array<(label: string, weight: string) => string>;
}

const FEAST: Pretext = {
  when: (h) => h >= HOP_PER_SEOM,
  lines: [
    (l, w) =>
      `사흘 뒤 우리 집 어른 회갑잔치라네! 손님이 예순은 넘어. 찰떡 ${l}(${w})어치, 한 푼도 모자라면 안 되네!`,
    (l, w) =>
      `종갓집 제사가 닷새 앞이야! 차례상에 올릴 찰떡 ${l}(${w}), 정히 담아 주게!`,
    (l, w) =>
      `마을 동제(洞祭)가 코앞일세! 신주단지 앞에 바칠 떡이 ${l}… 저울로 치면 ${w}쯤 되겠군. 어서!`,
    (l, w) =>
      `상갓집 조문객 상이 열 두 상이라네! 찰떡 ${l}(${w})어치, 장사꾼 밥줄이 달렸으니 잘 좀 합시다!`,
  ],
};

const GUILD: Pretext = {
  when: (h) => h >= 10 * HOP_PER_MAL, // 10말 이상
  lines: [
    (l, w) =>
      `역마(驛馬) 나르는 행랑식구들 주전부리야! 들고 다녀야 하니 찰떡 ${l}, ${w}쯤 되겠네. 부탁하네!`,
    (l, w) =>
      `관아 포졸들 단속 순라 도시락이라네! 찰떡 ${l}(${w}), 오늘 자시 전까지 맞춰야 하네!`,
    (l, w) =>
      `병조 행랑에 납품하는 군량 부식일세! 찰떡 ${l} — 무게로 ${w}. 어깨춤 나게 정히 담아 주게!`,
  ],
};

const HOUSEHOLD: Pretext = {
  when: () => true,
  lines: [
    (l, w) =>
      `우리 애 돌잔치가 모레라네! 백일떡처럼 소복이 쌓을 찰떡 ${l}(${w})면 되겠어!`,
    (l, w) =>
      `새색시 시집살이 첫 시제라네… 시어른 입맛 까다로우셔. 찰떡 ${l}(${w}), 정히 부탁하네.`,
    (l, w) =>
      `기와집 이사 조객(弔客)이 아니라 조객(招客)이 몰려든다네! 답례 찰떡 ${l}(${w})어치 주시오!`,
    (l, w) =>
      `우리 집 장독 곁들일 간식거리야. 식구 여덟이니 찰떡 ${l} — 저울에 올리면 ${w}쯤이겠지?`,
  ],
};

const PRETEXTS = [FEAST, GUILD, HOUSEHOLD];

/**
 * Pick a pretext line for an order. Banquet/guild volumes always explain
 * where the tteok is going; household orders carry a small errand.
 */
export function pretextFor(
  targetHop: number,
  label: string,
  rng: () => number = Math.random
): string {
  const group = PRETEXTS.find((p) => p.when(targetHop)) ?? HOUSEHOLD;
  const weight = formatWeight(targetHop);
  const line = group.lines[Math.floor(rng() * group.lines.length)];
  return line(label, weight);
}
