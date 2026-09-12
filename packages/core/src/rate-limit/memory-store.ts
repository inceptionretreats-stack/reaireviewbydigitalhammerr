import {
  toWindow,
  type DistinctCountRequest,
  type RateLimitDimension,
  type RateLimitReading,
  type RateLimitStore,
  type RateLimitWindow,
} from './types';

/**
 * In-process store, mirroring the MemoryQuotaStore / PostgresQuotaStore split.
 *
 * Two uses, both real:
 *
 *  1. Tests. The whole sliding-window algorithm is exercised here with an injected clock, so
 *     window-boundary behaviour is asserted deterministically instead of by sleeping.
 *  2. Production fallback. RateLimiter accepts this as a second store for when Redis is
 *     unreachable (service.ts). Per-container counters are weaker than shared ones — N
 *     containers allow N times the limit — but they are enormously stronger than nothing,
 *     and at the launch footprint N is 2.
 *
 * The evaluate-then-write step is synchronous with no await between the two passes, which is
 * what makes it a faithful model of the Lua script: single-threaded JavaScript gives here
 * exactly what script atomicity gives in Redis.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  /** key -> hit timestamps. Kept sorted ascending, as a Redis sorted set would be. */
  private readonly hits = new Map<string, number[]>();
  private readonly distinct = new Map<string, Map<string, number>>();

  /**
   * `racy` deliberately models the read-then-write mistake this design exists to avoid, so
   * the concurrency test can prove it detects the bug rather than passing vacuously. Same
   * device as MemoryQuotaStore's flag.
   */
  constructor(private readonly racy = false) {}

  async consume(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading> {
    const readings = dimensions.map((dimension) => this.read(dimension, now));
    const trippedIndex = firstTripped(dimensions, readings);

    if (this.racy) {
      // A suspension point between deciding and writing is all it takes: every concurrent
      // caller has already decided "there is room" by the time the first one writes.
      await Promise.resolve();
    }

    const recorded = trippedIndex === null;
    if (recorded) {
      for (const dimension of dimensions) {
        this.push(dimension.key, now);
      }
    }

    return this.shape(dimensions, readings, trippedIndex, recorded, now);
  }

  inspect(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading> {
    const readings = dimensions.map((dimension) => this.read(dimension, now));
    const trippedIndex = firstTripped(dimensions, readings);
    return Promise.resolve(this.shape(dimensions, readings, trippedIndex, false, now));
  }

  forget(dimensions: readonly RateLimitDimension[]): Promise<void> {
    for (const dimension of dimensions) {
      this.hits.delete(dimension.key);
    }
    return Promise.resolve();
  }

  countDistinct(request: DistinctCountRequest): Promise<number> {
    const members = this.distinct.get(request.key) ?? new Map<string, number>();
    this.distinct.set(request.key, members);

    members.set(request.member, request.now);
    for (const [member, seenAt] of members) {
      if (seenAt <= request.now - request.windowMs) members.delete(member);
    }

    return Promise.resolve(members.size);
  }

  /** Hits currently inside `windowMs` of `now`. Test affordance, mirroring MemoryQuotaStore.usage. */
  count(key: string, windowMs: number, now: number): number {
    return (this.hits.get(key) ?? []).filter((score) => score > now - windowMs).length;
  }

  private read(dimension: RateLimitDimension, now: number): Reading {
    const scores = this.trim(dimension.key, dimension.rule.windowMs, now);
    const count = scores.length;
    // Index of the last entry that must age out before a slot frees. See toWindow.
    const releaseIndex = count - dimension.rule.limit;
    const releaseAt = count >= dimension.rule.limit ? (scores[releaseIndex] ?? -1) : -1;
    return { count, releaseAt };
  }

  private trim(key: string, windowMs: number, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((score) => score > now - windowMs);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  private push(key: string, now: number): void {
    const scores = this.hits.get(key) ?? [];
    scores.push(now);
    // A caller may hand back a clock that moved backwards (a corrected NTP step, or a test).
    // Redis keeps its set ordered regardless, so this must too or releaseAt picks the wrong
    // entry.
    scores.sort((a, b) => a - b);
    this.hits.set(key, scores);
  }

  private shape(
    dimensions: readonly RateLimitDimension[],
    readings: readonly Reading[],
    trippedIndex: number | null,
    recorded: boolean,
    now: number,
  ): RateLimitReading {
    const windows: RateLimitWindow[] = dimensions.map((dimension, index) => {
      const reading = readings[index] ?? { count: 0, releaseAt: -1 };
      return toWindow(dimension, reading.count, reading.releaseAt, recorded, now);
    });
    return { recorded, trippedIndex, windows };
  }
}

interface Reading {
  count: number;
  releaseAt: number;
}

function firstTripped(
  dimensions: readonly RateLimitDimension[],
  readings: readonly Reading[],
): number | null {
  for (let index = 0; index < dimensions.length; index += 1) {
    const dimension = dimensions[index];
    const reading = readings[index];
    if (!dimension || !reading) continue;
    // OBSERVE dimensions are measured and reported but never deny; D-030's annual quota is
    // enforced durably by Postgres, not by this short-window traffic shaper.
    if (dimension.rule.enforcement !== 'ENFORCE') continue;
    if (reading.count >= dimension.rule.limit) return index;
  }
  return null;
}
