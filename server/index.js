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
    if (req.method === 'POST' && req.url === '/api/session') {
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

    if (req.method === 'POST' && req.url === '/api/pour') {
      const { sessionId, deltaHop } = await readBody(req);
      const currentHop = await redis.eval(POUR_LUA, {
        keys: [`session:${sessionId}`],
        arguments: [String(deltaHop)],
      });
      return send(res, 200, { currentHop });
    }

    if (req.method === 'POST' && req.url === '/api/submit') {
      const { sessionId, userId, score } = await readBody(req);
      const [errorHop, grade] = await redis.eval(SUBMIT_LUA, {
        keys: [`session:${sessionId}`, 'leaderboard:daily'],
        arguments: [String(score), String(userId)],
      });
      return send(res, 200, { errorHop, grade });
    }

    if (req.method === 'GET' && req.url === '/api/leaderboard') {
      const raw = await redis.zRangeWithScores('leaderboard:daily', 0, 9, { REV: true });
      return send(res, 200, {
        leaderboard: raw.map((e) => ({ userId: e.value, score: e.score })),
      });
    }

    // 명부 (global registry): registered shops post their run scores here.
    if (req.method === 'POST' && req.url === '/api/ranking') {
      const { name, score, stage, goods } = await readBody(req);
      if (typeof name !== 'string' || typeof score !== 'number') {
        return send(res, 400, { error: 'name and score required' });
      }
      const member = JSON.stringify({
        name: name.slice(0, 12),
        stage: stage ?? 1,
        goods: goods && typeof goods === 'object' ? goods : null,
      });
      await redis.zAdd('ranking:global', { score, value: member });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/api/ranking') {
      const raw = await redis.zRangeWithScores('ranking:global', 0, 9, { REV: true });
      return send(res, 200, {
        ranking: raw.map((e) => {
          let name = e.value;
          let stage = 1;
          let goods = null;
          try {
            const m = JSON.parse(e.value);
            name = m.name;
            stage = m.stage ?? 1;
            goods = m.goods ?? null;
          } catch {
            /* legacy plain-name member */
          }
          return { name, score: e.score, stage, goods };
        }),
      });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err) });
  }
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`tteok API listening on :${port}`));
