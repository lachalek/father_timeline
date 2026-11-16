import { DIFFICULTIES, type Difficulty } from '../../shared/difficulty.ts';
import {
  DAILY_DECK_LIMIT,
  DAILY_RETENTION_MS,
  copyEvent,
  dailyDateKey,
  isDailyDateKey,
  displayName,
  hideEvent,
  parseEventList,
  parsePlacedCards,
  settlePlacement,
  type BoardEntry,
  type DailyBoard,
  type DailyDoneResponse,
  type DailyFailure,
  type DailyOverview,
  type DailyPlacedResponse,
  type DailyPlayingResponse,
  type LevelStanding,
} from '../../shared/daily.ts';
import {
  isTimelineEvent,
  startGame,
  type PlacedCard,
  type PlayingState,
  type TimelineEvent,
} from '../../shared/timeline.ts';

export const dailyPostKey = (date: string): string => `daily:v1:post:${date}`;

export const postDateKey = (postId: string): string =>
  `daily:v1:post-date:${postId}`;

/** Leaderboards stay with the post after the next day’s post goes up. */
export const BOARD_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

export const dailyLockKey = (
  date: string,
  difficulty: Difficulty,
  userId: string
): string => `daily:v1:lock:${date}:${difficulty}:${userId}`;

export const dailyExpiration = (now: Date): Date =>
  new Date(now.getTime() + DAILY_RETENTION_MS);

export const boardExpiration = (now: Date): Date =>
  new Date(now.getTime() + BOARD_RETENTION_MS);

const boardRetentionSeconds = (): number =>
  Math.floor(BOARD_RETENTION_MS / 1000);

export const dailyDeckKey = (date: string, difficulty: Difficulty): string =>
  `daily:v1:deck:${date}:${difficulty}`;

const runKey = (date: string, difficulty: Difficulty, userId: string): string =>
  `daily:v1:run:${date}:${difficulty}:${userId}`;

const resultKey = (
  date: string,
  difficulty: Difficulty,
  userId: string
): string => `daily:v1:result:${date}:${difficulty}:${userId}`;

const boardKey = (date: string, difficulty: Difficulty): string =>
  `daily:v1:board:${date}:${difficulty}`;

const bestKey = (userId: string, difficulty: Difficulty): string =>
  `daily:v1:best:${userId}:${difficulty}`;

const nameKey = (userId: string): string => `daily:v1:name:${userId}`;

export type DailyScoreRow = {
  member: string;
  score: number;
};

export type DailySetOptions = {
  nx?: boolean;
  expiration?: Date;
};

export type DailyStore = {
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string, options?: DailySetOptions) => Promise<void>;
  del: (...keys: string[]) => Promise<void>;
  zAdd: (key: string, member: string, score: number) => Promise<void>;
  zRangeDesc: (
    key: string,
    start: number,
    stop: number
  ) => Promise<DailyScoreRow[]>;
  zRank: (key: string, member: string) => Promise<number | undefined>;
  zCard: (key: string) => Promise<number>;
  zScore: (key: string, member: string) => Promise<number | undefined>;
  expire: (key: string, seconds: number) => Promise<void>;
};

export type Player = {
  id: string;
  username: string;
};

export type DailyDeps = {
  store: DailyStore;
  now: () => Date;
  loadDeck: (
    difficulty: Difficulty,
    date: string
  ) => Promise<readonly TimelineEvent[]>;
  id: () => string;
};

type StoredRun = {
  placed: PlacedCard[];
  upcoming: TimelineEvent;
  queue: TimelineEvent[];
  score: number;
  lives: number;
  steps: number;
};

type StoredResult = {
  placed: PlacedCard[];
  score: number;
  lives: number;
  steps: number;
};

export type DailyGame = {
  overview: (player: Player | null, date?: string) => Promise<DailyOverview>;
  start: (
    player: Player,
    difficulty: Difficulty,
    date?: string
  ) => Promise<DailyPlayingResponse | DailyDoneResponse | DailyFailure>;
  place: (
    player: Player,
    difficulty: Difficulty,
    slot: number,
    date?: string
  ) => Promise<DailyPlacedResponse | DailyDoneResponse | DailyFailure>;
  ensureDeck: (difficulty: Difficulty) => Promise<readonly TimelineEvent[]>;
};

const readJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoredNumber = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= maximum;

const deckMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.startsWith('Only found')) {
    return 'Not enough pages landed for today’s deck.';
  }
  if (error instanceof Error && error.message.includes('pageviews')) {
    return 'Wikipedia didn’t answer, so today’s deck isn’t ready.';
  }
  return 'Today’s deck isn’t ready yet. Try again in a moment.';
};

