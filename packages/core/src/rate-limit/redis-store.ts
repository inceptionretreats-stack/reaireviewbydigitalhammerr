import { createHash, randomBytes } from 'node:crypto';
import {
  toWindow,
  type DistinctCountRequest,
  type RateLimitDimension,
  type RateLimitReading,
  type RateLimitStore,
  type RateLimitWindow,
} from './types';

/**
 * Redis-backed sliding-window store. One sorted set per dimension key, scored by hit
 * timestamp.
 *
 * ## Why this is a Lua script and not a pipeline
 *
 * The naive form is: ZREMRANGEBYSCORE to trim, ZCARD to count, decide in application code,
 * then ZADD. It is wrong twice over, and both failures are silent.
 *
 * *Concurrency.* Between the ZCARD and the ZADD, every other in-flight request also reads the
 * same count. Ten concurrent requests against a window with one slot left all read
 * `limit - 1`, all conclude there is room, and all write. The window admits ten. This is the
 * same read-modify-write race the quota module documents at length (quota/types.ts), except
 * that a rate limiter exists specifically to stand in front of concurrent traffic, so the
 * pathological case is the normal case.
 *
 * *Cross-dimension consistency.* AC-032 needs several dimensions decided together. If hits
 * are written to the session window before the IP-prefix window is even read, then a request
 * that the IP dimension refuses has still spent a session slot. An attacker who intentionally
 * keeps one dimension saturated can drain every window it is paired with.
 *
 * MULTI/EXEC does not fix either problem, and it is worth being precise about why: a
 * transaction is atomic in the sense that no other client interleaves, but the replies only
 * arrive at EXEC. There is no way to read a ZCARD and branch on it inside the transaction, so
 * "count, then write only if there is room" cannot be expressed. A Lua script can: it is
 * atomic *and* it can branch, so the whole evaluate-all-then-commit-all step is one
 * indivisible operation. That is the entire reason the script exists.
 *
 * ## Redis Cluster
 *
 * The script addresses several keys that intentionally hash to different slots, so it would
 * be rejected with CROSSSLOT on a clustered deployment. Launch is a single managed Redis
 * instance (ADR-AMEND-B), which is the assumption here; a move to Cluster would mean either
 * a common hash tag for a request's dimensions or one script call per dimension, and the
 * second choice gives up the cross-dimension guarantee above.
 */

/**
 * KEYS[i]                : sliding-window key for dimension i
 * ARGV[1]                : now, integer milliseconds
 * ARGV[2]                : member, unique per request
 * ARGV[3]                : '1' to record when admitted, '0' to evaluate only
 * ARGV[3 + (i-1)*3 + 1]  : limit for dimension i
 * ARGV[3 + (i-1)*3 + 2]  : window length in milliseconds for dimension i
 * ARGV[3 + (i-1)*3 + 3]  : '1' when dimension i is enforced, '0' when observe-only
 *
 * Reply: { trippedIndex, recorded, count_1, releaseAt_1, ..., count_n, releaseAt_n }
 * where trippedIndex is 1-based, 0 for none, and releaseAt is -1 when the window has room.
 */
const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local record = ARGV[3] == '1'
local n = #KEYS

local counts = {}
local limits = {}
local windows = {}
local enforced = {}
local releaseAt = {}

for i = 1, n do
  local base = 3 + (i - 1) * 3
  limits[i] = tonumber(ARGV[base + 1])
  windows[i] = tonumber(ARGV[base + 2])
  enforced[i] = ARGV[base + 3] == '1'

  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windows[i])
  counts[i] = redis.call('ZCARD', KEYS[i])

  releaseAt[i] = -1
  if counts[i] >= limits[i] then
    local index = counts[i] - limits[i]
    local entry = redis.call('ZRANGE', KEYS[i], index, index, 'WITHSCORES')
    if entry[2] then releaseAt[i] = tonumber(entry[2]) end
  end
end

local tripped = 0
for i = 1, n do
  if tripped == 0 and enforced[i] and counts[i] >= limits[i] then
    tripped = i
  end
end

local recorded = 0
if tripped == 0 and record then
  recorded = 1
  for i = 1, n do
    redis.call('ZADD', KEYS[i], now, member)
    redis.call('PEXPIRE', KEYS[i], windows[i] + 1000)
  end
end

