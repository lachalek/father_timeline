import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bandCounts,
  DAILY_DECK_LIMIT,
  dailyDateKey,
  dailyPublishWindow,
  dealQueue,
  displayName,
  enqueueEvents,
  formatDailyDate,
  hashSeed,
  mulberry32,
  parseDailyDone,
  parseDailyOverview,
  placementProgress,
  poolFilled,
  settlePlacement,
  type PooledEvent,
} from '../../shared/daily.ts';
import { type Difficulty } from '../../shared/difficulty.ts';
import {
  correctSlotIndex,
  startGame,
  type TimelineEvent,
} from '../../shared/timeline.ts';
import {
  createDaily,
  dailyLockKey,
  type DailyGame,
  type DailySetOptions,
  type DailyStore,
  type Player,
} from './daily.ts';

const event = (year: number): TimelineEvent => ({
  id: `event:${year}`,
  year,
  title: `Year ${year}`,
  article: `Year_${year}`,
  text: 'A page from the archive, with the date kept off the card.',
  url: `https://en.wikipedia.org/wiki/Year_${year}`,
  kind: 'event',
});

const deck = (): TimelineEvent[] =>
  [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800].map((year) =>
    event(year)
  );

const memoryStore = (): DailyStore => {
  const values = new Map<string, string>();
  const boards = new Map<string, Map<string, number>>();
  const byMember = (left: string, right: string): number => {
    if (left < right) return -1;
    if (right < left) return 1;
    return 0;
  };
  const ranked = (
    board: Map<string, number>,
    direction: 'asc' | 'desc'
  ): [string, number][] =>
    [...board.entries()].sort((left, right) => {
      if (left[1] !== right[1]) {
        return direction === 'asc' ? left[1] - right[1] : right[1] - left[1];
      }
      return direction === 'asc'
        ? byMember(left[0], right[0])
        : byMember(right[0], left[0]);
    });

  return {
    async get(key) {
      return values.get(key);
    },
    async set(key, value, options?: DailySetOptions) {
      if (options?.nx && values.has(key)) return;
      values.set(key, value);
    },
    async del(...keys) {
      for (const key of keys) values.delete(key);
    },
    async zAdd(key, member, score) {
      const board = boards.get(key) ?? new Map<string, number>();
      board.set(member, score);
      boards.set(key, board);
    },
    async zRangeDesc(key, start, stop) {
      const board = boards.get(key);
      if (!board) return [];
      return ranked(board, 'desc')
        .slice(start, stop + 1)
        .map(([member, score]) => ({ member, score }));
    },
    async zRank(key, member) {
      const board = boards.get(key);
      if (!board || !board.has(member)) return undefined;
      const index = ranked(board, 'asc').findIndex(([name]) => name === member);
      return index < 0 ? undefined : index;
    },
    async zCard(key) {
      return boards.get(key)?.size ?? 0;
    },
    async zScore(key, member) {
      return boards.get(key)?.get(member);
    },
    async expire() {
      return undefined;
    },
  };
};

const player = (id: string): Player => ({ id, username: id });

const harness = (now = new Date(Date.UTC(2026, 10, 14, 15))) => {
  const store = memoryStore();
  const events = deck();
  let calls = 0;
  let clock = now;
  let tokens = 0;
  const game = createDaily({
    store,
    now: () => clock,
    id: () => {
      tokens += 1;
      return `lock-${tokens}`;
    },
    loadDeck: async () => {
      calls += 1;
      return events;
    },
  });
  return {
    store,
    game,
    events,
    calls: () => calls,
    setNow: (next: Date) => {
      clock = next;
    },
  };
};

