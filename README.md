# 평석의 달인: 한양 최고의 떡집 (Master of Pyeongseok)

Fast-paced comedic 3D arcade game set in an 18th-century Hanyang marketplace.
Customers shout exact Joseon volumes; you pour with four vessels and finish
with three rhythmic mallet pounds — all inside a 20-second round.

## Stack

- **Frontend:** Vite + TypeScript + React shell, Three.js `WebGPURenderer`
  (WGSL shaders on WebGPU, automatic WebGL2 fallback).
- **Powder simulation:** TSL compute shaders (compiled to WGSL on WebGPU)
  integrating 50,000 roasted-soybean-powder grains; CPU fallback included.
- **Dough:** physical SSS-style material (transmission + sheen + clearcoat)
  using the AI-generated rice-dough albedo.
- **Audio:** Web Audio API — generated sanjo BGM loop with dynamic urgency
  pitching, plus six generated SFX.
- **Backend (optional, local dev):** Node.js client speaking the Redis wire
  protocol to `ghcr.io/gosuda/gopherdis:1.0-simd` (see `server/`).

## Joseon metrology (strict)

| Unit | Radix | Base hop |
| ---- | ----- | -------- |
| 1 섬 (Seom) | 15 말 | 1,500 홉 |
| 1 말 (Mal) | 10 되 | 100 홉 |
| 1 되 (Doe) | 10 홉 | 10 홉 |
| 1 홉 (Hop) | — | 1 홉 |

Tolerances: 0~2홉 오차 대성공 · 3~7홉 성공 · 8홉 이상 대실패.

## Run structure (한 판의 흐름)

- **한 스테이지 = 손님 20명.** 스무 분을 무사히 모시면 스테이지 클리어.
- **실패 3번이면 그날 장사 종료** (게임 오버). 나그네 점수는 명예의 전당에
  오르지 않는다 — 로그인한 계정의 한 판 총수입만 기록되므로 게스트와 계정
  점수가 섞이지 않는다.
- **스테이지가 오를수록:** 시한 20초 → 스테이지당 −1초 (최소 12초), 두 가지 콩
  주문이 더 일찍(4번째 → 2번째 손님부터)·더 자주(50% → 최대 80%) 등장,
  점수 배율 +15%/스테이지.
- **단골 (잡화점):** 이모부 반장님 6,000전 / 도승 스님 8,000전 / 최상객 행수
  12,000전. 구매한 단골은 라운드마다 확률적으로 방문(1명 20%, 2명 30%,
  3명 40%, 최대 50%)하며, 방문한 날 실패를 한 번 면죄해 준다 (성공 처리,
  실패 카운트 없음). 로그인 계정 전용 — 게스트는 단골을 맺을 수 없다.

## Progression (browser-local)

- **계정:** 메뉴 → 설정·계정에서 이름을 올리면 로그인. 모든 데이터는
  브라우저 localStorage에만 저장되며, 설정에서 JSON 백업/불러오기가 가능.
  로그인 없이는 나그네 모드(돈은 화면에만 표시, 저장·구매 불가).
- **곳간:** 판마다 번 돈이 계정에 누적된다.
- **잡화점:**
  - 화첩 3종 (미소년·미소녀 일러스트, 9,000/12,000/15,000전) — 구매 후
    갤러리에서 감상, 「화첩 적용하기」로 손님 일러스트 교체 (Live2D풍
    호흡·스웨이 모션 강화).
  - 단골 3명 (6,000/8,000/12,000전) — 방문 시 실패 1회 면죄.
  - 산가지 (2,500전, 3회, 80% 계산 건너뛰기 성공)
  - 주판 (4,000전, 5회, 70% 계산 건너뛰기 성공)
- **명분·무게 고증:** 모든 주문 대사는 그 많은 떡이 어디에 쓰이는지 밝힌다
  (회갑잔치·종갓집 제사·마을 동제·돌잔치·관아/역마 납품 등). 부피는 조선
  저울 단위로 환산해 함께 보여 준다 — 콩 1되 ≈ 1.2근, 1근 = 16냥 = 600g
  (예: "찰떡 1섬 (≈18근)"). 큰 주문일수록 잔치·제사 명분이 붙는다.
- **두 가지 콩:** 1장 4번째 손님부터 절반 확률로 "누런 콩 X, 검은 콩 Y"
  주문 등장 (스테이지가 오르면 더 빨리·더 자주). 각각 따로 담아야 하며
  오차는 합산 평가. 검은 콩을 부으면 가루·반죽이 어두워진다.

## Difficulty modes

- **보통 (normal):** orders arrive decomposed, e.g. "찰떡 1섬 4말 2되".
- **고난도 (hard, toggle on the menu):** orders arrive as a single flat
  unit — "찰떡 40말", "찰떡 24되" — so the player converts exactly ONE radix
  step mentally (40말 = 2섬 10말, 24되 = 2말 4되). Two-step conversions are
  never issued. Hard rounds pay 1.5x score.

## Run

```bash
npm install
npm run dev        # frontend
npm test           # vitest metrology suite (24 tests)
npm run build      # production build

# Optional gopherdis-backed session server (local only):
docker compose up -d
cd server && npm install && npm start
```

> The deployed preview runs fully client-side; scores are stored in the
> browser's localStorage. The gopherdis backend (`server/index.js` +
> `docker-compose.yml`) is provided for self-hosted sessions, daily
> leaderboards (`ZADD leaderboard:daily`), and lobby broadcasts
> (`PUBLISH tteok:events`).

## Generated assets (`public/assets/`)

All synthesized by AI generation pipelines — no placeholders:

- `textures/rice_dough_albedo.png` — translucent glutinous rice dough
- `textures/soybean_powder_albedo.png` / `soybean_powder_normal.png` —
  roasted soybean powder (normal map derived from the albedo)
- `textures/pine_wood_worn.png` — flour-dusted worn pine wood
- `textures/sangpyeong_tongbo.png` — Joseon copper coin (常平通寶)
- `audio/bgm_sanjo_fast.mp3` — upbeat sanjo-style loop (gayageum / piri /
  janggu, ~140 BPM; generator caps at 22 s, looped seamlessly in-game)
- `audio/sfx/*.wav` — thud_sack, pour_grain, clatter_wood, mallet_strike,
  coin_toss, cauldron_flip (generated mp3, converted to wav for latency)

## Source layout

```
src/game/metrology.ts        15-radix volume engine (pure, unit-tested)
src/game/metrology.test.ts   vitest suite — radix boundaries & tolerances
src/game/audio.ts            Web Audio director (BGM pitching, SFX)
src/game/powder.ts           TSL/WGSL compute particles + CPU fallback
src/game/procedural-assets.ts stylized compound meshes (Gat, Dopo, vessels)
src/game/scene.ts            WebGPURenderer stage, animations, camera shake
src/App.tsx                  game state machine + Korean HUD
server/                      gopherdis Redis-wire API + Lua atomic scripts
```
