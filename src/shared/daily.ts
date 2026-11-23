import {
  DIFFICULTIES,
  isDifficulty,
  matchesDifficulty,
  type Difficulty,
} from './difficulty.ts';
import {
  applyPlacement,
  isTimelineEvent,
  orderDeck,
  resolveFeedback,
  STARTING_LIVES,
  type DoneState,
  type PlacementFeedback,
  type PlacedCard,
  type PlayingState,
  type TimelineEvent,
} from './timeline.ts';

export const DAILY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/** Cards in one daily level. The opening card is free, so the top score is one less. */
export const DAILY_DECK_LIMIT = 300;

/** Scored pages kept so later days can reorder them instead of fetching again. */
export const POOL_LIMIT = 3000;

/** Pages kept on hand for one level, so a deal does not have to borrow another band. */
export const BAND_MINIMUM = 600;

export const DAILY_LOGIN_MESSAGE = 'Log in with Reddit to play today’s deck.';

/**
 * The unplayed card's year stays on the server.
 * This stand-in is never shown; the card says "Year hidden" until the guess lands.
 */
export const HIDDEN_YEAR = 0;

export const dailyDateKey = (now: Date): string => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export type DailyPublishWindow = 'publish' | 'catch-up' | 'skip';

const easternPart = (now: Date, type: Intl.DateTimeFormatPartTypes): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(parsed) ? parsed : -1;
};

/**
 * Devvit cron is UTC. 6:00am America/New_York is 10:00 UTC in daylight time
 * and 11:00 UTC in standard time, so the daily job wakes at both hours.
 * Hour 7 only covers a 6:00 run that arrived late.
 */
export const dailyPublishWindow = (now: Date): DailyPublishWindow => {
  const hour = easternPart(now, 'hour');
  if (hour === 6) return 'publish';
  if (hour === 7) return 'catch-up';
  return 'skip';
};