const playOut = async (
  game: DailyGame,
  who: Player,
  events: readonly TimelineEvent[],
  misses: number
): Promise<void> => {
  const started = await game.start(who, 'easy');
  assert.equal(started.type, 'playing');
  if (started.type !== 'playing') return;
  const upcoming: unknown = JSON.parse(JSON.stringify(started.upcoming));
  assert.equal(
    typeof upcoming === 'object' &&
      upcoming !== null &&
      Object.hasOwn(upcoming, 'year'),
    false
  );
  let local = startGame(events);
  if (!local || local.phase !== 'playing') {
    assert.fail('deck did not deal');
  }
  let missesLeft = misses;
  for (
    let guard = 0;
    guard < DAILY_DECK_LIMIT && local.phase === 'playing';
    guard += 1
  ) {
    const correct = correctSlotIndex(
      local.placed.map((card) => card.event),
      local.upcoming.year
    );
    const slot = missesLeft > 0 ? (correct === 0 ? 1 : 0) : correct;
    if (missesLeft > 0) missesLeft -= 1;
    const settled = settlePlacement(local, slot);
    if (!settled) assert.fail('local placement was rejected');
    const remote = await game.place(who, 'easy', slot);
    assert.equal(remote.type, 'placed');
    if (remote.type !== 'placed') return;
    assert.equal(remote.feedback.hit, settled.feedback.hit);
    assert.equal(remote.next.score, settled.next.score);
    if (settled.next.phase === 'done') {
      assert.equal(remote.next.type, 'done');
      return;
    }
    assert.equal(remote.next.type, 'playing');
    if (remote.next.type !== 'playing') return;
    const hidden: unknown = JSON.parse(JSON.stringify(remote.next.upcoming));
    assert.equal(
      typeof hidden === 'object' &&
        hidden !== null &&
        Object.hasOwn(hidden, 'year'),
      false
    );
    local = settled.next;
  }
  assert.fail('the run never finished');
};