const busy = (): DailyFailure => ({
  type: 'error',
  code: 'busy',
  message: 'That move is still saving. Try the gap again.',
});

const playingFrom = (
  date: string,
  difficulty: Difficulty,
  run: StoredRun
): DailyPlayingResponse => ({
  type: 'playing',
  date,
  difficulty,
  placed: run.placed,
  upcoming: hideEvent(run.upcoming),
  score: run.score,
  lives: run.lives,
  steps: run.steps,
});

export const createDaily = (deps: DailyDeps): DailyGame => {
  const { store } = deps;

  const claim = async (
    key: string,
    token: string,
    now: Date
  ): Promise<boolean> => {
    await store.set(key, token, {
      nx: true,
      expiration: new Date(now.getTime() + 30_000),
    });
    return (await store.get(key)) === token;
  };

  const release = async (key: string, token: string): Promise<void> => {
    if ((await store.get(key)) === token) await store.del(key);
  };

  const readRun = async (
    date: string,
    difficulty: Difficulty,
    userId: string
  ): Promise<StoredRun | null> => {
    const raw = await store.get(runKey(date, difficulty, userId));
    if (typeof raw !== 'string') return null;
    const value = readJson(raw);
    if (!isRecord(value) || !isTimelineEvent(value.upcoming)) return null;
    const placed = parsePlacedCards(value.placed);
    const queue = parseEventList(value.queue, DAILY_DECK_LIMIT);
    if (!placed || !queue) return null;
    if (
      !isStoredNumber(value.score, DAILY_DECK_LIMIT - 1) ||
      !isStoredNumber(value.lives, 3) ||
      !isStoredNumber(value.steps, DAILY_DECK_LIMIT - 1) ||
      value.steps < 1
    ) {
      return null;
    }
    return {
      placed,
      upcoming: copyEvent(value.upcoming),
      queue,
      score: value.score,
      lives: value.lives,
      steps: value.steps,
    };
  };

  const readResult = async (
    date: string,
    difficulty: Difficulty,
    userId: string
  ): Promise<StoredResult | null> => {
    const raw = await store.get(resultKey(date, difficulty, userId));
    if (typeof raw !== 'string') return null;
    const value = readJson(raw);
    if (!isRecord(value)) return null;
    const placed = parsePlacedCards(value.placed);
    if (!placed) return null;
    if (
      !isStoredNumber(value.score, DAILY_DECK_LIMIT - 1) ||
      !isStoredNumber(value.lives, 3) ||
      !isStoredNumber(value.steps, DAILY_DECK_LIMIT - 1) ||
      value.steps < 1
    ) {
      return null;
    }
    return {
      placed,
      score: value.score,
      lives: value.lives,
      steps: value.steps,
    };
  };

  const readBest = async (
    userId: string,
    difficulty: Difficulty
  ): Promise<number | null> => {
    const raw = await store.get(bestKey(userId, difficulty));
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
    const score = Number(raw);
    if (!isStoredNumber(score, DAILY_DECK_LIMIT - 1)) return null;
    return score;
  };

  const readBoard = async (
    date: string,
    difficulty: Difficulty,
    playerId: string | null
  ): Promise<DailyBoard> => {
    const key = boardKey(date, difficulty);
    const rows = await store.zRangeDesc(key, 0, 4);
    if (rows.length > 0) await store.expire(key, boardRetentionSeconds());
    const top: BoardEntry[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) continue;
      const stored = await store.get(nameKey(row.member));
      const score = Math.round(row.score);
      top.push({
        rank: index + 1,
        username: displayName(stored),
        score: isStoredNumber(score, DAILY_DECK_LIMIT - 1) ? score : 0,
        you: playerId !== null && row.member === playerId,
      });
    }
    if (!playerId) return { top, you: null };
    const index = await store.zRank(key, playerId);
    const total = await store.zCard(key);
    const rawScore = await store.zScore(key, playerId);
    if (index === undefined || rawScore === undefined || total <= 0) {
      return { top, you: null };
    }
    const score = Math.round(rawScore);
    const stored = await store.get(nameKey(playerId));
    return {
      top,
      you: {
        rank: total - index,
        username: displayName(stored),
        score: isStoredNumber(score, DAILY_DECK_LIMIT - 1) ? score : 0,
        you: true,
      },
    };
  };

  const readBests = async (
    userId: string
  ): Promise<Record<Difficulty, number | null>> => {
    const bests: Record<Difficulty, number | null> = {
      easy: null,
      medium: null,
      hard: null,
    };
    for (const difficulty of DIFFICULTIES) {
      bests[difficulty] = await readBest(userId, difficulty);
    }
    return bests;
  };

  const readBoards = async (
    date: string,
    playerId: string | null
  ): Promise<Record<Difficulty, DailyBoard>> => {
    const boards: Record<Difficulty, DailyBoard> = {
      easy: { top: [], you: null },
      medium: { top: [], you: null },
      hard: { top: [], you: null },
    };
    for (const difficulty of DIFFICULTIES) {
      boards[difficulty] = await readBoard(date, difficulty, playerId);
    }
    return boards;
  };

  const doneFrom = async (
    date: string,
    difficulty: Difficulty,
    player: Player,
    result: StoredResult
  ): Promise<DailyDoneResponse> => ({
    type: 'done',
    date,
    difficulty,
    placed: result.placed,
    score: result.score,
    lives: result.lives,
    steps: result.steps,
    bests: await readBests(player.id),
    boards: await readBoards(date, player.id),
  });

  const loadSharedDeck = async (
    date: string,
    difficulty: Difficulty
  ): Promise<TimelineEvent[]> => {
    const key = dailyDeckKey(date, difficulty);
    const raw = await store.get(key);
    const parsed =
      typeof raw === 'string'
        ? parseEventList(readJson(raw), DAILY_DECK_LIMIT)
        : null;
    if (parsed && parsed.length >= 2) return parsed;
    const events = await deps.loadDeck(difficulty, date);
    if (events.length < 2) {
      throw new Error(`Only found ${events.length} ${difficulty} events`);
    }
    const body = JSON.stringify(events.map((event) => copyEvent(event)));
    await store.set(key, body, {
      nx: typeof raw !== 'string',
      expiration: dailyExpiration(deps.now()),
    });
    const storedRaw = await store.get(key);
    const stored =
      typeof storedRaw === 'string'
        ? parseEventList(readJson(storedRaw), DAILY_DECK_LIMIT)
        : null;
    if (stored && stored.length >= 2) return stored;
    throw new Error(`Only found ${events.length} ${difficulty} events`);
  };

  const publish = async (
    date: string,
    difficulty: Difficulty,
    player: Player,
    result: StoredResult,
    now: Date
  ): Promise<void> => {
    const body = JSON.stringify(result);
    const key = resultKey(date, difficulty, player.id);
    await store.set(key, body, {
      nx: true,
      expiration: dailyExpiration(now),
    });
    if ((await store.get(key)) !== body) return;
    await store.set(nameKey(player.id), displayName(player.username));
    await store.zAdd(boardKey(date, difficulty), player.id, result.score);
    await store.expire(boardKey(date, difficulty), boardRetentionSeconds());
    const previous = await readBest(player.id, difficulty);
    if (previous === null || result.score > previous) {
      await store.set(bestKey(player.id, difficulty), String(result.score));
    }
  };

  const gameDate = (requested: string | undefined, now: Date): string =>
    requested !== undefined && isDailyDateKey(requested)
      ? requested
      : dailyDateKey(now);

  const overview = async (
    player: Player | null,
    requested?: string
  ): Promise<DailyOverview> => {
    const date = gameDate(requested, deps.now());
    const levels: Record<Difficulty, LevelStanding> = {
      easy: { played: false, score: null, best: null },
      medium: { played: false, score: null, best: null },
      hard: { played: false, score: null, best: null },
    };
    const boards = await readBoards(date, player?.id ?? null);
    if (player) {
      for (const difficulty of DIFFICULTIES) {
        const result = await readResult(date, difficulty, player.id);
        levels[difficulty] = {
          played: result !== null,
          score: result ? result.score : null,
          best: await readBest(player.id, difficulty),
        };
      }
    }
    return {
      type: 'daily',
      date,
      loggedIn: player !== null,
      levels,
      boards,
    };
  };

  const start = async (
    player: Player,
    difficulty: Difficulty,
    requested?: string
  ): Promise<DailyPlayingResponse | DailyDoneResponse | DailyFailure> => {
    const now = deps.now();
    const date = gameDate(requested, now);
    const finished = await readResult(date, difficulty, player.id);
    if (finished) return doneFrom(date, difficulty, player, finished);
    const existing = await readRun(date, difficulty, player.id);
    if (existing) return playingFrom(date, difficulty, existing);
    const token = deps.id();
    const lock = dailyLockKey(date, difficulty, player.id);
    if (!(await claim(lock, token, now))) return busy();
    try {
      const finishedAgain = await readResult(date, difficulty, player.id);
      if (finishedAgain)
        return doneFrom(date, difficulty, player, finishedAgain);
      const runAgain = await readRun(date, difficulty, player.id);
      if (runAgain) return playingFrom(date, difficulty, runAgain);
      const events = await loadSharedDeck(date, difficulty);
      const game = startGame(events);
      if (!game || game.phase !== 'playing') {
        return {
          type: 'error',
          code: 'deck',
          message: 'Not enough pages landed for today’s deck.',
        };
      }
      const run: StoredRun = {
        placed: game.placed,
        upcoming: game.upcoming,
        queue: game.queue,
        score: game.score,
        lives: game.lives,
        steps: events.length - 1,
      };
      await store.set(
        runKey(date, difficulty, player.id),
        JSON.stringify(run),
        {
          nx: true,
          expiration: dailyExpiration(now),
        }
      );
      const saved = await readRun(date, difficulty, player.id);
      if (!saved) {
        return {
          type: 'error',
          code: 'deck',
          message: 'Today’s deck isn’t ready yet. Try again in a moment.',
        };
      }
      return playingFrom(date, difficulty, saved);
    } catch (error) {
      console.error('Daily deck failed', error);
      return { type: 'error', code: 'deck', message: deckMessage(error) };
    } finally {
      await release(lock, token);
    }
  };

  const place = async (
    player: Player,
    difficulty: Difficulty,
    slot: number,
    requested?: string
  ): Promise<DailyPlacedResponse | DailyDoneResponse | DailyFailure> => {
    if (!Number.isInteger(slot) || slot < 0) {
      return {
        type: 'error',
        code: 'slot',
        message: 'That spot isn’t open.',
      };
    }
    const now = deps.now();
    const date = gameDate(requested, now);
    const finished = await readResult(date, difficulty, player.id);
    if (finished) return doneFrom(date, difficulty, player, finished);
    const token = deps.id();
    const lock = dailyLockKey(date, difficulty, player.id);
    if (!(await claim(lock, token, now))) return busy();
    try {
      const finishedAgain = await readResult(date, difficulty, player.id);
      if (finishedAgain)
        return doneFrom(date, difficulty, player, finishedAgain);
      const run = await readRun(date, difficulty, player.id);
      if (!run) {
        return {
          type: 'error',
          code: 'missing',
          message: 'Start today’s deck before placing a card.',
        };
      }
      const playing: PlayingState = {
        phase: 'playing',
        placed: run.placed,
        upcoming: run.upcoming,
        queue: run.queue,
        score: run.score,
        lives: run.lives,
        feedback: null,
      };
      const settled = settlePlacement(playing, slot);
      if (!settled) {
        return {
          type: 'error',
          code: 'slot',
          message: 'That spot isn’t open.',
        };
      }
      if (settled.next.phase === 'done') {
        const result: StoredResult = {
          placed: settled.next.placed,
          score: settled.next.score,
          lives: settled.next.lives,
          steps: run.steps,
        };
        await publish(date, difficulty, player, result, now);
        await store.del(runKey(date, difficulty, player.id));
        const official = await readResult(date, difficulty, player.id);
        if (!official) {
          return {
            type: 'error',
            code: 'deck',
            message: 'Today’s deck isn’t ready yet. Try again in a moment.',
          };
        }
        const ours = JSON.stringify(result);
        const saved = await store.get(resultKey(date, difficulty, player.id));
        if (saved !== ours) return doneFrom(date, difficulty, player, official);
        return {
          type: 'placed',
          feedback: settled.feedback,
          next: await doneFrom(date, difficulty, player, official),
        };
      }
      const nextRun: StoredRun = {
        placed: settled.next.placed,
        upcoming: settled.next.upcoming,
        queue: settled.next.queue,
        score: settled.next.score,
        lives: settled.next.lives,
        steps: run.steps,
      };
      await store.set(
        runKey(date, difficulty, player.id),
        JSON.stringify(nextRun),
        { expiration: dailyExpiration(now) }
      );
      const saved = await readRun(date, difficulty, player.id);
      if (!saved) {
        return {
          type: 'error',
          code: 'deck',
          message: 'Today’s deck isn’t ready yet. Try again in a moment.',
        };
      }
      return {
        type: 'placed',
        feedback: settled.feedback,
        next: playingFrom(date, difficulty, saved),
      };
    } finally {
      await release(lock, token);
    }
  };

  return {
    overview,
    start,
    place,
    ensureDeck: (difficulty) =>
      loadSharedDeck(dailyDateKey(deps.now()), difficulty),
  };
};