export const formatDailyDate = (key: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

export const hashSeed = (text: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const displayName = (username: string | undefined): string => {
  if (!username) return 'player';
  if (/^[A-Za-z0-9_-]{2,32}$/.test(username)) return username;
  return 'player';
};

export const ordinal = (rank: number): string => {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const mod10 = rank % 10;
  if (mod10 === 1) return `${rank}st`;
  if (mod10 === 2) return `${rank}nd`;
  if (mod10 === 3) return `${rank}rd`;
  return `${rank}th`;
};

/** How far through the eight placements this run has gotten, from 0 to 1. */
export const placementProgress = (placed: number, steps: number): number => {
  if (steps <= 0) return 1;
  const value = (placed - 1) / steps;
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

export type HiddenEvent = {
  id: string;
  text: string;
  title: string;
  article: string;
  url: string;
  kind: TimelineEvent['kind'];
};

export const copyEvent = (event: TimelineEvent): TimelineEvent => ({
  id: event.id,
  year: event.year,
  text: event.text,
  title: event.title,
  article: event.article,
  url: event.url,
  kind: event.kind,
});

export const hideEvent = (event: TimelineEvent): HiddenEvent => ({
  id: event.id,
  text: event.text,
  title: event.title,
  article: event.article,
  url: event.url,
  kind: event.kind,
});

export type PooledEvent = TimelineEvent & {
  views: number;
};

/** Easy continues into medium, then hard. Medium continues into hard. */
const FILL_ORDER: Record<Difficulty, readonly Difficulty[]> = {
  easy: ['easy', 'medium', 'hard'],
  medium: ['medium', 'hard'],
  hard: ['hard'],
};

const bandOf = (views: number): Difficulty | null => {
  if (matchesDifficulty(views, 'easy')) return 'easy';
  if (matchesDifficulty(views, 'medium')) return 'medium';
  if (matchesDifficulty(views, 'hard')) return 'hard';
  return null;
};

export const bandCounts = (
  queue: readonly PooledEvent[]
): Record<Difficulty, number> => {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const event of queue) {
    const band = bandOf(event.views);
    if (band) counts[band] += 1;
  }
  return counts;
};

export const poolFilled = (
  counts: Record<Difficulty, number>,
  minimum = BAND_MINIMUM
): boolean => DIFFICULTIES.every((band) => counts[band] >= minimum);

/**
 * Index 0 is the beginning of the stack, and the next page to deal.
 * New pages are inserted there. Pages from a finished day go after
 * anything that has not been dealt yet: the last timeline card first,
 * and the opening card last, because everyone already saw that one.
 */
export const enqueueEvents = (
  queue: readonly PooledEvent[],
  extra: readonly PooledEvent[],
  cap = POOL_LIMIT,
  minimum = BAND_MINIMUM
): PooledEvent[] => {
  const seen = new Set(queue.map((event) => event.id));
  const fresh: PooledEvent[] = [];
  for (const event of extra) {
    if (seen.has(event.id) || bandOf(event.views) === null) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  const next = [...fresh, ...queue];
  const counts = bandCounts(next);
  while (next.length > cap) {
    let dropAt = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const event = next[index];
      const band = event ? bandOf(event.views) : null;
      if (band && counts[band] > minimum) {
        dropAt = index;
        break;
      }
    }
    if (dropAt < 0) dropAt = next.length - 1;
    const dropped = next[dropAt];
    const band = dropped ? bandOf(dropped.views) : null;
    if (band) counts[band] -= 1;
    next.splice(dropAt, 1);
  }
  return next;
};

export const restack = (
  queue: readonly PooledEvent[],
  decks: Record<Difficulty, readonly TimelineEvent[]>
): PooledEvent[] => {
  const byId = new Map(queue.map((event) => [event.id, event]));
  const usedIds = new Set<string>();
  for (const difficulty of DIFFICULTIES) {
    for (const card of decks[difficulty]) usedIds.add(card.id);
  }
  const waiting = queue.filter((event) => !usedIds.has(event.id));
  const recycled: PooledEvent[] = [];
  const longest = Math.max(
    0,
    ...DIFFICULTIES.map((difficulty) => decks[difficulty].length)
  );
  for (let index = longest - 1; index >= 0; index -= 1) {
    for (const difficulty of DIFFICULTIES) {
      const card = decks[difficulty][index];
      const pooled = card ? byId.get(card.id) : undefined;
      if (pooled) recycled.push(pooled);
    }
  }
  return [...waiting, ...recycled];
};

const takeFromFront = (
  queue: readonly PooledEvent[],
  band: Difficulty,
  usedYears: ReadonlySet<number>,
  usedArticles: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
  room: number
): PooledEvent[] => {
  const picked: PooledEvent[] = [];
  const claimedYears = new Set<number>();
  const claimedArticles = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    if (picked.length >= room) break;
    const event = queue[index];
    if (event === undefined) continue;
    if (
      usedIds.has(event.id) ||
      usedYears.has(event.year) ||
      claimedYears.has(event.year)
    ) {
      continue;
    }
    const article = event.article;
    if (
      article.length > 0 &&
      (usedArticles.has(article) || claimedArticles.has(article))
    ) {
      continue;
    }
    if (!matchesDifficulty(event.views, band)) continue;
    claimedYears.add(event.year);
    if (article.length > 0) claimedArticles.add(article);
    picked.push(event);
  }
  return picked;
};

export type QueueDeal = {
  decks: Record<Difficulty, TimelineEvent[]>;
  queue: PooledEvent[];
};

/**
 * Each level takes its own band first, up to the daily limit.
 * Only the pages left after that can be borrowed: Medium from Hard,
 * then Easy from Medium and Hard.
 * The opening card is a middle year. The rest follows that day's seed.
 */
export const dealQueue = (
  queue: readonly PooledEvent[],
  randomFor: (difficulty: Difficulty) => () => number,
  limit = DAILY_DECK_LIMIT
): QueueDeal => {
  const usedIds = new Set<string>();
  const chosen: Record<Difficulty, PooledEvent[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  const take = (difficulty: Difficulty, band: Difficulty) => {
    const picked = chosen[difficulty];
    const usedYears = new Set(picked.map((event) => event.year));
    const usedArticles = new Set(
      picked
        .map((event) => event.article)
        .filter((article) => article.length > 0)
    );
    const room = limit - picked.length;
    if (room <= 0) return;
    for (const event of takeFromFront(
      queue,
      band,
      usedYears,
      usedArticles,
      usedIds,
      room
    )) {
      usedIds.add(event.id);
      picked.push(event);
    }
  };
  for (const difficulty of DIFFICULTIES) take(difficulty, difficulty);
  for (const band of FILL_ORDER.medium) {
    if (band === 'medium') continue;
    take('medium', band);
  }
  for (const band of FILL_ORDER.easy) {
    if (band === 'easy') continue;
    take('easy', band);
  }
  const decks: Record<Difficulty, TimelineEvent[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  for (const difficulty of DIFFICULTIES) {
    decks[difficulty] = orderDeck(
      chosen[difficulty].map((event) => copyEvent(event)),
      randomFor(difficulty)
    );
  }
  return { decks, queue: restack(queue, decks) };
};

/** One level, from its own band, skipping pages already given to another deck. */
export const dealLevel = (
  queue: readonly PooledEvent[],
  difficulty: Difficulty,
  random: () => number,
  avoidIds: ReadonlySet<string> = new Set(),
  limit = DAILY_DECK_LIMIT
): TimelineEvent[] =>
  orderDeck(
    takeFromFront(queue, difficulty, new Set(), new Set(), avoidIds, limit).map(
      (event) => copyEvent(event)
    ),
    random
  );

export const parsePooledEvents = (value: unknown): PooledEvent[] | null => {
  if (!Array.isArray(value)) return null;
  const events: PooledEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { views } = item;
    if (typeof views !== 'number' || !Number.isInteger(views) || views < 0) {
      return null;
    }
    if (!isTimelineEvent(item)) return null;
    events.push({ ...copyEvent(item), views });
  }
  return events;
};

export type BoardEntry = {
  rank: number;
  username: string;
  score: number;
  you: boolean;
};

export type DailyBoard = {
  top: BoardEntry[];
  you: BoardEntry | null;
};

export type LevelStanding = {
  played: boolean;
  score: number | null;
  best: number | null;
};

export type DailyOverview = {
  type: 'daily';
  date: string;
  loggedIn: boolean;
  levels: Record<Difficulty, LevelStanding>;
  boards: Record<Difficulty, DailyBoard>;
};

export type DailyPlayingResponse = {
  type: 'playing';
  date: string;
  difficulty: Difficulty;
  placed: PlacedCard[];
  upcoming: HiddenEvent;
  score: number;
  lives: number;
  steps: number;
};

export type DailyDoneResponse = {
  type: 'done';
  date: string;
  difficulty: Difficulty;
  placed: PlacedCard[];
  score: number;
  lives: number;
  steps: number;
  bests: Record<Difficulty, number | null>;
  boards: Record<Difficulty, DailyBoard>;
};

export type DailyPlacedResponse = {
  type: 'placed';
  feedback: PlacementFeedback;
  next: DailyPlayingResponse | DailyDoneResponse;
};

export type DailyFailureCode = 'login' | 'busy' | 'deck' | 'slot' | 'missing';

export type DailyFailure = {
  type: 'error';
  code: DailyFailureCode;
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isDailyDateKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isDateKey = isDailyDateKey;

const isScore = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= DAILY_DECK_LIMIT - 1;

const isLives = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= STARTING_LIVES;

const isSteps = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= DAILY_DECK_LIMIT - 1;

const isYear = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > -100000 &&
  value < 100000;

const isSlot = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= DAILY_DECK_LIMIT;

const isFailureCode = (value: unknown): value is DailyFailureCode =>
  value === 'login' ||
  value === 'busy' ||
  value === 'deck' ||
  value === 'slot' ||
  value === 'missing';

export const parsePlacedCards = (value: unknown): PlacedCard[] | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > DAILY_DECK_LIMIT
  ) {
    return null;
  }
  const placed: PlacedCard[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isTimelineEvent(item.event)) return null;
    let hit: boolean | null;
    if (item.hit === null) hit = null;
    else if (item.hit === true || item.hit === false) hit = item.hit;
    else return null;
    placed.push({ event: copyEvent(item.event), hit });
  }
  return placed;
};

