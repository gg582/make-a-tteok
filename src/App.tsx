/**
 * 평석의 달인: 한양 최고의 떡집 — game state machine + Korean HUD.
 * All in-game text is Korean; code/comments stay English per project policy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TteokScene } from './game/scene';
import { AudioDirector } from './game/audio';
import {
  VESSELS,
  applyPour,
  errorBetween,
  gradeForError,
  randomOrder,
  randomHardOrder,
  randomTwoBeanOrder,
  scoreRound,
  formatHop,
  type Bean,
  type Grade,
  type OrderSpec,
} from './game/metrology';
import {
  ARTBOOKS,
  ARTIFACTS,
  REGULARS,
  buyArtbook,
  buyArtifact,
  buyRegular,
  createGuest,
  exportAccount,
  importAccount,
  loadAccount,
  login,
  logout,
  recordEarnings,
  saveAccount,
  useArtifact,
  type Account,
  type ArtifactId,
  type RegularId,
} from './game/account';

import {
  advanceRun,
  createStageState,
  regularVisits,
  roundSecondsFor,
  stageMultiplier,
  twoBeanChance,
  twoBeanFromRound,
  MAX_FAILS,
  STAGE_CUSTOMERS,
  type StageState,
} from './game/run';
import { pretextFor } from './game/pretexts';

type Phase = 'menu' | 'playing' | 'result' | 'stageClear' | 'gameover';
type Panel = 'none' | 'settings' | 'shop' | 'gallery' | 'ranking';

const MAX_FILL_HOP = 3000;
const POUNDS_NEEDED = 3;

/** A leaderboard entry is one finished run, credited to its owner. */
interface BoardEntry {
  name: string;
  score: number;
  stage: number;
}

/** 잡화 a ranked shop carries — shown when its name is tapped. */
interface ShopGoods {
  artbooks: string[];
  artifacts: { sangaji: number; jupan: number };
  regulars: string[];
}

interface ServerEntry extends BoardEntry {
  goods: ShopGoods | null;
}

const ORDER_BARKS = [
  (label: string) => `어이! 찰떡 ${label}치 후딱 안 내오고 뭐 하쇼?!`,
  (label: string) => `주인장! 찰떡 ${label}, 어여 맞춰 내오시오!`,
  (label: string) => `배가 고파 죽겠네! 찰떡 ${label}치 어서 내놓으란 말이오!`,
  (label: string) => `흥! 소문이 자자하던데… 찰떡 ${label}, 한번 맞춰 보시오!`,
];

const HARD_BARKS = [
  (label: string) => `자네, 환산할 줄은 아나? 찰떡 ${label} 말이야! 헤헤.`,
  (label: string) => `양반네 집 잔치라네! 찰떡 ${label}! 암산 못하면 장사 접으시오!`,
  (label: string) => `이리 크게 시켜야 제맛이지! 찰떡 ${label}치, 틀리면 가만 안 둬!`,
];

const TWO_BEAN_BARKS = [
  (label: string) => `이봐! ${label}, 섞지 말고 따로따로 정히 담아 주게!`,
  (label: string) => `누런 콩 따로, 검은 콩 따로! ${label} — 한치도 틀리면 안 되네!`,
  (label: string) => `서리태가 들어가야 제맛이지! ${label}, 어서!`,
];

const RESULT_LINES: Record<Grade, string> = {
  perfect:
    '크으, 손맛 한번 기가 막히네! 잔돈 서 푼은 가질 것 없고, 주모한테 막걸리나 한 사발 받아 마시쇼!',
  success:
    '음, 조금 퍽퍽하긴 한데 요기하기엔 거칠 것 없겠군. 잔돈 딱 맞춰 내놓으쇼.',
  fail: '이놈의 방앗간 놈이 누굴 호구로 아나! 이게 떡이오, 흙덩이오?! 내 당장 종로 포도청에 고발할 테다!',
};

const SKIP_SUCCESS_LINE =
  '허허, 그 계산 내가 선비한테 물어보고 왔지. 틀림없구먼! 여기 푼전 더 얹어주겠네.';
const SKIP_FAIL_LINE =
  '흥! 산가지가 삐뚤어졌구먼. 셈도 못하면서 무슨 장사람 말이오?!';

const TIMEOUT_LINE =
  '뭐여? 시간이 다 됐는데 떡메질도 못 끝냈수? 장사를 하겠다는 게야, 놀겠다는 게야?!';

const PARDON_LINE =
  '허허, 이번엔 내 얼굴을 봐서 넘어가 주지. 우리 주인장 손맛이 원래 이렇지 않다네!';

const GRADE_TITLES: Record<Grade, string> = {
  perfect: '대성공!',
  success: '성공',
  fail: '대실패…',
};

const LS_BOARD = 'tteok:leaderboard';

function loadBoard(): BoardEntry[] {
  try {
    const raw = localStorage.getItem(LS_BOARD);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    // Old saves were plain number arrays from guest sessions — drop them so
    // guest scores never tangle with account holders' rankings.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is BoardEntry =>
        !!e &&
        typeof (e as BoardEntry).name === 'string' &&
        typeof (e as BoardEntry).score === 'number' &&
        typeof (e as BoardEntry).stage === 'number'
    );
  } catch {
    return [];
  }
}