local reply = { tripped, recorded }
for i = 1, n do
  reply[#reply + 1] = counts[i]
  reply[#reply + 1] = releaseAt[i]
end
return reply
`;

const SLIDING_WINDOW_SHA = createHash('sha1').update(SLIDING_WINDOW_SCRIPT).digest('hex');

/** Extra key lifetime beyond the window, so an expiry race cannot drop a live entry. */
const TTL_SLACK_MS = 1000;

/**
 * The slice of the client this store uses.
 *
 * Structural rather than `import type { Redis } from 'ioredis'` for the same reason
 * PostgresQuotaStore takes an injected Database: packages/core stays free of client
 * construction, a fake needs six methods rather than a running server, and swapping the
 * client is a call-site change. An ioredis `Redis` (or `Cluster`) satisfies this as-is —
 * `new Redis(env.REDIS_URL)` is the intended argument.
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  evalsha(sha1: string, numKeys: number, ...args: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  multi(): RedisMultiLike;
}

export interface RedisMultiLike {
  zremrangebyscore(key: string, min: string, max: string): RedisMultiLike;
  zadd(key: string, score: string, member: string): RedisMultiLike;
  zcard(key: string): RedisMultiLike;
  pexpire(key: string, milliseconds: number): RedisMultiLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisLike) {}

  consume(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading> {
    return this.evaluate(dimensions, now, true);
  }

  inspect(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading> {
    return this.evaluate(dimensions, now, false);
  }

  async forget(dimensions: readonly RateLimitDimension[]): Promise<void> {
    if (dimensions.length === 0) return;
    await this.redis.del(...dimensions.map((dimension) => dimension.key));
  }

  /**
   * Distinct sliding-window cardinality, sizing the adaptive IP-prefix limit.
   *
   * This one genuinely is a MULTI/EXEC pipeline rather than a script, and the contrast with
   * the check above is the point: every command here is unconditional, so nothing needs to
   * branch on an intermediate reply. Trim, add, count, expire — the transaction guarantees no
   * other client interleaves, which is all this needs.
   */
  async countDistinct(request: DistinctCountRequest): Promise<number> {
    // A cookieless caller has no session to add to the set — it reads the size and leaves.
    // Adding a per-request member would let it inflate the very allowance it is measured
    // against, one request at a time.
    const transaction = this.redis
      .multi()
      .zremrangebyscore(request.key, '-inf', String(request.now - request.windowMs));

    if (request.member !== null) {
      transaction.zadd(request.key, String(request.now), request.member);
    }

    const replies = await transaction
      .zcard(request.key)
      .pexpire(request.key, request.windowMs + TTL_SLACK_MS)
      .exec();

    // exec() resolves to null when the transaction was discarded, e.g. a WATCH conflict or a
    // connection reset mid-transaction. Treated as a failure so the caller's degraded path
    // decides what to do, rather than silently reporting zero distinct sessions.
    const zcard = replies?.[request.member === null ? 1 : 2];
    if (!zcard) throw new RedisRateLimitError('distinct-count transaction was discarded');

    const [error, value] = zcard;
    if (error) throw error;
    if (typeof value !== 'number') {
      throw new RedisRateLimitError(`expected an integer ZCARD reply, received ${typeof value}`);
    }
    return value;
  }

  private async evaluate(
    dimensions: readonly RateLimitDimension[],
    now: number,
    record: boolean,
  ): Promise<RateLimitReading> {
    if (dimensions.length === 0) {
      return { recorded: false, trippedIndex: null, windows: [] };
    }

    const keys = dimensions.map((dimension) => dimension.key);
    // One member per request, shared across the request's keys. Generated here rather than in
    // Lua so the script stays deterministic; two hits landing in the same millisecond would
    // otherwise collide, because ZADD treats a repeated member as an update, not an insert —
    // which would quietly under-count exactly the burst the limiter is looking for.
    const member = `${now}-${randomBytes(9).toString('base64url')}`;

    const args = [String(now), member, record ? '1' : '0'];
    for (const { rule } of dimensions) {
      args.push(
        String(rule.limit),
        String(rule.windowMs),
        rule.enforcement === 'ENFORCE' ? '1' : '0',
      );
    }

    const reply = await this.run(keys, args);
    return this.parse(dimensions, reply, now);
  }

  /**
   * EVALSHA first so the script body is not shipped on every request, falling back to EVAL
   * when this Redis has not seen it — after a restart, a failover, or SCRIPT FLUSH.
   */
  private async run(keys: readonly string[], args: readonly string[]): Promise<unknown> {
    try {
      return await this.redis.evalsha(SLIDING_WINDOW_SHA, keys.length, ...keys, ...args);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      return await this.redis.eval(SLIDING_WINDOW_SCRIPT, keys.length, ...keys, ...args);
    }
  }

  private parse(
    dimensions: readonly RateLimitDimension[],
    reply: unknown,
    now: number,
  ): RateLimitReading {
    const expected = 2 + dimensions.length * 2;
    if (!Array.isArray(reply) || reply.length !== expected) {
      throw new RedisRateLimitError(
        `malformed script reply: expected ${expected} integers, received ${
          Array.isArray(reply) ? reply.length : typeof reply
        }`,
      );
    }

    const integers = reply.map((value) => {
      if (typeof value !== 'number') {
        throw new RedisRateLimitError(
          `malformed script reply: ${typeof value} where an integer was expected`,
        );
      }
      return value;
    });

    const tripped = integers[0] ?? 0;
    const recorded = (integers[1] ?? 0) === 1;

    const windows: RateLimitWindow[] = dimensions.map((dimension, index) => {
      const count = integers[2 + index * 2] ?? 0;
      const releaseAt = integers[3 + index * 2] ?? -1;
      return toWindow(dimension, count, releaseAt, recorded, now);
    });

    // Lua indexes from 1; 0 means nothing tripped.
    return { recorded, trippedIndex: tripped === 0 ? null : tripped - 1, windows };
  }
}

export class RedisRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisRateLimitError';
  }
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}