export const parseEventList = (
  value: unknown,
  maximum: number
): TimelineEvent[] | null => {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const events: TimelineEvent[] = [];
  for (const item of value) {
    if (!isTimelineEvent(item)) return null;
    events.push(copyEvent(item));
  }
  return events;
};

const parseHiddenEvent = (value: unknown): HiddenEvent | null => {
  if (!isRecord(value)) return null;
  const { id, text, title, article, url, kind } = value;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof text !== 'string' ||
    text.length === 0 ||
    typeof title !== 'string' ||
    title.length === 0 ||
    typeof article !== 'string' ||
    typeof url !== 'string' ||
    (kind !== 'event' && kind !== 'birth')
  ) {
    return null;
  }
  return { id, text, title, article, url, kind };
};

const parseFeedback = (value: unknown): PlacementFeedback | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.hit !== 'boolean' ||
    !isSlot(value.slot) ||
    !isSlot(value.correct) ||
    !isYear(value.year)
  ) {
    return null;
  }
  return {
    hit: value.hit,
    slot: value.slot,
    correct: value.correct,
    year: value.year,
  };
};

const parseEntry = (value: unknown): BoardEntry | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.rank !== 'number' ||
    !Number.isInteger(value.rank) ||
    value.rank < 1 ||
    value.rank > 100000
  ) {
    return null;
  }
  if (
    typeof value.username !== 'string' ||
    value.username.length === 0 ||
    value.username.length > 32
  ) {
    return null;
  }
  if (!isScore(value.score) || typeof value.you !== 'boolean') return null;
  return {
    rank: value.rank,
    username: value.username,
    score: value.score,
    you: value.you,
  };
};

