# 평석의 달인: 한양 최고의 떡집 (Master of Pyeongseok)

18세기 한양 장마당을 배경으로 한 빠른 템포의 코믹 3D 아케이드 게임.
손님들이 조선식 부피 단위로 정확한 양을 외치면, 네 가지 그릇으로 담아 내고
세 번의 리드미컬한 방망이질로 마무리한다 — 모두 20초 안에.

## 기술 스택

- **프론트엔드:** Vite + TypeScript + React 셸, Three.js `WebGPURenderer`
  (WebGPU에서는 WGSL 셰이더, 미지원 시 WebGL2로 자동 폴백).
- **가루 시뮬레이션:** TSL 컴퓨트 셰이더(WebGPU에서 WGSL로 컴파일)로
  볶은 콩가루 50,000알을 적분. CPU 폴백 포함.
- **반죽:** 물리 기반 SSS풍 머티리얼(transmission + sheen + clearcoat)에
  AI 생성 찹쌀 반죽 알베도 적용.
- **오디오:** Web Audio API — 생성된 산조풍 BGM 루프(긴박감에 따라 피치
  상승)와 여섯 종의 생성 SFX.
- **백엔드 (선택, 로컬 개발용):** `ghcr.io/gosuda/gopherdis:1.0-simd`와
  Redis 와이어 프로토콜로 통신하는 Node.js 클라이언트 (`server/` 참고).

## 조선 도량형 (엄격 적용)

| 단위 | 진법 | 홉 환산 |
| ---- | ----- | -------- |
| 1 섬 (Seom) | 15 말 | 1,500 홉 |
| 1 말 (Mal) | 10 되 | 100 홉 |
| 1 되 (Doe) | 10 홉 | 10 홉 |
| 1 홉 (Hop) | — | 1 홉 |

오차 허용: 0-2홉 오차 대성공 · 3-7홉 성공 · 8홉 이상 대실패.

## 한 판의 흐름

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

## 성장 요소 (브라우저 로컬)

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

## 난이도 모드

- **보통:** 주문이 분해된 형태로 온다. 예: "찰떡 1섬 4말 2되".
- **고난도 (메뉴에서 토글):** 주문이 하나의 펼친 단위로 온다 —
  "찰떡 40말", "찰떡 24되" — 그래서 플레이어가 정확히 한 단계의 진법 변환을
  암산해야 한다 (40말 = 2섬 10말, 24되 = 2말 4되). 두 단계 변환은 출제되지
  않는다. 고난도 라운드는 점수 1.5배.

## 실행

```bash
npm install
npm run dev        # 프론트엔드
npm test           # vitest 도량형 테스트 (24개)
npm run build      # 프로덕션 빌드

# gopherdis 기반 세션 서버 (선택, 로컬 전용):
docker compose up -d
cd server && npm install && npm start
```

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가
자동으로 빌드해 GitHub Pages에 배포한다. 저장소 Settings → Pages → Source를
**GitHub Actions**로 설정해야 한다.

> **주의: GitHub Pages 배포본에는 DB/서버가 붙지 않는다.** GitHub Pages는
> 정적 호스팅이라 Node 서버(`server/index.js`)와 gopherdis를 띄울 수 없다.
> 따라서 배포본에서 `/api/ranking` 호출은 실패하며, 공유 명부(랭킹) 기능은
> 동작하지 않는다. 점수·계정 등 나머지 모든 데이터는 브라우저 localStorage에
> 저장되고 게임 진행에는 영향이 없다. 공유 랭킹을 쓰려면 백엔드를 별도
> 호스팅(Render, Fly.io 등)에 올리고 프록시/도메인을 연결해야 한다.
>
> gopherdis 백엔드(`server/index.js` + `docker-compose.yml`)는 셀프 호스팅용으로
> 제공되며, 일일 리더보드(`ZADD leaderboard:daily`)와 로비 브로드캐스트
> (`PUBLISH tteok:events`)를 지원한다.

## 생성 에셋 (`public/assets/`)

모두 AI 생성 파이프라인으로 만든 것 — 플레이스홀더 없음:

- `textures/rice_dough_albedo.png` — 반투명 찹쌀 반죽
- `textures/soybean_powder_albedo.png` / `soybean_powder_normal.png` —
  볶은 콩가루 (노멀 맵은 알베도에서 유도)
- `textures/pine_wood_worn.png` — 밀가루 묻은 낡은 소나무
- `textures/sangpyeong_tongbo.png` — 조선 동전 (常平通寶)
- `audio/bgm_sanjo_fast.mp3` — 신나는 산조풍 루프 (가야금 / 피리 /
  장구, ~140 BPM; 생성기 상한 22초, 게임 내 무매끝 루프)
- `audio/sfx/*.wav` — thud_sack, pour_grain, clatter_wood, mallet_strike,
  coin_toss, cauldron_flip (mp3로 생성 후 지연 최소화를 위해 wav 변환)

## 소스 구조

```
src/game/metrology.ts        15진법 부피 엔진 (순수 함수, 단위 테스트 있음)
src/game/metrology.test.ts   vitest 스위트 — 진법 경계 & 오차 허용
src/game/audio.ts            Web Audio 디렉터 (BGM 피칭, SFX)
src/game/powder.ts           TSL/WGSL 컴퓨트 파티클 + CPU 폴백
src/game/procedural-assets.ts 스타일라이즈드 합성 메시 (갓, 도포, 그릇)
src/game/scene.ts            WebGPURenderer 무대, 애니메이션, 카메라 셰이크
src/App.tsx                  게임 상태 머신 + 한국어 HUD
server/                      gopherdis Redis-와이어 API + Lua 원자 스크립트
```