/** Basins gauge scaling: two-bean and hard orders can exceed MAX_FILL_HOP. */
const fillMaxFor = (targetHop: number) => Math.max(MAX_FILL_HOP, targetHop * 1.3);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<TteokScene | null>(null);
  const audioRef = useRef<AudioDirector | null>(null);
  const initRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('menu');
  const [panel, setPanel] = useState<Panel>(
    // Dev/test hook: ?shop opens the 잡화점 for screenshots.
    typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('shop')
      ? 'shop'
      : 'none'
  );
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(loadAccount);
  const [order, setOrder] = useState<OrderSpec | null>(null);
  const [timeLeft, setTimeLeft] = useState(roundSecondsFor(1));
  const [scoopOut, setScoopOut] = useState(false);
  const [poundCount, setPoundCount] = useState(0);
  const [roundScore, setRoundScore] = useState(0);
  const [lastError, setLastError] = useState(0);
  const [grade, setGrade] = useState<Grade>('success');
  const [timedOut, setTimedOut] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [dialogue, setDialogue] = useState('');
  const [board, setBoard] = useState<BoardEntry[]>(loadBoard);
  const [serverBoard, setServerBoard] = useState<ServerEntry[]>([]);
  const [goodsView, setGoodsView] = useState<ServerEntry | null>(null);
  const [hardMode, setHardMode] = useState(false);
  const [activeBean, setActiveBean] = useState<Bean>('yellow');
  const [beanHop, setBeanHop] = useState<Record<Bean, number>>({
    yellow: 0,
    black: 0,
  });
  const [toast, setToast] = useState('');
  const [run, setRun] = useState<StageState>(createStageState);
  const [regularVisiting, setRegularVisiting] = useState<string | null>(null);
  const [pardoned, setPardoned] = useState(false);
  const [roundSeconds, setRoundSeconds] = useState(roundSecondsFor(1));

  const runRef = useRef(run);
  runRef.current = run;
  const regularVisitingRef = useRef(regularVisiting);
  regularVisitingRef.current = regularVisiting;
  const beanHopRef = useRef(beanHop);
  beanHopRef.current = beanHop;
  const activeBeanRef = useRef(activeBean);
  activeBeanRef.current = activeBean;
  const timeLeftRef = useRef(roundSecondsFor(1));
  const phaseRef = useRef<Phase>('menu');
  const orderRef = useRef<OrderSpec | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const hardModeRef = useRef(hardMode);
  hardModeRef.current = hardMode;
  phaseRef.current = phase;
  orderRef.current = order;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  // Pull the shared 명부 ranking (best effort — offline is fine).
  const fetchRanking = useCallback(() => {
    fetch('/api/ranking')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { ranking?: ServerEntry[] }) => {
        if (Array.isArray(data.ranking)) setServerBoard(data.ranking);
      })
      .catch(() => {});
  }, []);

  /** Post a finished run to the shared 명부 (registered shops only). */
  const submitRanking = useCallback(
    (acc: Account, runScore: number, stage: number) => {
      if (acc.name === '나그네' || !acc.registered || runScore <= 0) return;
      const goods: ShopGoods = {
        artbooks: acc.ownedArtbooks.map((id) => ARTBOOKS[id].name),
        artifacts: { ...acc.artifacts },
        regulars: acc.regulars.map(
          (id) => REGULARS.find((r) => r.id === id)?.name ?? id
        ),
      };
      fetch('/api/ranking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: acc.name, score: runScore, stage, goods }),
      })
        .then(() => fetchRanking())
        .catch(() => showToast('명부 서버에 닿지 않네… 다음에 다시 오를 걸세.'));
    },
    [fetchRanking, showToast]
  );

  useEffect(() => {
    if (phase === 'menu') fetchRanking();
  }, [phase, fetchRanking]);

  // --- Scene boot (once) -------------------------------------------------
  useEffect(() => {
    if (initRef.current || !canvasRef.current) return;
    initRef.current = true;
    const scene = new TteokScene(canvasRef.current);
    sceneRef.current = scene;
    scene
      .init()
      .then(() => {
        // Apply saved artbook preference after textures are loaded.
        if (accountRef.current?.activeArtbook) scene.setArtbookMode(true);
        // Dev/test hook: ?artbook forces illustration mode for screenshots.
        if (new URLSearchParams(window.location.search).has('artbook')) {
          scene.setArtbookMode(true);
        }
        // Dev/test hook: ?autostart skips the menu (no audio gesture needed).
        if (new URLSearchParams(window.location.search).has('autostart')) {
          startRoundRef.current();
        }
        // Dev/test hook: ?react=perfect|success|fail shows a verdict face.
        const reactParam = new URLSearchParams(window.location.search).get('react');
        if (reactParam === 'perfect' || reactParam === 'success' || reactParam === 'fail') {
          setTimeout(() => scene.react(reactParam), 1200);
        }
      })
      .catch((err) => {
        console.error(err);
        setSceneError(
          '이 브라우저에서는 3D 장마당을 열 수 없구려… (WebGPU/WebGL2 미지원)'
        );
      });
    audioRef.current = new AudioDirector();
  }, []);

  // --- Round flow ---------------------------------------------------------
  const startRound = useCallback(() => {
    const hard =
      hardModeRef.current ||
      new URLSearchParams(window.location.search).has('hard');
    const params = new URLSearchParams(window.location.search);
    const acc = accountRef.current;
    const cur = runRef.current;
    const roundNo = cur.served + 1;
    const twoBean = params.has('beans')
      ? true
      : roundNo >= twoBeanFromRound(cur.stage) &&
        Math.random() < twoBeanChance(cur.stage);

    let next: OrderSpec;
    if (twoBean) {
      next = randomTwoBeanOrder(Math.random, hard);
    } else {
      next = hard ? randomHardOrder() : randomOrder();
    }
    setOrder(next);
    setBeanHop({ yellow: 0, black: 0 });
    setActiveBean('yellow');
    sceneRef.current?.setPowderDark(false);
    sceneRef.current?.setMixRatio(0);
    const secs = roundSecondsFor(cur.stage);
    setRoundSeconds(secs);
    timeLeftRef.current = secs;
    setTimeLeft(secs);
    setScoopOut(false);
    setPoundCount(0);
    setTimedOut(false);
    setSkipped(false);
    setPardoned(false);
    // A regular (단골) may walk in — only for account holders who own one.
    // Guests never see them, so guest runs can't borrow account perks.
    let visiting: string | null = null;
    if (acc && acc.name !== '나그네' && regularVisits(acc.regulars.length)) {
      const owned = REGULARS.filter((r) => acc.regulars.includes(r.id));
      visiting = owned[Math.floor(Math.random() * owned.length)]?.name ?? null;
    }
    setRegularVisiting(visiting);
    sceneRef.current?.resetRound();
    sceneRef.current?.setFill(0.02);
    const barks = twoBean ? TWO_BEAN_BARKS : hard ? HARD_BARKS : ORDER_BARKS;
    const bark = barks[Math.floor(Math.random() * barks.length)];
    // Historical pretext: every order explains what the tteok is FOR and
    // names the 근/냥 weight, so a 1섬 order reads as a banquet errand.
    const pretext = pretextFor(next.targetHop, next.label);
    setDialogue(
      visiting ? `${visiting} 왔네! ${pretext}` : pretext || bark(next.label)
    );
    audioRef.current?.startBgm();
    audioRef.current?.setBgmUrgency(0);
    setPhase('playing');
  }, []);

  const finishRound = useCallback((wasTimeout: boolean, skipSuccess = false) => {
    if (phaseRef.current !== 'playing') return;
    const o = orderRef.current;
    const target = o?.targetHop ?? 0;
    let err: number;
    if (o?.beans) {
      err = o.beans.reduce(
        (sum, part) => sum + errorBetween(part.hop, beanHopRef.current[part.bean]),
        0
      );
    } else {
      err = errorBetween(target, beanHopRef.current.yellow);
    }
    let g: Grade = wasTimeout
      ? 'fail'
      : skipSuccess
        ? 'perfect'
        : gradeForError(err);
    // A visiting regular pardons a failed serving — it becomes a bare pass.
    const pardon = g === 'fail' && regularVisitingRef.current !== null;
    if (pardon) g = 'success';
    const hard = hardModeRef.current;
    const mult = (hard ? 1.5 : 1) * stageMultiplier(runRef.current.stage);
    const pts = Math.round(scoreRound(g, err, timeLeftRef.current) * mult);

    setRoundScore(pts);
    setLastError(err);
    setGrade(g);
    setTimedOut(wasTimeout);
    setSkipped(skipSuccess);
    setPardoned(pardon);
    setDialogue(
      pardon
        ? PARDON_LINE
        : wasTimeout
          ? TIMEOUT_LINE
          : skipSuccess
            ? SKIP_SUCCESS_LINE
            : RESULT_LINES[g]
    );

    sceneRef.current?.react(g);
    const audio = audioRef.current;
    if (audio) {
      audio.setBgmUrgency(0);
      if (g === 'perfect') audio.playSfx('coin_toss');
      if (g === 'fail') audio.playSfx('cauldron_flip', { volume: 0.9 });
    }

    // Accumulate earnings into the account (guests use a temp wallet only
    // for the session UI — nothing is persisted without login).
    setAccount((prev) => {
      const base = prev ?? createGuest();
      const next = recordEarnings(base, pts);
      if (prev) saveAccount(next); // only persist for logged-in accounts
      return next;
    });

    // Fold the round into the stage run.
    const verdict = advanceRun(runRef.current, g, pts, pardon);
    setRun(verdict.state);
    if (verdict.kind === 'stageClear') {
      window.setTimeout(() => setPhase('stageClear'), 1400);
    } else if (verdict.kind === 'gameOver') {
      // Only named accounts enter the leaderboard — guests never tangle
      // with account holders' rankings.
      const acc = accountRef.current;
      if (acc && acc.name !== '나그네' && verdict.state.runScore > 0) {
        setBoard((b) => {
          const entry: BoardEntry = {
            name: acc.name,
            score: verdict.state.runScore,
            stage: verdict.state.stage,
          };
          const next = [...b, entry].sort((a, bb) => bb.score - a.score).slice(0, 5);
          localStorage.setItem(LS_BOARD, JSON.stringify(next));
          return next;
        });
        // 명부-registered shops also send their run to the shared ranking.
        if (acc.registered) {
          submitRanking(acc, verdict.state.runScore, verdict.state.stage);
        }
      }
      window.setTimeout(() => setPhase('gameover'), 1400);
    }
    setPhase('result');
  }, [showToast, submitRanking]);

  const finishRef = useRef(finishRound);
  finishRef.current = finishRound;
  const startRoundRef = useRef(startRound);
  startRoundRef.current = startRound;

  // Round countdown.
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = window.setInterval(() => {
      timeLeftRef.current = Math.max(0, timeLeftRef.current - 0.1);
      setTimeLeft(timeLeftRef.current);
      audioRef.current?.setBgmUrgency(1 - timeLeftRef.current / roundSecondsFor(runRef.current.stage));
      if (timeLeftRef.current <= 0) {
        window.clearInterval(id);
        finishRef.current(true);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  // --- Input actions --------------------------------------------------------
  const handleStart = useCallback(async () => {
    const audio = audioRef.current;
    if (audio && !audio.isReady) {
      try {
        await audio.init();
      } catch (err) {
        console.warn('Audio unavailable', err);
      }
    }
    // A fresh run starts from stage 1.
    setRun(createStageState());
    setRegularVisiting(null);
    startRound();
  }, [startRound]);

  /** Continue into the next (harder) stage after a clear. */
  const handleNextStage = useCallback(() => {
    startRound();
  }, [startRound]);

  /** Back to the menu after a game over. */
  const handleEndRun = useCallback(() => {
    // Ending a run early (stage clear → 쉬기) still counts for the 명부.
    if (phaseRef.current === 'stageClear') {
      const acc = accountRef.current;
      if (acc) submitRanking(acc, runRef.current.runScore, runRef.current.stage);
    }
    setRun(createStageState());
    setRegularVisiting(null);
    setPhase('menu');
  }, [submitRanking]);

  const updateFill = useCallback((beans: Record<Bean, number>) => {
    const total = beans.yellow + beans.black;
    const fillMax = fillMaxFor(orderRef.current?.targetHop ?? 0);
    sceneRef.current?.setFill(total / fillMax);
    const target = orderRef.current?.targetHop ?? 1;
    sceneRef.current?.setMixRatio(beans.black / Math.max(1, target));
  }, []);

  const handlePour = useCallback(
    (index: number) => {
      if (phaseRef.current !== 'playing') return;
      const vessel = VESSELS[index];
      const delta = vessel.deltaHop * (scoopOut ? -1 : 1);
      const bean = orderRef.current?.beans ? activeBeanRef.current : 'yellow';
      setBeanHop((prev) => {
        const next = { ...prev, [bean]: applyPour(prev[bean], delta) };
        updateFill(next);
        return next;
      });
      sceneRef.current?.pour(vessel, scoopOut);
      audioRef.current?.playSfx(vessel.sfx, { volume: scoopOut ? 0.7 : 1 });
    },
    [scoopOut, updateFill]
  );

  const switchBean = useCallback((bean: Bean) => {
    setActiveBean(bean);
    sceneRef.current?.setPowderDark(bean === 'black');
  }, []);

  const handlePound = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    sceneRef.current?.pound();
    audioRef.current?.playSfx('mallet_strike');
    setPoundCount((n) => {
      const next = n + 1;
      if (next >= POUNDS_NEEDED) {
        window.setTimeout(() => finishRef.current(false), 350);
        return 0;
      }
      return next;
    });
  }, []);

  // --- Artifacts ------------------------------------------------------------
  const handleArtifact = useCallback(
    (id: ArtifactId) => {
      if (phaseRef.current !== 'playing') return;
      const acc = accountRef.current;
      if (!acc || acc.name === '나그네') {
        showToast('아티팩트는 로그인한 계정만 쓸 수 있네!');
        return;
      }
      const [next, success] = useArtifact(acc, id);
      saveAccount(next);
      setAccount(next);
      if (success) {
        audioRef.current?.playSfx('coin_toss', { volume: 0.6 });
        finishRef.current(false, true);
      } else {
        setDialogue(SKIP_FAIL_LINE);
        audioRef.current?.playSfx('cauldron_flip', { volume: 0.5, rate: 1.3 });
        showToast(`${ARTIFACTS[id].name}이(가) 빗나갔네! (남은 횟수 ${next.artifacts[id]})`);
      }
    },
    [showToast]
  );

  // --- Account / panels -------------------------------------------------------
  const handleLogin = useCallback((name: string, registered = false) => {
    const acc = login(name, registered);
    setAccount(acc);
    if (acc.activeArtbook) sceneRef.current?.setArtbookMode(true);
    showToast(
      registered
        ? `${acc.name} 님, 명부에 올랐네! 다른 떡집과 겨뤄 보시오!`
        : `${acc.name} 님, 어서 오시오!`
    );
  }, [showToast]);

  const handleRegister = useCallback(() => {
    const acc = accountRef.current;
    if (!acc || acc.name === '나그네') return;
    if (
      !window.confirm(
        '브라우저 밖인 명부에 이름이 기록되네. 다른 떡집이랑 겨뤄 볼 수 있겠는가?'
      )
    ) {
      return;
    }
    const next: Account = { ...acc, registered: true };
    saveAccount(next);
    setAccount(next);
    showToast(`${acc.name} 님, 명부에 올랐네! 다른 떡집과 겨뤄 보시오!`);
  }, [showToast]);

  const handleLogout = useCallback(() => {
    logout();
    setAccount(null);
    sceneRef.current?.setArtbookMode(false);
    showToast('나그네로 돌아갔네.');
  }, [showToast]);

  const handleExport = useCallback(() => {
    const acc = accountRef.current;
    if (!acc) return;
    const blob = new Blob([exportAccount(acc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tteok-account-${acc.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('계정을 JSON으로 백업했네!');
  }, [showToast]);

  const handleImport = useCallback(
    (file: File) => {
      file
        .text()
        .then((json) => {
          const acc = importAccount(json);
          setAccount(acc);
          if (acc.activeArtbook) sceneRef.current?.setArtbookMode(true);
          showToast(`${acc.name} 계정을 불러왔네!`);
        })
        .catch(() => showToast('계정 파일이 올바르지 않네…'));
    },
    [showToast]
  );

  const handleBuyArtbook = useCallback(
    (id: keyof typeof ARTBOOKS) => {
      const acc = accountRef.current;
      if (!acc || acc.name === '나그네') {
        showToast('로그인해야 살 수 있네!');
        return;
      }
      const next = buyArtbook(acc, id);
      if (!next) {
        showToast('돈이 모자라네! 장사를 더 하시오.');
        return;
      }
      saveAccount(next);
      setAccount(next);
      audioRef.current?.playSfx('coin_toss');
      showToast(`「${ARTBOOKS[id].name}」을(를) 손에 넣었네!`);
    },
    [showToast]
  );

  const handleBuyArtifact = useCallback(
    (id: ArtifactId) => {
      const acc = accountRef.current;
      if (!acc || acc.name === '나그네') {
        showToast('로그인해야 살 수 있네!');
        return;
      }
      const next = buyArtifact(acc, id);
      if (!next) {
        showToast('돈이 모자라네! 장사를 더 하시오.');
        return;
      }
      saveAccount(next);
      setAccount(next);
      audioRef.current?.playSfx('coin_toss');
      showToast(`${ARTIFACTS[id].name} ${ARTIFACTS[id].usesPerBuy}회분을 샀네!`);
    },
    [showToast]
  );

  const handleBuyRegular = useCallback(
    (id: RegularId) => {
      const acc = accountRef.current;
      if (!acc || acc.name === '나그네') {
        showToast('로그인해야 단골을 맺을 수 있네!');
        return;
      }
      const item = REGULARS.find((r) => r.id === id)!;
      const next = buyRegular(acc, id);
      if (!next) {
        showToast(acc.regulars.includes(id) ? '이미 우리 집 단골이시네!' : '돈이 모자라네! 장사를 더 하시오.');
        return;
      }
      saveAccount(next);
      setAccount(next);
      audioRef.current?.playSfx('coin_toss');
      showToast(`${item.name}이(가) 단골이 되었네!`);
    },
    [showToast]
  );

  const handleApplyArtbook = useCallback(
    (id: keyof typeof ARTBOOKS | null) => {
      const acc = accountRef.current;
      if (!acc) return;
      const next: Account = { ...acc, activeArtbook: id };
      saveAccount(next);
      setAccount(next);
      sceneRef.current?.setArtbookMode(id !== null);
      showToast(id ? '화첩을 적용했네! 손님들이 달라 보이네…' : '원래 그림으로 돌렸네.');
    },
    [showToast]
  );

  const urgent = timeLeft <= 6 && phase === 'playing';
  const isLoggedIn = !!account && account.name !== '나그네';
  const wallet = account?.money ?? 0;
  const hasArtbook = (account?.ownedArtbooks.length ?? 0) > 0;

  // --- Render ----------------------------------------------------------------
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#33241a] font-game select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {sceneError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 text-2xl text-amber-100">
          {sceneError}
        </div>
      )}

      {/* HUD: top order scroll + timer + wallet */}
      {phase !== 'menu' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
          <div className="order-scroll">
            <div className="text-sm text-amber-800/80">
              {run.stage}장 · 손님 {Math.min(run.served + (phase === 'playing' ? 1 : 0), STAGE_CUSTOMERS)}/
              {STAGE_CUSTOMERS}
              {' · '}실수 {'💔'.repeat(run.fails)}
              {'🤍'.repeat(Math.max(0, MAX_FAILS - run.fails))}
              {hardMode ? ' · 고난도' : ''}
              {order?.beans ? ' · 두 가지 콩' : ''}
            </div>
            <div className="text-2xl leading-tight text-[#4a2c14]">
              찰떡 <span className="font-bold">{order?.label}</span>
              {order?.weightLabel && (
                <span className="ml-2 text-base font-normal text-amber-800/80">
                  ≈ {order.weightLabel}
                </span>
              )}
            </div>
            {regularVisiting && (
              <div className="text-sm font-bold text-emerald-700">
                단골 {regularVisiting} 방문 중 — 실수 한 번은 봐주신다네!
              </div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <div className={`timer-box ${urgent ? 'timer-urgent' : ''}`}>
              남은 시간 {Math.ceil(timeLeft)}초
            </div>
            <div className="mt-1 h-2 w-44 overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full transition-[width] duration-100 ${
                  urgent ? 'bg-red-500' : 'bg-amber-400'
                }`}
                style={{ width: `${(timeLeft / roundSeconds) * 100}%` }}
              />
            </div>
          </div>
          <div className="order-scroll text-right">
            <div className="text-sm text-amber-800/80">
              {isLoggedIn ? `${account.name}의 곳간` : '벌어들인 돈'} · 이번 판
            </div>
            <div className="text-2xl font-bold text-[#4a2c14]">
              {run.runScore}전 <span className="text-sm font-normal">(곳간 {wallet}전)</span>
            </div>
          </div>
        </div>
      )}

      {/* Customer speech bubble */}
      {phase !== 'menu' && dialogue && (
        <div className="pointer-events-none absolute left-1/2 top-[15%] z-10 w-full max-w-xl -translate-x-1/2 px-4">
          <div className="speech-bubble">{dialogue}</div>
        </div>
      )}

      {/* Tool bar */}
      {phase === 'playing' && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-4">
          {/* Bean selector for two-bean orders */}
          {order?.beans && (
            <div className="flex gap-2">
              <button
                onClick={() => switchBean('yellow')}
                className={`bean-btn bean-yellow ${activeBean === 'yellow' ? 'bean-on' : ''}`}
              >
                누런 콩 {formatHop(beanHop.yellow)} / {order.beans[0].label}
              </button>
              <button
                onClick={() => switchBean('black')}
                className={`bean-btn bean-black ${activeBean === 'black' ? 'bean-on' : ''}`}
              >
                검은 콩 {formatHop(beanHop.black)} / {order.beans[1].label}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-center gap-2">
            {VESSELS.map((v, i) => (
              <button
                key={v.id}
                onClick={() => handlePour(i)}
                className={`btn-vessel ${scoopOut ? 'btn-vessel-scoop' : ''}`}
              >
                <span className="text-lg leading-tight">{v.label}</span>
                <span className="text-xs opacity-75">
                  {scoopOut ? v.sub.replace('+', '−') : v.sub}
                </span>
              </button>
            ))}
            <button
              onClick={() => setScoopOut((s) => !s)}
              className={`btn-scoop ${scoopOut ? 'btn-scoop-on' : ''}`}
            >
              {scoopOut ? '덜어내는 중!' : '덜어내기'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handlePound} className="btn-pound">
              떡메 치기!
              <span className="ml-2 tracking-widest">
                {'●'.repeat(poundCount)}
                {'○'.repeat(POUNDS_NEEDED - poundCount)}
              </span>
            </button>
            {(account?.artifacts.sangaji ?? 0) > 0 && (
              <button onClick={() => handleArtifact('sangaji')} className="btn-artifact">
                산가지 ×{account!.artifacts.sangaji}
              </button>
            )}
            {(account?.artifacts.jupan ?? 0) > 0 && (
              <button onClick={() => handleArtifact('jupan')} className="btn-artifact">
                주판 ×{account!.artifacts.jupan}
              </button>
            )}
          </div>
          <div className="text-sm text-amber-200/80">
            숫자는 알려주지 않는다! 솥단지에 찰랑이는 반죽 높이, 눈대중으로 맞추시오!
          </div>
        </div>
      )}

      {/* Menu overlay */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-black/70 via-black/40 to-black/70 p-6">
          <div className="coin-emblem" />
          <h1 className="mt-4 text-6xl text-amber-100 drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">
            평석의 달인
          </h1>
          <p className="mt-2 text-2xl text-amber-300">한양 최고의 떡집</p>
          <p className="mt-4 max-w-md text-center text-amber-100/85">
            손님이 외치는 분량 그대로, 가마니·바가지·됫박·숟가락으로 콩가루를
            담아내시오! <b>1섬은 15말</b>인 것, 잊지 말게! 한 장은 손님 스무 분,
            세 번 잘못 드리면 그날 장사는 끝이네. 잡화점에서 <b>단골</b>을 사두면
            방문하셨을 때 실수 한 번을 봐주신다네!
          </p>
          {isLoggedIn && (
            <div className="mt-3 rounded-xl bg-black/50 px-5 py-2 text-center text-amber-200">
              {account.name} 님 · 곳간 <b>{account.money}전</b> · 누적{' '}
              {account.totalEarned}전 · {account.roundsPlayed}판
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={handleStart} className="btn-start">
              장사 시작!
            </button>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => setHardMode((h) => !h)}
              className={`btn-difficulty ${hardMode ? 'btn-difficulty-on' : ''}`}
            >
              {hardMode ? '고난도: 통단위 암산! (점수 1.5배)' : '보통 난도 (눌러서 고난도 도전!)'}
            </button>
            <button onClick={() => setPanel('settings')} className="btn-difficulty">
              설정 · 계정
            </button>
            <button onClick={() => setPanel('shop')} className="btn-difficulty">
              잡화점
            </button>
            <button
              onClick={() => {
                fetchRanking();
                setPanel('ranking');
              }}
              className="btn-difficulty"
            >
              순위
            </button>
            {hasArtbook && (
              <button onClick={() => setPanel('gallery')} className="btn-difficulty">
                화첩 갤러리
              </button>
            )}
          </div>
          {board.length > 0 && (
            <div className="mt-6 rounded-xl bg-black/40 px-6 py-4 text-center">
              <div className="text-lg text-amber-300">명예의 전당 (한 판 총수입)</div>
              <ol className="mt-1 space-y-0.5 text-amber-100/90">
                {board.map((e, i) => (
                  <li key={i}>
                    {i + 1}위 — {e.name} 님 · {e.score}전 ({e.stage}장 도달)
                  </li>
                ))}
              </ol>
            </div>
          )}
          {serverBoard.length > 0 && (
            <div className="mt-4 rounded-xl bg-black/40 px-6 py-4 text-center">
              <div className="text-lg text-amber-300">명부 랭킹 — 천하의 떡집들</div>
              <div className="text-xs text-amber-200/60">
                가게 이름을 누르면 가진 잡화를 볼 수 있네
              </div>
              <ol className="mt-1 space-y-0.5 text-amber-100/90">
                {serverBoard.map((e, i) => (
                  <li key={i}>
                    {i + 1}위 —{' '}
                    <button
                      onClick={() => setGoodsView(e)}
                      className="font-bold text-amber-200 underline decoration-dotted underline-offset-4 hover:text-amber-100"
                    >
                      {e.name}
                    </button>{' '}
                    님 · {e.score}전 ({e.stage}장 도달)
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Settings panel */}
      {panel === 'settings' && (
        <PanelShell onClose={() => setPanel('none')} title="설정 · 계정">
          <AccountPanel
            account={account}
            isLoggedIn={isLoggedIn}
            onLogin={handleLogin}
            onRegister={handleRegister}
            onLogout={handleLogout}
            onExport={handleExport}
            onImport={handleImport}
          />
        </PanelShell>
      )}

      {/* Shop panel */}
      {panel === 'shop' && (
        <PanelShell onClose={() => setPanel('none')} title="잡화점">
          <ShopPanel
            account={account}
            onBuyArtbook={handleBuyArtbook}
            onBuyArtifact={handleBuyArtifact}
            onBuyRegular={handleBuyRegular}
          />
        </PanelShell>
      )}

      {/* Ranking panel (명부 비교) */}
      {panel === 'ranking' && (
        <PanelShell onClose={() => setPanel('none')} title="순위 — 천하의 떡집 명부">
          <RankingPanel entries={serverBoard} onPick={setGoodsView} />
        </PanelShell>
      )}

      {/* Gallery panel */}
      {panel === 'gallery' && (
        <PanelShell onClose={() => setPanel('none')} title="화첩 갤러리" wide>
          <GalleryPanel
            account={account}
            onApply={handleApplyArtbook}
          />
        </PanelShell>
      )}

      {/* Goods peek modal (명부 랭킹) */}
      {goodsView && (
        <PanelShell
          onClose={() => setGoodsView(null)}
          title={`「${goodsView.name}」의 가진 잡화`}
        >
          {goodsView.goods ? (
            <div className="space-y-3 text-[#4a2c14]">
              <p className="text-sm opacity-75">
                {goodsView.score}전 · {goodsView.stage}장 도달한 가게의 살림이네.
              </p>
              <div>
                <h3 className="text-xl font-bold">화첩</h3>
                {goodsView.goods.artbooks.length > 0 ? (
                  <ul className="list-inside list-disc">
                    {goodsView.goods.artbooks.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="opacity-70">가진 화첩이 없네.</p>
                )}
              </div>
              <div>
                <h3 className="text-xl font-bold">아티팩트</h3>
                <p>
                  산가지 ×{goodsView.goods.artifacts.sangaji} · 주판 ×
                  {goodsView.goods.artifacts.jupan}
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold">단골</h3>
                {goodsView.goods.regulars.length > 0 ? (
                  <ul className="list-inside list-disc">
                    {goodsView.goods.regulars.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="opacity-70">맺은 단골이 없네.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[#4a2c14]">
              이 가게는 살림살이를 공개하지 않았네. 옛날 명부 기록이거나
              아낙네의 비밀장부인 모양이구려.
            </p>
          )}
        </PanelShell>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full bg-black/80 px-6 py-3 text-xl text-amber-100 shadow-xl">
          {toast}
        </div>
      )}

      {/* Result overlay */}
      {phase === 'result' && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-10">
          <div className="result-card">
            <div
              className={`text-3xl font-bold ${
                grade === 'perfect'
                  ? 'text-yellow-300'
                  : grade === 'success'
                    ? 'text-green-300'
                    : 'text-red-400'
              }`}
            >
              {timedOut ? '시간 초과!' : GRADE_TITLES[grade]}
            </div>
            <div className="mt-1 text-amber-100/90">
              {pardoned
                ? `단골이 얼굴을 봐서 넘어가 주셨네! 이번 손님 ${roundScore}전`
                : skipped
                  ? `아티팩트의 힘으로 건너뛰었네! 이번 손님 ${roundScore}전`
                  : `오차 ${lastError}홉 · 이번 손님 ${roundScore}전`}
            </div>
            <div className="mt-1 text-sm text-amber-100/70">
              {run.stage}장 · 손님 {run.served}/{STAGE_CUSTOMERS} · 실수 {run.fails}/{MAX_FAILS} · 이번 판 {run.runScore}전
            </div>
            <button onClick={startRound} className="btn-start mt-4 px-8 py-3 text-2xl">
              다음 손님!
            </button>
          </div>
        </div>
      )}

      {/* Stage clear overlay */}
      {phase === 'stageClear' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
          <div className="result-card text-center">
            <div className="text-3xl font-bold text-yellow-300">
              {run.stage - 1}장 장사 완료!
            </div>
            <div className="mt-2 text-amber-100/90">
              스무 손님을 무사히 모셨네! 이번 판 {run.runScore}전.
              <br />
              다음 {run.stage}장은 시간도 짧아지고 주문도 얄미워진다네…
            </div>
            <div className="mt-4 flex justify-center gap-3">
              <button onClick={handleNextStage} className="btn-start px-8 py-3 text-2xl">
                {run.stage}장 도전!
              </button>
              <button onClick={handleEndRun} className="btn-difficulty">
                오늘은 이만 쉬기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over overlay */}
      {phase === 'gameover' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
          <div className="result-card text-center">
            <div className="text-3xl font-bold text-red-400">장사 접습니다…</div>
            <div className="mt-2 text-amber-100/90">
              손님 세 분께 잘못 드렸으니 오늘 장사는 끝이네.
              <br />
              도달: {run.stage}장 · 총 벌이 <b>{run.runScore}전</b>
            </div>
            {!isLoggedIn && (
              <div className="mt-2 text-sm text-amber-200/70">
                (나그네의 점수는 명예의 전당에 오르지 않네 — 장부에 이름을 올리시오!)
              </div>
            )}
            <div className="mt-4 flex justify-center gap-3">
              <button onClick={handleStart} className="btn-start px-8 py-3 text-2xl">
                다시 장사 시작!
              </button>
              <button onClick={handleEndRun} className="btn-difficulty">
                점포 닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared modal shell. */
function PanelShell({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
      <div
        className={`relative max-h-[85vh] overflow-y-auto rounded-2xl border-4 border-[#7a4e10] bg-[#f6e7c8] p-6 shadow-2xl ${
          wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-[#4a2c14]">{title}</h2>
          <button onClick={onClose} className="panel-close">
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Login / backup / restore. */
function AccountPanel({
  account,
  isLoggedIn,
  onLogin,
  onRegister,
  onLogout,
  onExport,
  onImport,
}: {
  account: Account | null;
  isLoggedIn: boolean;
  onLogin: (name: string, registered?: boolean) => void;
  onRegister: () => void;
  onLogout: () => void;
  onExport: () => void;
  onImport: (f: File) => void;
}) {
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const handleRegistrySignup = () => {
    if (!name.trim()) return;
    if (
      window.confirm(
        '브라우저 밖인 명부에 이름이 기록되네. 다른 떡집이랑 겨뤄 볼 수 있겠는가?'
      )
    ) {
      onLogin(name, true);
    }
  };
  return (
    <div className="space-y-4 text-[#4a2c14]">
      {isLoggedIn ? (
        <>
          <p className="text-xl">
            <b>{account!.name}</b> 님으로 장사 중이네. 곳간: <b>{account!.money}전</b>
            {account!.registered && (
              <span className="ml-2 rounded-full bg-amber-600 px-2 py-0.5 text-sm text-amber-50">
                명부 등재
              </span>
            )}
          </p>
          <p className="text-sm opacity-80">
            계정은 이 브라우저에만 저장되네. 다른 기기로 옮기려면 JSON 백업을 쓰시오.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={onExport} className="btn-panel">
              JSON으로 백업
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn-panel">
              JSON 불러오기
            </button>
            <button onClick={onLogout} className="btn-panel-danger">
              나그네로 돌아가기
            </button>
          </div>
          {!account!.registered && (
            <div className="flex flex-wrap gap-2">
              <button onClick={onRegister} className="btn-panel">
                명부에 등록
              </button>
              <p className="w-full text-sm opacity-75">
                등록하면 한 판 끝날 때마다 점수가 천하 떡집 명부 랭킹에 오르네.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xl">
            지금은 <b>나그네</b>로 장사 중이네. 돈은 벌 수 있지만 저장되지 않고,
            화첩·아티팩트는 살 수 없네!
          </p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="상호를 적어 주시오 (예: 평석이)"
              className="flex-1 rounded-lg border-2 border-[#a4712f] bg-white/80 px-3 py-2 text-lg"
              maxLength={12}
            />
            <button onClick={() => name.trim() && onLogin(name)} className="btn-panel">
              장부에 이름 올리기
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleRegistrySignup} className="btn-panel">
              명부에 등록 후 가입
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="btn-panel">
              JSON 불러오기
            </button>
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** 명부 ranking comparison; tap a shop name to peek its 잡화. */
function RankingPanel({
  entries,
  onPick,
}: {
  entries: ServerEntry[];
  onPick: (e: ServerEntry) => void;
}) {
  return (
    <div className="space-y-3 text-[#4a2c14]">
      {entries.length === 0 ? (
        <p className="opacity-75">
          아직 명부에 오른 떡집이 없네. 「명부에 등록」하고 한 판 겨뤄 보시오!
        </p>
      ) : (
        <>
          <p className="text-sm opacity-75">
            가게 이름을 누르면 그 집이 가진 잡화를 엿볼 수 있네.
          </p>
          <ol className="space-y-2">
            {entries.map((e, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-3 rounded-lg border-2 border-[#c9a35f] bg-white/50 px-3 py-2"
              >
                <span>
                  <b className="mr-2">{i + 1}위</b>
                  <button
                    onClick={() => onPick(e)}
                    className="font-bold text-[#7a4e10] underline decoration-dotted underline-offset-4 hover:text-[#4a2c14]"
                  >
                    {e.name}
                  </button>
                </span>
                <span className="text-right">
                  <b>{e.score}전</b>
                  <span className="ml-2 text-sm opacity-70">{e.stage}장 도달</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** Artbooks & artifacts shop. */
function ShopPanel({
  account,
  onBuyArtbook,
  onBuyArtifact,
  onBuyRegular,
}: {
  account: Account | null;
  onBuyArtbook: (id: keyof typeof ARTBOOKS) => void;
  onBuyArtifact: (id: ArtifactId) => void;
  onBuyRegular: (id: RegularId) => void;
}) {
  const money = account?.money ?? 0;
  return (
    <div className="space-y-5 text-[#4a2c14]">
      <p className="text-xl">
        내 곳간: <b>{money}전</b>
      </p>
      <div>
        <h3 className="mb-2 text-2xl font-bold">명화 화첩 — 미소년·미소녀 판</h3>
        <p className="mb-2 text-sm opacity-75">
          사두면 손님들이 아리따운 그림으로 다시 찾아오네. 노인이건 중년이건 할멈이건,
          전부 미형으로 싹 바뀌는 걸세! 값은 좀 하지만, 후회는 없을 걸세.
        </p>
        <div className="grid gap-3">
          {(Object.keys(ARTBOOKS) as Array<keyof typeof ARTBOOKS>).map((id) => {
            const item = ARTBOOKS[id];
            const owned = account?.ownedArtbooks.includes(id) ?? false;
            return (
              <div key={id} className="shop-row">
                <img src={item.texture} alt={item.name} className="shop-thumb" />
                <div className="flex-1">
                  <div className="text-lg font-bold">{item.name}</div>
                  <div className="text-sm opacity-75">{item.desc}</div>
                </div>
                {owned ? (
                  <span className="shop-owned">소장 중</span>
                ) : (
                  <button onClick={() => onBuyArtbook(id)} className="btn-panel">
                    {item.price.toLocaleString()}전
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-2xl font-bold">단골 맺기 — 실수 면죄부</h3>
        <p className="mb-2 text-sm opacity-75">
          단골이 되신 분은 가끔 가게에 들르시는데, 그날 실수로 잘못 드린 떡 한 번을
          웃으며 넘겨 주신다네. 많을수록 더 자주 오시지!
        </p>
        <div className="grid gap-3">
          {REGULARS.map((item) => {
            const owned = account?.regulars.includes(item.id) ?? false;
            return (
              <div key={item.id} className="shop-row">
                <div className="shop-artifact-icon">客</div>
                <div className="flex-1">
                  <div className="text-lg font-bold">{item.name}</div>
                  <div className="text-sm opacity-75">{item.desc}</div>
                </div>
                {owned ? (
                  <span className="shop-owned">단골</span>
                ) : (
                  <button onClick={() => onBuyRegular(item.id)} className="btn-panel">
                    {item.price.toLocaleString()}전
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-2xl font-bold">아티팩트 — 계산 건너뛰기</h3>
        <div className="grid gap-3">
          {(Object.keys(ARTIFACTS) as ArtifactId[]).map((id) => {
            const item = ARTIFACTS[id];
            const stock = account?.artifacts[id] ?? 0;
            return (
              <div key={id} className="shop-row">
                <div className="shop-artifact-icon">{id === 'sangaji' ? '策' : '珠'}</div>
                <div className="flex-1">
                  <div className="text-lg font-bold">
                    {item.name} <span className="text-sm font-normal">(보유 {stock}회)</span>
                  </div>
                  <div className="text-sm opacity-75">
                    {item.desc} 1회 구매 시 {item.usesPerBuy}회 사용 가능.
                  </div>
                </div>
                <button onClick={() => onBuyArtifact(id)} className="btn-panel">
                  {item.price.toLocaleString()}전
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Artbook gallery with apply buttons. */
function GalleryPanel({
  account,
  onApply,
}: {
  account: Account | null;
  onApply: (id: keyof typeof ARTBOOKS | null) => void;
}) {
  const owned = account?.ownedArtbooks ?? [];
  return (
    <div className="space-y-4 text-[#4a2c14]">
      {owned.map((id) => {
        const item = ARTBOOKS[id];
        const active = account?.activeArtbook === id;
        return (
          <div key={id} className="rounded-xl border-2 border-[#c9a35f] bg-white/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-bold">{item.name}</div>
              <button
                onClick={() => onApply(active ? null : id)}
                className={`btn-panel ${active ? 'opacity-60' : ''}`}
              >
                {active ? '적용 해제' : '화첩 적용하기'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {item.gallery.map((src, gi) => (
                <img
                  key={gi}
                  src={src}
                  alt={`${item.name} ${gi + 1}`}
                  className="gallery-img-sm"
                />
              ))}
            </div>
          </div>
        );
      })}
      {account?.activeArtbook && (
        <p className="text-center text-sm opacity-75">
          지금 「{ARTBOOKS[account.activeArtbook].name}」이(가) 적용되어 있네.
          노인·중년·할멈 할 것 없이 손님 전원이 미형으로 한껏 멋을 부리고 찾아올 걸세!
        </p>
      )}
    </div>
  );
}