const parseBoard = (value: unknown): DailyBoard | null => {
  if (!isRecord(value) || !Array.isArray(value.top) || value.top.length > 5) {
    return null;
  }
  const top: BoardEntry[] = [];
  for (const item of value.top) {
    const entry = parseEntry(item);
    if (!entry) return null;
    top.push(entry);
  }
  if (value.you === null) return { top, you: null };
  const you = parseEntry(value.you);
  if (!you) return null;
  return { top, you };
};

const parseBests = (
  value: unknown
): Record<Difficulty, number | null> | null => {
  if (!isRecord(value)) return null;
  const bests: Record<Difficulty, number | null> = {
    easy: null,
    medium: null,
    hard: null,
  };
  for (const difficulty of DIFFICULTIES) {
    const score = value[difficulty];
    if (score === null) continue;
    if (!isScore(score)) return null;
    bests[difficulty] = score;
  }
  return bests;
};

const parseLevels = (
  value: unknown
): Record<Difficulty, LevelStanding> | null => {
  if (!isRecord(value)) return null;
  const levels: Record<Difficulty, LevelStanding> = {
    easy: { played: false, score: null, best: null },
    medium: { played: false, score: null, best: null },
    hard: { played: false, score: null, best: null },
  };
  for (const difficulty of DIFFICULTIES) {
    const standing = value[difficulty];
    if (!isRecord(standing) || typeof standing.played !== 'boolean')
      return null;
    if (standing.score !== null && !isScore(standing.score)) return null;
    if (standing.best !== null && !isScore(standing.best)) return null;
    levels[difficulty] = {
      played: standing.played,
      score: standing.score,
      best: standing.best,
    };
  }
  return levels;
};

const parseBoards = (value: unknown): Record<Difficulty, DailyBoard> | null => {
  if (!isRecord(value)) return null;
  const boards: Record<Difficulty, DailyBoard> = {
    easy: { top: [], you: null },
    medium: { top: [], you: null },
    hard: { top: [], you: null },
  };
  for (const difficulty of DIFFICULTIES) {
    const board = parseBoard(value[difficulty]);
    if (!board) return null;
    boards[difficulty] = board;
  }
  return boards;
};

