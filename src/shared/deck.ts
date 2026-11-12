import { matchesDifficulty, type Difficulty } from './difficulty.ts';
import {
  pageviewKey,
  pageviewQueryUrl,
  parsePageviewQuery,
} from './pageviews.ts';
import {
  DECK_SIZE,
  MIN_DECK_SIZE,
  selectDeck,
  type TimelineEvent,
} from './timeline.ts';
import { parseCachedEvents, parseOnThisDay } from './wikipedia.ts';

const USER_AGENT =
  'TimelineGuesser/1.0 (Reddit Devvit game; educational; +https://developers.reddit.com)';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const VIEWS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A day lists dozens of events and hundreds of births. Sample across the day. */
const SAMPLED_PER_DAY = 20;
const REQUEST_TIMEOUT_MS = 4_000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export type DeckCache = {
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string, ttlMs: number) => Promise<void>;
};

export type Day = {
  month: string;
  day: string;
};

export const pickDays = (
  count: number,
  random: () => number,
  avoid?: ReadonlySet<string>
): Day[] => {
  const picked: Day[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (picked.length < count && guard < 80) {
    guard += 1;
    const monthIndex = Math.floor(random() * DAYS_IN_MONTH.length);
    const days = DAYS_IN_MONTH[monthIndex] ?? 28;
    const dayNumber = 1 + Math.floor(random() * days);
    const key = `${String(monthIndex + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
    if (seen.has(key) || avoid?.has(key)) continue;
    seen.add(key);
    picked.push({
      month: String(monthIndex + 1).padStart(2, '0'),
      day: String(dayNumber).padStart(2, '0'),
    });
  }
  return picked;
};

const remember = async (
  cache: DeckCache | undefined,
  key: string,
  value: string,
  ttlMs: number
): Promise<void> => {
  if (!cache) return;
  try {
    await cache.set(key, value, ttlMs);
  } catch (error) {
    console.error('Timeline cache write failed', error);
  }
};

const readCache = async (
  cache: DeckCache | undefined,
  key: string
): Promise<TimelineEvent[] | null> => {
  if (!cache) return null;
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    return parseCachedEvents(raw);
  } catch (error) {
    console.error('Timeline cache read failed', error);
    return null;
  }
};

const fetchJson = async (
  fetchImpl: typeof fetch,
  url: string
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': USER_AGENT,
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const loadDay = async (
  fetchImpl: typeof fetch,
  cache: DeckCache | undefined,
  type: 'events' | 'births',
  day: Day
): Promise<TimelineEvent[]> => {
  const key = `timeline:wiki:v3:${type}:${day.month}-${day.day}`;
  const cached = await readCache(cache, key);
  if (cached) return cached;
  const kind = type === 'events' ? 'event' : 'birth';
  try {
    const response = await fetchJson(
      fetchImpl,
      `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${day.month}/${day.day}`
    );
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const events = parseOnThisDay(payload, kind);
    if (events.length > 0) {
      await remember(cache, key, JSON.stringify(events), CACHE_TTL_MS);
    }
    return events;
  } catch (error) {
    console.error(`Wikipedia ${type} ${day.month}/${day.day} failed`, error);
    return [];
  }
};

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const viewsKey = (article: string): string =>
  `timeline:views:v2:${encodeURIComponent(article)}`;

const readViews = async (
  cache: DeckCache | undefined,
  article: string
): Promise<number | undefined> => {
  if (!cache) return undefined;
  try {
    const raw = await cache.get(viewsKey(article));
    if (raw && /^\d+$/.test(raw)) return Number(raw);
  } catch (error) {
    console.error('Timeline views cache read failed', error);
  }
  return undefined;
};

const fetchViewBatch = async (
  fetchImpl: typeof fetch,
  articles: readonly string[]
): Promise<Map<string, number> | null> => {
  const url = pageviewQueryUrl(articles);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchJson(fetchImpl, url);
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          await pause(200);
          continue;
        }
        return null;
      }
      if (!response.ok) return null;
      return parsePageviewQuery(await response.json());
    } catch (error) {
      console.error('Pageview batch failed', error);
      if (attempt === 0) {
        await pause(200);
        continue;
      }
      return null;
    }
  }
  return null;
};

/** Evenly spaced picks, so the head of a long day does not hide the tail. */
const spread = <T>(items: readonly T[], count: number): T[] => {
  if (items.length <= count) return [...items];
  const picked: T[] = [];
  const used = new Set<number>();
  const last = items.length - 1;
  for (let step = 0; step < count; step += 1) {
    const index = Math.round((step * last) / (count - 1));
    if (used.has(index)) continue;
    used.add(index);
    const item = items[index];
    if (item !== undefined) picked.push(item);
  }
  return picked;
};

const matchedEvents = (
  events: readonly TimelineEvent[],
  views: ReadonlyMap<string, number | null>,
  difficulty: Difficulty,
  excludeYears: ReadonlySet<number>
): TimelineEvent[] =>
  events.filter((event) => {
    if (!event.article || excludeYears.has(event.year)) return false;
    const count = views.get(event.article);
    return (
      count !== undefined &&
      count !== null &&
      matchesDifficulty(count, difficulty)
    );
  });

const sampleArticles = (
  events: readonly TimelineEvent[],
  views: ReadonlyMap<string, number | null>,
  excludeYears: ReadonlySet<number>
): string[] => {
  const candidates = events.filter(
    (event) => event.article.length > 0 && !excludeYears.has(event.year)
  );
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const event of spread(candidates, SAMPLED_PER_DAY)) {
    if (views.has(event.article) || seen.has(event.article)) continue;
    seen.add(event.article);
    missing.push(event.article);
  }
  return missing;
};

export const fetchDeck = async (options: {
  difficulty: Difficulty;
  random?: () => number;
  cache?: DeckCache;
  fetch?: typeof fetch;
  /** Stop once this many matching years are in hand. */
  target?: number;
  /** Smallest deck that is still worth returning. */
  minimum?: number;
  /** Event days to try before giving the cards already found. */
  maxDays?: number;
  excludeYears?: ReadonlySet<number>;
  /** Return as soon as `minimum` cards are ready, instead of waiting for `target`. */
  stopEarly?: boolean;
}): Promise<TimelineEvent[]> => {
  const random = options.random ?? Math.random;
  const fetchImpl = options.fetch ?? fetch;
  const target = options.target ?? DECK_SIZE;
  const minimum = options.minimum ?? MIN_DECK_SIZE;
  const maxDays = options.maxDays ?? 2;
  const goal = options.stopEarly ? minimum : target;
  const excludeYears = options.excludeYears ?? new Set<number>();
  const chosen: Day[] = [];
  const pool: TimelineEvent[] = [];
  const views = new Map<string, number | null>();

  const scoreDay = async (
    day: Day,
    type: 'events' | 'births'
  ): Promise<void> => {
    const loaded = await loadDay(fetchImpl, options.cache, type, day);
    pool.push(...loaded);
    const missing: string[] = [];
    for (const article of sampleArticles(loaded, views, excludeYears)) {
      const cached = await readViews(options.cache, article);
      if (cached === undefined) {
        missing.push(article);
        continue;
      }
      views.set(article, cached);
    }
    if (missing.length === 0) return;
    const scored = await fetchViewBatch(fetchImpl, missing);
    for (const article of missing) {
      const pace = scored?.get(pageviewKey(article));
      if (pace === undefined) {
        views.set(article, null);
        continue;
      }
      views.set(article, pace);
      await remember(
        options.cache,
        viewsKey(article),
        String(pace),
        VIEWS_TTL_MS
      );
    }
  };

  const ready = (): number =>
    new Set(
      matchedEvents(pool, views, options.difficulty, excludeYears).map(
        (event) => event.year
      )
    ).size;

  const chosenKeys = (): Set<string> =>
    new Set(chosen.map((day) => `${day.month}-${day.day}`));

  while (chosen.length < maxDays && ready() < goal) {
    const days = pickDays(1, random, chosenKeys());
    const day = days[0];
    if (!day) break;
    chosen.push(day);
    await scoreDay(day, 'events');
  }

  if (ready() < minimum) {
    for (const day of chosen) {
      if (ready() >= minimum) break;
      await scoreDay(day, 'births');
    }
  }

  const matched = matchedEvents(pool, views, options.difficulty, excludeYears);
  const deck = selectDeck(matched, target, random);
  if (deck.length < minimum) {
    const scored = [...views.values()].filter((count) => count !== null).length;
    const failed = [...views.values()].filter((count) => count === null).length;
    if (failed > 0 && scored < minimum) {
      throw new Error('Wikipedia pageviews did not answer');
    }
    throw new Error(`Only found ${deck.length} ${options.difficulty} events`);
  }
  return deck;
};
