/**
 * Account & progression system. Browser-local only (localStorage) with
 * JSON backup/restore via the settings panel. No server involved.
 */

export type ArtbookId = 'artbook_1' | 'artbook_2' | 'artbook_3';
export type ArtifactId = 'sangaji' | 'jupan';

export interface Account {
  name: string;
  /** Lifetime earnings, in 전. Purchases subtract from this wallet. */
  money: number;
  totalEarned: number;
  roundsPlayed: number;
  ownedArtbooks: ArtbookId[];
  /** Which artbook illustration sets are applied to customers (empty = chibi). */
  activeArtbooks: ArtbookId[];
  artifacts: { sangaji: number; jupan: number };
  bestScore: number;
  /** Owned regular customers (단골). One visit pardons one failed serving. */
  regulars: RegularId[];
  /** Registered in the shared 명부 — scores go to the server ranking. */
  registered: boolean;
}

export const ARTBOOKS: Record<
  ArtbookId,
  {
    name: string;
    desc: string;
    /** Which customer archetypes this volume beautifies. */
    covers: string;
    price: number;
    texture: string;
    gallery: string[];
  }
> = {
  artbook_1: {
    name: '「청포도련님」 화첩',
    desc: '푸른 도포의 미소년 양반. 부채 끝에 봄바람이 맴돌더이다.',
    covers: '젊은 양반 손님과 노인·중년 손님이 미형으로 다시 찾아오네.',
    price: 9000,
    texture: 'assets/textures/artbook_1.png',
    gallery: [
      'assets/textures/artbook_1.png',
      'assets/textures/artbook_elder.png',
      'assets/textures/artbook_middle.png',
    ],
  },
  artbook_2: {
    name: '「연지곤지 아씨」 화첩',
    desc: '분홍 저고리의 미소녀 낭자. 웃으면 저잣거리가 환해지더이다.',
    covers: '젊은 낭자 손님과 할멈·중년 손님이 미형으로 다시 찾아오네.',
    price: 12000,
    texture: 'assets/textures/artbook_2.png',
    gallery: [
      'assets/textures/artbook_2.png',
      'assets/textures/artbook_granny.png',
      'assets/textures/artbook_middle.png',
    ],
  },
  artbook_3: {
    name: '「십리장터 객주」 화첩',
    desc: '냉소적인 미소년 보부상. 계산은 칼같이, 마음은…?',
    covers: '보부상 손님과 노인·할멈 손님이 미형으로 다시 찾아오네.',
    price: 15000,
    texture: 'assets/textures/artbook_3.png',
    gallery: [
      'assets/textures/artbook_3.png',
      'assets/textures/artbook_elder.png',
      'assets/textures/artbook_granny.png',
    ],
  },
};

/** Core customer index each volume maps to (matches scene.ts CUSTOMER_SETS). */
export const ARTBOOK_CORE_INDEX: Record<ArtbookId, number> = {
  artbook_1: 0,
  artbook_2: 1,
  artbook_3: 2,
};

export const ARTIFACTS: Record<
  ArtifactId,
  {
    name: string;
    desc: string;
    price: number;
    /** Uses granted per purchase. */
    usesPerBuy: number;
    /** Success probability of skipping one round's calculation. */
    successRate: number;
  }
> = {
  sangaji: {
    name: '산가지',
    desc: '셈을 대신해 주는 신비한 나뭇가지. 80% 확률로 계산 건너뛰기 성공.',
    price: 2500,
    usesPerBuy: 3,
    successRate: 0.8,
  },
  jupan: {
    name: '주판',
    desc: '주판알이 절로 튕기는 보물. 70% 확률로 계산 건너뛰기 성공.',
    price: 4000,
    usesPerBuy: 5,
    successRate: 0.7,
  },
};

// --- Regulars (단골) ----------------------------------------------------------
export type RegularId = 'banjangnim' | 'sunnim' | 'choesangaek';

export interface RegularDef {
  id: RegularId;
  name: string;
  desc: string;
  price: number;
}

export const REGULARS: RegularDef[] = [
  {
    id: 'banjangnim',
    name: '이모부 반장님',
    desc: '동네 사랑방 단골. 방문하면 잘못 준 떡 한 번을 허허실실 넘겨 주시네.',
    price: 6000,
  },
  {
    id: 'sunnim',
    name: '도승 스님',
    desc: '자비로운 큰스님. 실수를 \"인연의 한 조각\"이라며 웃어 넘기시네.',
    price: 8000,
  },
  {
    id: 'choesangaek',
    name: '최상객 행수',
    desc: '물정에 밝은 행수. 틀린 떡도 좋은 값에 되팔아 문제를 지워 주시네.',
    price: 12000,
  },
];