export const parseDailyOverview = (value: unknown): DailyOverview | null => {
  if (!isRecord(value) || value.type !== 'daily' || !isDateKey(value.date)) {
    return null;
  }
  if (typeof value.loggedIn !== 'boolean') return null;
  const levels = parseLevels(value.levels);
  const boards = parseBoards(value.boards);
  if (!levels || !boards) return null;
  return {
    type: 'daily',
    date: value.date,
    loggedIn: value.loggedIn,
    levels,
    boards,
  };
};

export const parseDailyPlaying = (
  value: unknown
): DailyPlayingResponse | null => {
  if (
    !isRecord(value) ||
    value.type !== 'playing' ||
    !isDateKey(value.date) ||
    !isDifficulty(value.difficulty)
  ) {
    return null;
  }
  const placed = parsePlacedCards(value.placed);
  const upcoming = parseHiddenEvent(value.upcoming);
  if (!placed || !upcoming || !isScore(value.score) || !isLives(value.lives)) {
    return null;
  }
  if (!isSteps(value.steps)) return null;
  return {
    type: 'playing',
    date: value.date,
    difficulty: value.difficulty,
    placed,
    upcoming,
    score: value.score,
    lives: value.lives,
    steps: value.steps,
  };
};

export const parseDailyDone = (value: unknown): DailyDoneResponse | null => {
  if (
    !isRecord(value) ||
    value.type !== 'done' ||
    !isDateKey(value.date) ||
    !isDifficulty(value.difficulty)
  ) {
    return null;
  }
  const placed = parsePlacedCards(value.placed);
  const bests = parseBests(value.bests);
  const boards = parseBoards(value.boards);
  if (!placed || !bests || !boards) return null;
  if (!isScore(value.score) || !isLives(value.lives) || !isSteps(value.steps)) {
    return null;
  }
  return {
    type: 'done',
    date: value.date,
    difficulty: value.difficulty,
    placed,
    score: value.score,
    lives: value.lives,
    steps: value.steps,
    bests,
    boards,
  };
};

export const parseDailyPlaced = (
  value: unknown
): DailyPlacedResponse | null => {
  if (!isRecord(value) || value.type !== 'placed') return null;
  const feedback = parseFeedback(value.feedback);
  const next = parseDailyPlaying(value.next) ?? parseDailyDone(value.next);
  if (!feedback || !next) return null;
  return { type: 'placed', feedback, next };
};

export const parseDailyFailure = (value: unknown): DailyFailure | null => {
  if (
    !isRecord(value) ||
    value.type !== 'error' ||
    !isFailureCode(value.code)
  ) {
    return null;
  }
  if (typeof value.message !== 'string' || value.message.length === 0)
    return null;
  return { type: 'error', code: value.code, message: value.message };
};

export const playingStateFromDaily = (
  response: DailyPlayingResponse
): PlayingState => ({
  phase: 'playing',
  placed: response.placed,
  upcoming: { ...response.upcoming, year: HIDDEN_YEAR },
  queue: [],
  score: response.score,
  lives: response.lives,
  feedback: null,
});

export const doneStateFromDaily = (response: DailyDoneResponse): DoneState => ({
  phase: 'done',
  placed: response.placed,
  score: response.score,
  lives: response.lives,
});

/**
 * Applies one guess and deals the next card.
 * A fixed daily deck ends when the last card lands or the hourglasses run out.
 */
export const settlePlacement = (
  state: PlayingState,
  slot: number
): { feedback: PlacementFeedback; next: PlayingState | DoneState } | null => {
  if (state.feedback) return null;
  const marked = applyPlacement(state, slot);
  if (!marked.feedback) return null;
  const resolved = resolveFeedback(marked);
  if (resolved.phase === 'waiting') {
    return {
      feedback: marked.feedback,
      next: {
        phase: 'done',
        placed: resolved.placed,
        score: resolved.score,
        lives: resolved.lives,
      },
    };
  }
  return { feedback: marked.feedback, next: resolved };
};