describe('daily deck', () => {
  it('builds a stable UTC day and a stable shuffle seed', () => {
    assert.equal(
      dailyDateKey(new Date(Date.UTC(2026, 10, 15, 0, 5))),
      '2026-11-15'
    );
    assert.equal(formatDailyDate('2026-11-14'), 'November 14');
    assert.equal(hashSeed('2026-11-14:easy'), hashSeed('2026-11-14:easy'));
    assert.notEqual(hashSeed('2026-11-14:easy'), hashSeed('2026-11-14:hard'));
    const left = mulberry32(hashSeed('2026-11-14:easy'));
    const right = mulberry32(hashSeed('2026-11-14:easy'));
    assert.equal(left(), right());
    assert.equal(displayName('Ada_1'), 'Ada_1');
    assert.equal(displayName('not a name'), 'player');
    assert.equal(placementProgress(1, 8), 0);
    assert.equal(placementProgress(5, 8), 0.5);
    assert.equal(placementProgress(9, 8), 1);
    assert.equal(
      dailyPublishWindow(new Date(Date.UTC(2026, 10, 15, 11, 0))),
      'publish'
    );
    assert.equal(
      dailyPublishWindow(new Date(Date.UTC(2026, 10, 15, 10, 0))),
      'skip'
    );
    assert.equal(
      dailyPublishWindow(new Date(Date.UTC(2026, 6, 15, 10, 0))),
      'publish'
    );
    assert.equal(
      dailyPublishWindow(new Date(Date.UTC(2026, 6, 15, 11, 0))),
      'catch-up'
    );
  });

  it('ends a fixed deck when the last card is placed', () => {
    const events = deck().slice(0, 2);
    const started = startGame(events);
    if (!started || started.phase !== 'playing')
      assert.fail('deck did not deal');
    const settled = settlePlacement(started, 1);
    assert.equal(settled?.feedback.hit, true);
    assert.equal(settled?.next.phase, 'done');
    assert.equal(settled?.next.score, 1);
  });

  it('shares one deck, hides upcoming years, and records the server score once', async () => {
    const { game, events, calls } = harness();
    const ada = player('ada');
    const bea = player('bea');
    await playOut(game, ada, events, 0);
    assert.equal(calls(), 1);
    const replay = await game.start(ada, 'easy');
    assert.equal(replay.type, 'done');
    if (replay.type !== 'done') return;
    assert.equal(replay.score, 8);
    assert.equal(replay.lives, 3);
    assert.equal(replay.bests.easy, 8);
    assert.equal(calls(), 1);
    const parsed = parseDailyDone(JSON.parse(JSON.stringify(replay)));
    assert.equal(parsed?.score, 8);
    assert.equal(parsed?.boards.easy.top[0]?.username, 'ada');

    await playOut(game, bea, events, 3);
    assert.equal(calls(), 1);
    const beaResult = await game.start(bea, 'easy');
    assert.equal(beaResult.type, 'done');
    if (beaResult.type !== 'done') return;
    assert.equal(beaResult.score, 0);
    assert.equal(beaResult.lives, 0);
    assert.equal(beaResult.boards.easy.top[0]?.username, 'ada');
    assert.equal(beaResult.boards.easy.you?.rank, 2);

    const again = await game.place(ada, 'easy', 0);
    assert.equal(again.type, 'done');
    if (again.type === 'done') assert.equal(again.score, 8);

    const medium = await game.start(ada, 'medium');
    assert.equal(medium.type, 'playing');
    assert.equal(calls(), 2);
    const boards = await game.overview(ada);
    const overview = parseDailyOverview(JSON.parse(JSON.stringify(boards)));
    assert.equal(overview?.loggedIn, true);
    assert.equal(overview?.levels.easy.played, true);
    assert.equal(overview?.levels.easy.score, 8);
    assert.equal(overview?.levels.medium.played, false);
    assert.equal(overview?.boards.easy.top[0]?.username, 'ada');
    assert.equal(overview?.boards.easy.top[1]?.username, 'bea');
    const guest = await game.overview(null);
    assert.equal(guest.loggedIn, false);
    assert.equal(guest.boards.easy.top[0]?.username, 'ada');
    assert.equal(guest.boards.medium.top.length, 0);
  });

  it('keeps an earlier post’s board after the next day starts', async () => {
    const run = harness();
    const ada = player('ada');
    await playOut(run.game, ada, run.events, 0);
    run.setNow(new Date(Date.UTC(2026, 10, 15, 15)));
    const today = await run.game.overview(null);
    assert.equal(today.date, '2026-11-15');
    assert.equal(today.boards.easy.top.length, 0);
    const earlier = await run.game.overview(null, '2026-11-14');
    assert.equal(earlier.date, '2026-11-14');
    assert.equal(earlier.boards.easy.top[0]?.username, 'ada');
    const replay = await run.game.start(ada, 'easy', '2026-11-14');
    assert.equal(replay.type, 'done');
    await playOut(run.game, ada, run.events, 0);
    const earlierAgain = await run.game.overview(null, '2026-11-14');
    assert.equal(earlierAgain.boards.easy.top.length, 1);
    const next = await run.game.overview(null);
    assert.equal(next.boards.easy.top.length, 1);
    assert.equal(next.boards.easy.top[0]?.username, 'ada');
  });

  it('keeps the best score when a later day is worse', async () => {
    const run = harness();
    const ada = player('ada');
    await playOut(run.game, ada, run.events, 3);
    run.setNow(new Date(Date.UTC(2026, 10, 15, 15)));
    await playOut(run.game, ada, run.events, 0);
    run.setNow(new Date(Date.UTC(2026, 10, 16, 15)));
    await playOut(run.game, ada, run.events, 3);
    const latest = await run.game.start(ada, 'easy');
    assert.equal(latest.type, 'done');
    if (latest.type !== 'done') return;
    assert.equal(latest.score, 0);
    assert.equal(latest.bests.easy, 8);
    assert.equal(run.calls(), 3);
  });

  it('ranks a player outside the top five', async () => {
    const { game, events } = harness();
    for (let index = 1; index <= 6; index += 1) {
      await playOut(game, player(`u${index}`), events, 0);
    }
    const sixth = await game.start(player('u1'), 'easy');
    assert.equal(sixth.type, 'done');
    if (sixth.type !== 'done') return;
    assert.equal(sixth.boards.easy.top.length, 5);
    assert.equal(
      sixth.boards.easy.top.some((entry) => entry.you),
      false
    );
    assert.equal(sixth.boards.easy.you?.rank, 6);
    assert.equal(sixth.boards.easy.top[0]?.username, 'u6');
  });

  it('rejects a second move while the first is still saving, and a slot that is not open', async () => {
    const { game, store } = harness();
    const ada = player('ada');
    await store.set(dailyLockKey('2026-11-14', 'easy', 'ada'), 'held');
    const blocked = await game.place(ada, 'easy', 0);
    assert.equal(blocked.type, 'error');
    if (blocked.type === 'error') assert.equal(blocked.code, 'busy');
    await store.del(dailyLockKey('2026-11-14', 'easy', 'ada'));
    const started = await game.start(ada, 'easy');
    assert.equal(started.type, 'playing');
    const rejected = await game.place(ada, 'easy', 5);
    assert.equal(rejected.type, 'error');
    if (rejected.type === 'error') assert.equal(rejected.code, 'slot');
    const resumed = await game.start(ada, 'easy');
    assert.equal(resumed.type, 'playing');
    if (resumed.type === 'playing') assert.equal(resumed.score, 0);
  });

  it('keeps a score above the old nine-card ceiling', async () => {
    const store = memoryStore();
    const events = Array.from({ length: 12 }, (_, index) =>
      event(1000 + index * 10)
    );
    const game = createDaily({
      store,
      now: () => new Date(Date.UTC(2026, 10, 14, 15)),
      id: () => 'lock',
      loadDeck: async () => events,
    });
    await playOut(game, player('ada'), events, 0);
    const finished = await game.start(player('ada'), 'easy');
    assert.equal(finished.type, 'done');
    if (finished.type !== 'done') return;
    assert.equal(finished.score, 11);
    assert.equal(finished.boards.easy.top[0]?.score, 11);
  });
});