/** Buy a regular's loyalty; null if already owned or too poor. */
export function buyRegular(acc: Account, id: RegularId): Account | null {
  const item = REGULARS.find((r) => r.id === id);
  if (!item || acc.regulars.includes(id) || acc.money < item.price) return null;
  return {
    ...acc,
    money: acc.money - item.price,
    regulars: [...acc.regulars, id],
  };
}

const LS_KEY = 'tteok:account';
const GUEST_NAME = '나그네';

export function createGuest(): Account {
  return {
    name: GUEST_NAME,
    money: 0,
    totalEarned: 0,
    roundsPlayed: 0,
    ownedArtbooks: [],
    activeArtbooks: [],
    artifacts: { sangaji: 0, jupan: 0 },
    bestScore: 0,
    regulars: [],
    registered: false,
  };
}

/** Fold legacy single-artbook saves into the multi-apply field. */
function migrateArtbooks(raw: Record<string, unknown>, acc: Account): Account {
  if (Array.isArray(raw.activeArtbooks)) {
    return { ...acc, activeArtbooks: raw.activeArtbooks as ArtbookId[] };
  }
  const legacy = raw.activeArtbook;
  if (typeof legacy === 'string' && legacy in ARTBOOKS) {
    return { ...acc, activeArtbooks: [legacy as ArtbookId] };
  }
  return acc;
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Account> & Record<string, unknown>;
    const acc = migrateArtbooks(parsed, {
      ...createGuest(),
      ...parsed,
    } as Account);
    return acc.name === GUEST_NAME ? null : acc;
  } catch {
    return null;
  }
}

export function saveAccount(acc: Account): void {
  localStorage.setItem(LS_KEY, JSON.stringify(acc));
}

export function login(name: string, registered = false): Account {
  const trimmed = name.trim().slice(0, 12) || GUEST_NAME;
  const existing = loadAccount();
  const acc =
    existing && existing.name === trimmed
      ? { ...existing, registered: existing.registered || registered }
      : { ...createGuest(), name: trimmed, registered };
  saveAccount(acc);
  return acc;
}

export function logout(): void {
  localStorage.removeItem(LS_KEY);
}

/** Serialize for JSON backup download. */
export function exportAccount(acc: Account): string {
  return JSON.stringify({ version: 1, account: acc }, null, 2);
}

/** Parse an imported JSON backup; throws on malformed data. */
export function importAccount(json: string): Account {
  const parsed = JSON.parse(json) as { account?: Partial<Account> };
  const a = parsed.account;
  if (!a || typeof a.name !== 'string' || typeof a.money !== 'number') {
    throw new Error('계정 파일 형식이 올바르지 않습니다');
  }
  const base: Account = {
    ...createGuest(),
    ...a,
    name: a.name,
    money: a.money,
    ownedArtbooks: Array.isArray(a.ownedArtbooks) ? a.ownedArtbooks : [],
    artifacts: { ...createGuest().artifacts, ...(a.artifacts ?? {}) },
    regulars: Array.isArray(a.regulars) ? a.regulars : [],
  } as Account;
  const acc = migrateArtbooks(a as Record<string, unknown>, base);
  saveAccount(acc);
  return acc;
}

export function buyArtbook(acc: Account, id: ArtbookId): Account | null {
  const item = ARTBOOKS[id];
  if (acc.ownedArtbooks.includes(id) || acc.money < item.price) return null;
  return {
    ...acc,
    money: acc.money - item.price,
    ownedArtbooks: [...acc.ownedArtbooks, id],
  };
}

export function buyArtifact(acc: Account, id: ArtifactId): Account | null {
  const item = ARTIFACTS[id];
  if (acc.money < item.price) return null;
  return {
    ...acc,
    money: acc.money - item.price,
    artifacts: {
      ...acc.artifacts,
      [id]: acc.artifacts[id] + item.usesPerBuy,
    },
  };
}

/** Record round earnings; returns updated account. */
export function recordEarnings(acc: Account, earned: number): Account {
  return {
    ...acc,
    money: acc.money + earned,
    totalEarned: acc.totalEarned + Math.max(0, earned),
    roundsPlayed: acc.roundsPlayed + 1,
    bestScore: Math.max(acc.bestScore, acc.money + earned),
  };
}

/**
 * Spend one artifact charge for a calculation skip attempt.
 * Returns [newAccount, success]. Failing also consumes the charge —
 * the spirits are fickle.
 */
export function useArtifact(
  acc: Account,
  id: ArtifactId,
  rng: () => number = Math.random
): [Account, boolean] {
  if (acc.artifacts[id] <= 0) return [acc, false];
  const next = {
    ...acc,
    artifacts: { ...acc.artifacts, [id]: acc.artifacts[id] - 1 },
  };
  return [next, rng() < ARTIFACTS[id].successRate];
}
