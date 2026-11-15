import { redis } from '@devvit/web/server';
import { fetchScoredEvents, type DeckCache } from '../../shared/deck.ts';
import { DIFFICULTIES, type Difficulty } from '../../shared/difficulty.ts';
import {
  bandCounts,
  DAILY_DECK_LIMIT,
  DAILY_RETENTION_MS,
  dealLevel,
  dealQueue,
  enqueueEvents,
  hashSeed,
  mulberry32,
  parseEventList,
  parsePooledEvents,
  POOL_LIMIT,
  poolFilled,
  restack,
  type PooledEvent,
} from '../../shared/daily.ts';
import { type TimelineEvent } from '../../shared/timeline.ts';
import {
  createDaily,
  dailyDeckKey,
  type DailyGame,
  type DailyStore,
} from './daily.ts';

const cache: DeckCache = {
  get: (key) => redis.get(key),
  set: async (key, value, ttlMs) => {
    await redis.set(key, value, {
      expiration: new Date(Date.now() + ttlMs),
    });
  },
};

const store: DailyStore = {
  get: async (key) => {
    const value = await redis.get(key);
    return typeof value === 'string' ? value : undefined;
  },
  set: async (key, value, options) => {
    await redis.set(key, value, options);
  },
  del: async (...keys) => {
    if (keys.length === 0) return;
    await redis.del(...keys);
  },
  zAdd: async (key, member, score) => {
    await redis.zAdd(key, { member, score });
  },
  zRangeDesc: (key, start, stop) =>
    redis.zRange(key, start, stop, { reverse: true, by: 'rank' }),
  zRank: (key, member) => redis.zRank(key, member),
  zCard: (key) => redis.zCard(key),
  zScore: (key, member) => redis.zScore(key, member),
  expire: async (key, seconds) => {
    await redis.expire(key, seconds);
  },
};

const POOL_KEY = 'daily:v1:pool';
const POOL_DAYS_KEY = 'daily:v1:pool-days';
const POOL_LOCK_KEY = 'daily:v1:pool-lock';
const POOL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DAYS_PER_PASS = 4;

export type PoolFill = {
  filled: boolean;
  added: number;
  counts: Record<Difficulty, number>;
};

const dealtKey = (date: string): string => `daily:v1:dealt:${date}`;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const readDays = (raw: string | undefined): Set<string> => {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    const days = new Set<string>();
    for (const item of value) {
      if (typeof item === 'string' && /^\d{2}-\d{2}$/.test(item))
        days.add(item);
    }
    return days;
  } catch {
    return new Set();
  }
};

