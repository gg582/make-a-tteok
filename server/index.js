/**
 * Backend API client for gopherdis (ghcr.io/gosuda/gopherdis:1.0-simd) over the
 * Redis wire protocol. All pour updates are atomic Lua scripts so rapid
 * concurrent taps never corrupt the hop ledger.
 *
 * Run:  docker compose up -d   (gopherdis)
 *       npm install && npm start   (this API, listens on :8080)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
});
redis.on('error', (err) => console.error('[gopherdis]', err));
await redis.connect();

const SESSION_TTL_SECONDS = 30;

/** Atomic pour: clamps at zero, bumps TTL, returns the new current_hop. */
const POUR_LUA = `
local cur = tonumber(redis.call('HGET', KEYS[1], 'current_hop') or '0')
local next_val = cur + tonumber(ARGV[1])
if next_val < 0 then next_val = 0 end
redis.call('HSET', KEYS[1], 'current_hop', next_val)
redis.call('EXPIRE', KEYS[1], ${SESSION_TTL_SECONDS})
return next_val
`;

/** Atomic submit: score + leaderboard + lobby broadcast in one round trip. */
const SUBMIT_LUA = `
local target = tonumber(redis.call('HGET', KEYS[1], 'target_hop') or '0')
local current = tonumber(redis.call('HGET', KEYS[1], 'current_hop') or '0')
local err = math.abs(target - current)
local grade = 'fail'
if err <= 2 then grade = 'perfect' elseif err <= 7 then grade = 'success' end
redis.call('HSET', KEYS[1], 'client_status', grade)
if grade ~= 'fail' then
  redis.call('ZADD', KEYS[2], ARGV[1], ARGV[2])
end
redis.call('PUBLISH', 'tteok:events', ARGV[2] .. ':' .. ARGV[1] .. ':' .. grade)
redis.call('DEL', KEYS[1])
return { err, grade }
`;

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (req.method === 'POST' && pathname === '/api/session') {
      const { targetHop, userId } = await readBody(req);
      const sessionId = randomUUID();
      await redis
        .multi()
        .hSet(`session:${sessionId}`, {
          target_hop: String(targetHop),
          current_hop: '0',
          start_time: String(Date.now()),
          client_status: 'active',
        })
        .expire(`session:${sessionId}`, SESSION_TTL_SECONDS)
        .exec();
      return send(res, 200, { sessionId });
    }

    if (req.method === 'POST' && pathname === '/api/pour') {
      const { sessionId, deltaHop } = await readBody(req);
      const currentHop = await redis.eval(POUR_LUA, {
        keys: [`session:${sessionId}`],
        arguments: [String(deltaHop)],
      });
      return send(res, 200, { currentHop });
    }

    if (req.method === 'POST' && pathname === '/api/submit') {
      const { sessionId, userId, score } = await readBody(req);
      const [errorHop, grade] = await redis.eval(SUBMIT_LUA, {
        keys: [`session:${sessionId}`, 'leaderboard:daily'],
        arguments: [String(score), String(userId)],
      });
      return send(res, 200, { errorHop, grade });
    }

    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const raw = await redis.zRangeWithScores('leaderboard:daily', 0, 9, { REV: true });
      return send(res, 200, {
        leaderboard: raw.map((e) => ({ userId: e.value, score: e.score })),
      });
    }

    // 명부 (global registry): registered shops post their run scores and goods here.
    if (req.method === 'POST' && pathname === '/api/ranking') {
      const { name, score, stage, goods, money } = await readBody(req);
      if (typeof name !== 'string' || !name.trim()) {
        return send(res, 400, { error: 'name required' });
      }
      const cleanName = name.trim().slice(0, 12);
      // Upsert by shop name: drop older entries for the same shop so
      // changed goods never leave stale duplicates behind.
      const allWithScores = await redis.zRangeWithScores('ranking:global', 0, -1);
      let existingScore = 0;
      let existingStage = 1;
      let existingGoods = null;
      let existingMoney = 0;
      for (const entry of allWithScores) {
        let mName = entry.value;
        try {
          const parsed = JSON.parse(entry.value);
          mName = parsed.name;
          if (mName === cleanName) {
            existingScore = entry.score;
            existingStage = parsed.stage ?? 1;
            existingGoods = parsed.goods ?? null;
            existingMoney = parsed.money ?? 0;
          }
        } catch {
          /* legacy plain-name member */
          if (mName === cleanName) {
            existingScore = entry.score;
          }
        }
        if (mName === cleanName) {
          await redis.zRem('ranking:global', entry.value);
        }
      }

      // Merge goods: keep union of artbooks & regulars; update artifacts
      let finalGoods = existingGoods;
      if (goods && typeof goods === 'object') {
        const mergedArtbooks = Array.from(
          new Set([...(existingGoods?.artbooks || []), ...(goods.artbooks || [])])
        );
        const mergedRegulars = Array.from(
          new Set([...(existingGoods?.regulars || []), ...(goods.regulars || [])])
        );
        const mergedArtifacts = {
          sangaji:
            typeof goods.artifacts?.sangaji === 'number'
              ? goods.artifacts.sangaji
              : (existingGoods?.artifacts?.sangaji ?? 0),
          jupan:
            typeof goods.artifacts?.jupan === 'number'
              ? goods.artifacts.jupan
              : (existingGoods?.artifacts?.jupan ?? 0),
        };
        finalGoods = {
          artbooks: mergedArtbooks,
          regulars: mergedRegulars,
          artifacts: mergedArtifacts,
          ...(goods.activeArtbooks ? { activeArtbooks: goods.activeArtbooks } : {}),
        };
      }

      const incomingScore = typeof score === 'number' ? score : 0;
      const finalScore = Math.max(existingScore, incomingScore);
      const incomingStage = typeof stage === 'number' ? stage : 1;
      const finalStage = Math.max(existingStage, incomingStage);
      const finalMoney = typeof money === 'number' ? money : existingMoney;

      const member = JSON.stringify({
        name: cleanName,
        stage: finalStage,
        goods: finalGoods,
        money: finalMoney,
      });
      await redis.zAdd('ranking:global', { score: finalScore, value: member });

      // Keep account hash in sync
      await redis.hSet(`account:${cleanName}`, {
        name: cleanName,
        score: String(finalScore),
        stage: String(finalStage),
        money: String(finalMoney),
        goods: JSON.stringify(finalGoods),
        updatedAt: String(Date.now()),
      });

      return send(res, 200, { ok: true, score: finalScore, stage: finalStage, goods: finalGoods, money: finalMoney });
    }

    if (req.method === 'GET' && pathname === '/api/ranking') {
      const queryName = parsedUrl.searchParams.get('name')?.trim().slice(0, 12);
      const raw = await redis.zRangeWithScores('ranking:global', 0, 9, { REV: true });
      const ranking = raw.map((e) => {
        let name = e.value;
        let stage = 1;
        let goods = null;
        let money = 0;
        try {
          const m = JSON.parse(e.value);
          name = m.name;
          stage = m.stage ?? 1;
          goods = m.goods ?? null;
          money = m.money ?? 0;
        } catch {
          /* legacy plain-name member */
        }
        return { name, score: e.score, stage, goods, money };
      });

      let mine = null;
      if (queryName) {
        mine = ranking.find((r) => r.name === queryName) || null;
        if (!mine) {
          const allWithScores = await redis.zRangeWithScores('ranking:global', 0, -1);
          for (const e of allWithScores) {
            try {
              const m = JSON.parse(e.value);
              if (m.name === queryName) {
                mine = {
                  name: m.name,
                  score: e.score,
                  stage: m.stage ?? 1,
                  goods: m.goods ?? null,
                  money: m.money ?? 0,
                };
                break;
              }
            } catch {}
          }
        }
        if (!mine) {
          const accData = await redis.hGetAll(`account:${queryName}`);
          if (accData && (accData.score || accData.goods)) {
            let parsedGoods = null;
            try {
              parsedGoods = JSON.parse(accData.goods);
            } catch {}
            mine = {
              name: queryName,
              score: Number(accData.score || 0),
              stage: Number(accData.stage || 1),
              goods: parsedGoods,
              money: Number(accData.money || 0),
            };
          }
        }
      }

      return send(res, 200, { ranking, mine });
    }

    // Account password management (stored with PBKDF2 hash & salt in Redis)
    if (req.method === 'POST' && pathname === '/api/account/login') {
      const { name, password } = await readBody(req);
      if (typeof name !== 'string' || !name.trim()) {
        return send(res, 400, { error: 'name required' });
      }
      const cleanName = name.trim().slice(0, 12);
      const acc = await redis.hGetAll(`account:${cleanName}`);
      let serverData = null;
      if (acc && (acc.score || acc.goods)) {
        let parsedGoods = null;
        try {
          parsedGoods = JSON.parse(acc.goods);
        } catch {}
        serverData = {
          name: cleanName,
          score: Number(acc.score || 0),
          stage: Number(acc.stage || 1),
          money: Number(acc.money || 0),
          goods: parsedGoods,
        };
      }
      if (!acc || !acc.passwordHash) {
        // Passwordless account
        return send(res, 200, { ok: true, hasPassword: false, account: serverData });
      }
      if (!password) {
        return send(res, 401, { error: 'PASSWORD_REQUIRED', hasPassword: true });
      }
      const enc = new TextEncoder();
      const saltBuf = Buffer.from(acc.passwordSalt, 'hex');
      const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBuf, iterations: 100000, hash: 'SHA-256' },
        km,
        256
      );
      const computedHash = Buffer.from(derived).toString('hex');
      if (computedHash !== acc.passwordHash) {
        return send(res, 401, { error: 'INVALID_PASSWORD', hasPassword: true });
      }
      return send(res, 200, { ok: true, hasPassword: true, account: serverData });
    }

    if (req.method === 'POST' && pathname === '/api/account/password') {
      const { name, currentPassword, newPassword } = await readBody(req);
      if (typeof name !== 'string' || !name.trim()) {
        return send(res, 400, { error: 'name required' });
      }
      const cleanName = name.trim().slice(0, 12);
      const acc = await redis.hGetAll(`account:${cleanName}`);
      const enc = new TextEncoder();

      // If already has password, verify currentPassword first
      if (acc && acc.passwordHash) {
        if (!currentPassword) {
          return send(res, 401, { error: 'CURRENT_PASSWORD_REQUIRED' });
        }
        const saltBuf = Buffer.from(acc.passwordSalt, 'hex');
        const km = await crypto.subtle.importKey('raw', enc.encode(currentPassword), 'PBKDF2', false, ['deriveBits']);
        const derived = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBuf, iterations: 100000, hash: 'SHA-256' },
          km,
          256
        );
        const computed = Buffer.from(derived).toString('hex');
        if (computed !== acc.passwordHash) {
          return send(res, 401, { error: 'INVALID_PASSWORD' });
        }
      }

      if (!newPassword || !newPassword.trim()) {
        // Toggle to passwordless
        await redis.del(`account:${cleanName}`);
        return send(res, 200, { ok: true, passwordless: true });
      }

      // Hash new password
      const salt = randomUUID().replace(/-/g, '');
      const saltBuf = Buffer.from(salt, 'hex');
      const km = await crypto.subtle.importKey('raw', enc.encode(newPassword.trim()), 'PBKDF2', false, ['deriveBits']);
      const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBuf, iterations: 100000, hash: 'SHA-256' },
        km,
        256
      );
      const hash = Buffer.from(derived).toString('hex');
      await redis.hSet(`account:${cleanName}`, {
        passwordSalt: salt,
        passwordHash: hash,
        updatedAt: String(Date.now()),
      });
      return send(res, 200, { ok: true, passwordless: false });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err) });
  }
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`tteok API listening on :${port}`));