describe('daily pool', () => {
  const pooled = (
    year: number,
    views: number,
    id = `event:${year}`
  ): PooledEvent => ({
    ...event(year),
    id,
    views,
  });

  const ids = (cards: readonly { id: string }[]): string[] =>
    cards.map((card) => card.id);

  const randomFor =
    (date: string) =>
    (difficulty: Difficulty): (() => number) =>
      mulberry32(hashSeed(`${date}:${difficulty}`));

  it('deals from the beginning and leaves the opening card for last', () => {
    const queue = [
      pooled(1910, 2_000_000, 'easy-new'),
      pooled(1810, 200_000, 'medium-new'),
      pooled(1710, 50_000, 'hard-new'),
      pooled(1900, 2_000_000, 'easy-old'),
      pooled(1800, 200_000, 'medium-old'),
      pooled(1700, 50_000, 'hard-old'),
    ];
    const first = dealQueue(queue, randomFor('2026-11-14'), 1);
    assert.deepEqual(ids(first.decks.easy), ['easy-new']);
    assert.deepEqual(ids(first.decks.medium), ['medium-new']);
    assert.deepEqual(ids(first.decks.hard), ['hard-new']);
    assert.equal(Object.hasOwn(first.decks.easy[0] ?? {}, 'views'), false);
    assert.deepEqual(ids(first.queue), [
      'easy-old',
      'medium-old',
      'hard-old',
      'easy-new',
      'medium-new',
      'hard-new',
    ]);
    const second = dealQueue(first.queue, randomFor('2026-11-15'), 1);
    assert.deepEqual(ids(second.decks.easy), ['easy-old']);
    assert.deepEqual(ids(second.decks.medium), ['medium-old']);
    assert.deepEqual(ids(second.decks.hard), ['hard-old']);
    const grown = enqueueEvents(second.queue, [
      pooled(1920, 2_000_000, 'easy-fresh'),
    ]);
    assert.equal(grown[0]?.id, 'easy-fresh');
    const third = dealQueue(grown, randomFor('2026-11-16'), 1);
    assert.deepEqual(ids(third.decks.easy), ['easy-fresh']);
  });

  it('keeps each level’s own pages before another level can borrow them', () => {
    const queue = [
      pooled(1600, 40_000, 'hard-two'),
      pooled(1700, 50_000, 'hard'),
      pooled(1750, 150_000, 'medium-two'),
      pooled(1800, 200_000, 'medium'),
      pooled(1900, 2_000_000, 'easy'),
    ];
    const dealt = dealQueue(queue, randomFor('2026-11-14'), 10);
    assert.deepEqual(ids(dealt.decks.easy), ['easy']);
    assert.deepEqual(ids(dealt.decks.medium).sort(), ['medium', 'medium-two']);
    assert.deepEqual(ids(dealt.decks.hard).sort(), ['hard', 'hard-two']);
    const surplus = dealQueue(
      [
        pooled(1600, 40_000, 'hard-a'),
        pooled(1610, 50_000, 'hard-b'),
        pooled(1620, 60_000, 'hard-c'),
        pooled(1800, 200_000, 'medium'),
      ],
      randomFor('2026-11-14'),
      2
    );
    assert.deepEqual(ids(surplus.decks.hard).sort(), ['hard-a', 'hard-b']);
    assert.deepEqual(ids(surplus.decks.medium).sort(), ['hard-c', 'medium']);
    assert.equal(surplus.decks.easy.length, 0);
  });

  it('keeps a short band when the cache has to drop pages', () => {
    const kept = enqueueEvents(
      [
        pooled(1600, 50_000, 'hard'),
        pooled(2000, 2_000_000, 'easy-old'),
        pooled(2010, 2_000_000, 'easy-mid'),
      ],
      [pooled(2020, 2_000_000, 'easy-new')],
      3,
      1
    );
    assert.deepEqual(ids(kept), ['easy-new', 'hard', 'easy-old']);
    assert.equal(bandCounts(kept).hard, 1);
    assert.equal(poolFilled(bandCounts(kept), 1), false);
    assert.equal(poolFilled({ easy: 600, medium: 600, hard: 600 }), true);
  });

  it('keeps one card per year and puts new pages at the beginning', () => {
    const queued = enqueueEvents(
      [pooled(1900, 2_000_000, 'same')],
      [
        pooled(1900, 3_000_000, 'same'),
        pooled(1800, 200_000),
        pooled(1700, 50_000),
        pooled(1500, 5_000),
      ]
    );
    assert.deepEqual(ids(queued), ['event:1800', 'event:1700', 'same']);
    assert.equal(queued.find((card) => card.id === 'same')?.views, 2_000_000);
    const capped = enqueueEvents(
      [pooled(2000, 2_000_000, 'a'), pooled(2010, 2_000_000, 'b')],
      [pooled(2020, 2_000_000, 'c')],
      2
    );
    assert.deepEqual(ids(capped), ['c', 'a']);
    const doubled = dealQueue(
      [
        pooled(1900, 2_000_000, 'hot'),
        pooled(1800, 2_000_000, 'other'),
        pooled(1900, 2_000_000, 'cold'),
      ],
      randomFor('2026-11-14'),
      10
    );
    assert.equal(
      doubled.decks.easy.filter((card) => card.year === 1900).length,
      1
    );
    assert.equal(
      doubled.decks.easy.find((card) => card.year === 1900)?.id,
      'hot'
    );
    assert.equal(doubled.queue[0]?.id, 'cold');
  });

  it('puts the last timeline card ahead of the opening card', () => {
    const queue = [0, 1, 2, 3].map((index) =>
      pooled(1600 + index * 100, 2_000_000, `page:${index}`)
    );
    const dealt = dealQueue(queue, randomFor('2026-11-14'), 4);
    const opening = dealt.decks.easy[0]?.id;
    const last = dealt.decks.easy.at(-1)?.id;
    assert.equal(typeof opening, 'string');
    assert.equal(typeof last, 'string');
    if (!opening || !last) return;
    assert.notEqual(opening, last);
    const order = ids(dealt.queue);
    assert.equal(order.indexOf(last) < order.indexOf(opening), true);
    const next = dealQueue(dealt.queue, randomFor('2026-11-15'), 1);
    assert.equal(next.decks.easy[0]?.id, last);
    const grown = enqueueEvents(dealt.queue, [
      pooled(2100, 2_000_000, 'fresh'),
    ]);
    assert.equal(grown[0]?.id, 'fresh');
    const withFresh = dealQueue(grown, randomFor('2026-11-16'), 1);
    assert.equal(withFresh.decks.easy[0]?.id, 'fresh');
  });

  it('deals the same play order for one day and a different order the next day', () => {
    const big = Array.from({ length: 8 }, (_, index) =>
      pooled(1000 + index * 10, 2_000_000, `page:${index}`)
    );
    const first = dealQueue(big, randomFor('2026-11-14'), 8);
    const second = dealQueue(big, randomFor('2026-11-14'), 8);
    assert.deepEqual(ids(first.decks.easy), ids(second.decks.easy));
    const nextDay = dealQueue(big, randomFor('2026-11-15'), 8);
    assert.notDeepEqual(ids(first.decks.easy), ids(nextDay.decks.easy));
  });
});