const readPool = async (): Promise<PooledEvent[]> => {
  const raw = await redis.get(POOL_KEY);
  if (!raw) return [];
  try {
    return parsePooledEvents(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
};

const readStoredDeck = async (
  date: string,
  difficulty: Difficulty
): Promise<TimelineEvent[] | null> => {
  const raw = await redis.get(dailyDeckKey(date, difficulty));
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = parseEventList(JSON.parse(raw), DAILY_DECK_LIMIT);
    if (!parsed || parsed.length < 2) return null;
    return parsed;
  } catch {
    return null;
  }
};

const fillResult = (queue: readonly PooledEvent[], added: number): PoolFill => {
  const counts = bandCounts(queue);
  return { filled: poolFilled(counts), added, counts };
};

/** Fetch one more slice of pages. A deal does not wait on this. */
export const warmPool = async (): Promise<PoolFill> => {
  const current = await readPool();
  if (poolFilled(bandCounts(current))) return fillResult(current, 0);
  const rawDays = await redis.get(POOL_DAYS_KEY);
  const seen = readDays(typeof rawDays === 'string' ? rawDays : undefined);
  let slice: { events: PooledEvent[]; days: string[] };
  try {
    slice = await fetchScoredEvents({
      cache,
      random: mulberry32(hashSeed(`father-timeline:pool:${seen.size}`)),
      days: DAYS_PER_PASS,
      avoidDays: seen,
    });
  } catch (error) {
    console.error('Pool growth failed', error);
    return fillResult(current, 0);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = await claimPool();
    if (!token) {
      await pause(100);
      continue;
    }
    try {
      const latest = await readPool();
      if (poolFilled(bandCounts(latest))) return fillResult(latest, 0);
      const queued = enqueueEvents(latest, slice.events, POOL_LIMIT);
      const previous = new Set(latest.map((event) => event.id));
      const added = queued.filter((event) => !previous.has(event.id)).length;
      const expiration = new Date(Date.now() + POOL_TTL_MS);
      await redis.set(POOL_KEY, JSON.stringify(queued), { expiration });
      await redis.set(POOL_DAYS_KEY, JSON.stringify([...seen, ...slice.days]), {
        expiration,
      });
      return fillResult(queued, added);
    } finally {
      await releasePool(token);
    }
  }
  return fillResult(await readPool(), 0);
};

const claimPool = async (): Promise<string | null> => {
  const token = crypto.randomUUID();
  await redis.set(POOL_LOCK_KEY, token, {
    nx: true,
    expiration: new Date(Date.now() + 30_000),
  });
  const held = await redis.get(POOL_LOCK_KEY);
  return held === token ? token : null;
};

const releasePool = async (token: string): Promise<void> => {
  const held = await redis.get(POOL_LOCK_KEY);
  if (held === token) await redis.del(POOL_LOCK_KEY);
};

const dealDay = async (
  date: string,
  difficulty: Difficulty
): Promise<TimelineEvent[]> => {
  const grown = await readPool();
  const dealt = dealQueue(
    grown,
    (level) => mulberry32(hashSeed(`father-timeline:${date}:${level}`)),
    DAILY_DECK_LIMIT
  );
  const deckExpiration = new Date(Date.now() + DAILY_RETENTION_MS);
  for (const level of DIFFICULTIES) {
    const cards = dealt.decks[level];
    if (cards.length < 2) continue;
    await redis.set(dailyDeckKey(date, level), JSON.stringify(cards), {
      nx: true,
      expiration: deckExpiration,
    });
  }
  const stored: Record<Difficulty, TimelineEvent[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  for (const level of DIFFICULTIES) {
    const saved = await readStoredDeck(date, level);
    if (saved) stored[level] = saved;
  }
  const used = stored.easy.length + stored.medium.length + stored.hard.length;
  if (used > 0) {
    await redis.set(POOL_KEY, JSON.stringify(restack(grown, stored)), {
      expiration: new Date(Date.now() + POOL_TTL_MS),
    });
    await redis.set(dealtKey(date), '1', { expiration: deckExpiration });
  }
  const finished = await readStoredDeck(date, difficulty);
  if (finished) return finished;
  throw new Error(
    `Only found ${dealt.decks[difficulty].length} ${difficulty} events`
  );
};

const reserveLevel = async (
  date: string,
  difficulty: Difficulty
): Promise<TimelineEvent[]> => {
  const ready = await readStoredDeck(date, difficulty);
  if (ready) return ready;
  const pool = await readPool();
  const avoid = new Set<string>();
  for (const level of DIFFICULTIES) {
    if (level === difficulty) continue;
    const stored = await readStoredDeck(date, level);
    for (const card of stored ?? []) avoid.add(card.id);
  }
  const random = mulberry32(hashSeed(`father-timeline:${date}:${difficulty}`));
  let cards = dealLevel(pool, difficulty, random, avoid);
  if (cards.length < 2) cards = dealLevel(pool, difficulty, random);
  if (cards.length < 2) {
    throw new Error(`Only found ${cards.length} ${difficulty} events`);
  }
  const deckExpiration = new Date(Date.now() + DAILY_RETENTION_MS);
  await redis.set(dailyDeckKey(date, difficulty), JSON.stringify(cards), {
    nx: true,
    expiration: deckExpiration,
  });
  const fresh = cards.filter((card) => !avoid.has(card.id));
  if (fresh.length > 0) {
    const rotated = restack(pool, {
      easy: difficulty === 'easy' ? fresh : [],
      medium: difficulty === 'medium' ? fresh : [],
      hard: difficulty === 'hard' ? fresh : [],
    });
    await redis.set(POOL_KEY, JSON.stringify(rotated), {
      expiration: new Date(Date.now() + POOL_TTL_MS),
    });
  }
  const stored = await readStoredDeck(date, difficulty);
  if (stored) return stored;
  return cards;
};

const dealReserved = async (
  date: string,
  difficulty: Difficulty
): Promise<TimelineEvent[]> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = await claimPool();
    if (!token) {
      const ready = await readStoredDeck(date, difficulty);
      if (ready) return ready;
      await pause(100);
      continue;
    }
    try {
      return await reserveLevel(date, difficulty);
    } finally {
      await releasePool(token);
    }
  }
  const last = await readStoredDeck(date, difficulty);
  if (last) return last;
  throw new Error(`Only found 0 ${difficulty} events`);
};

export const liveDaily = (): DailyGame =>
  createDaily({
    store,
    now: () => new Date(),
    id: () => crypto.randomUUID(),
    loadDeck: async (difficulty, date) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const ready = await readStoredDeck(date, difficulty);
        if (ready) return ready;
        const marked = await redis.get(dealtKey(date));
        if (typeof marked === 'string')
          return await dealReserved(date, difficulty);
        if ((await readPool()).length < 2) await warmPool();
        const token = await claimPool();
        if (!token) {
          await pause(250);
          continue;
        }
        try {
          const held = await readStoredDeck(date, difficulty);
          if (held) return held;
          const markedAgain = await redis.get(dealtKey(date));
          if (typeof markedAgain === 'string') {
            return await reserveLevel(date, difficulty);
          }
          return await dealDay(date, difficulty);
        } finally {
          await releasePool(token);
        }
      }
      const last = await readStoredDeck(date, difficulty);
      if (last) return last;
      throw new Error(`Only found 0 ${difficulty} events`);
    },
  });
