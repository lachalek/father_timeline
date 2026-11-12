import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchDeck, type DeckCache } from '../../shared/deck.ts';
import { isDifficulty, matchesDifficulty } from '../../shared/difficulty.ts';
import {
  annualPace,
  pageviewsUrl,
  parsePageviewQuery,
  sumPageviews,
  viewYearWindow,
} from '../../shared/pageviews.ts';
import {
  addUpcoming,
  applyPlacement,
  correctSlotIndex,
  formatScore,
  formatYear,
  orderDeck,
  resolveFeedback,
  selectDeck,
  startGame,
  type TimelineEvent,
  type PlayingState,
} from '../../shared/timeline.ts';
import { parseCachedEvents, parseOnThisDay } from '../../shared/wikipedia.ts';

const event = (
  year: number,
  title: string,
  kind: TimelineEvent['kind'] = 'event'
): TimelineEvent => ({
  id: `${kind}:${year}:${title}`,
  year,
  title,
  article: title,
  text: `${title} changes the course of recorded history.`,
  url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  kind,
});

const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

const asPlaying = (state: ReturnType<typeof startGame>): PlayingState => {
  assert.ok(state);
  assert.equal(state.phase, 'playing');
  if (!state || state.phase !== 'playing') {
    throw new Error('expected a round in progress');
  }
  return state;
};

describe('timeline placement', () => {
  it('formats years and scores', () => {
    assert.equal(formatYear(1066), '1066');
    assert.equal(formatYear(-44), '44 BCE');
    assert.equal(formatScore(0), '0');
    assert.equal(formatScore(3), '+3');
    assert.equal(formatScore(-2), '-2');
  });

  it('finds the gap before, between, and after', () => {
    const placed = [{ year: -100 }, { year: 500 }, { year: 1800 }];
    assert.equal(correctSlotIndex(placed, -200), 0);
    assert.equal(correctSlotIndex(placed, 100), 1);
    assert.equal(correctSlotIndex(placed, 900), 2);
    assert.equal(correctSlotIndex(placed, 1900), 3);
    assert.equal(correctSlotIndex([], 1066), 0);
  });

  it('keeps one event per year and opens on a middle year', () => {
    const deck = selectDeck(
      [
        event(1900, 'First'),
        event(1900, 'Duplicate'),
        event(1800, 'Earlier'),
        event(2000, 'Later'),
      ],
      9,
      () => 0
    );
    assert.deepEqual(
      deck.map((card) => card.year),
      [1900, 2000, 1800]
    );
    assert.equal(deck[0]?.title, 'First');
  });

  it('spreads a large pool across the whole range', () => {
    const pool = Array.from({ length: 21 }, (_, index) =>
      event(1000 + index * 10, `Era ${index}`)
    );
    const deck = selectDeck(pool, 5, () => 0.2);
    const years = deck
      .map((card) => card.year)
      .sort((left, right) => left - right);
    assert.equal(deck.length, 5);
    assert.equal(new Set(years).size, 5);
    assert.equal(years[0], 1000);
    assert.equal(years[4], 1200);
    assert.equal(deck[0]?.year, years[Math.floor(years.length / 2)]);
  });

  it('puts the median event first', () => {
    const ordered = orderDeck(
      [event(1200, 'A'), event(1400, 'B'), event(1600, 'C'), event(1800, 'D')],
      () => 0.4
    );
    assert.equal(ordered[0]?.year, 1600);
  });

  it('scores a miss as minus one and still inserts the true year', () => {
    const started = asPlaying(
      startGame([event(1500, 'Anchor'), event(1400, 'Earlier')])
    );
    const ignored = applyPlacement(started, 5);
    assert.equal(ignored, started);
    const missed = applyPlacement(started, 1);
    assert.equal(missed.score, -1);
    assert.equal(missed.feedback?.correct, 0);
    assert.equal(applyPlacement(missed, 0), missed);

    const done = resolveFeedback(missed);
    assert.equal(done.phase, 'done');
    if (done.phase !== 'done') return;
    assert.deepEqual(
      done.placed.map((card) => card.event.year),
      [1400, 1500]
    );
    assert.equal(done.placed[0]?.hit, false);
    assert.equal(done.placed[1]?.hit, null);
    assert.equal(done.score, -1);
  });

  it('lets a later round land between two events', () => {
    let state = asPlaying(
      startGame([
        event(1500, 'Anchor'),
        event(1000, 'Early'),
        event(2000, 'Late'),
        event(1700, 'Between'),
      ])
    );
    state = asPlaying(resolveFeedback(applyPlacement(state, 0)));
    state = asPlaying(resolveFeedback(applyPlacement(state, 2)));
    assert.deepEqual(
      state.placed.map((card) => card.event.year),
      [1000, 1500, 2000]
    );
    assert.equal(
      correctSlotIndex(
        state.placed.map((card) => card.event),
        1700
      ),
      2
    );
    const wrongGap = applyPlacement(state, 0);
    assert.equal(wrongGap.score, 1);
    const done = resolveFeedback(wrongGap);
    assert.equal(done.phase, 'done');
    if (done.phase !== 'done') return;
    assert.deepEqual(
      done.placed.map((card) => card.event.year),
      [1000, 1500, 1700, 2000]
    );
    assert.equal(done.placed[2]?.hit, false);
  });

  it('stays sorted even when every guess is the first gap', () => {
    const deck = orderDeck(
      [1189, 1492, 1776, 1865, 1969, 44].map((year) =>
        event(year, `Year ${year}`)
      ),
      () => 0.42
    );
    let state = startGame(deck);
    assert.ok(state);
    let guard = 0;
    while (state && state.phase === 'playing' && guard < 20) {
      guard += 1;
      state = resolveFeedback(applyPlacement(state, 0));
    }
    assert.ok(state);
    assert.equal(state?.phase, 'done');
    if (!state || state.phase !== 'done') return;
    const years = state.placed.map((card) => card.event.year);
    assert.deepEqual(
      years,
      [...years].sort((left, right) => left - right)
    );
  });

  it('appends later events and can resume a finished line', () => {
    const started = startGame([event(1900, 'Anchor'), event(1910, 'Next')]);
    assert.ok(started && started.phase === 'playing');
    if (!started || started.phase !== 'playing') return;
    const extended = addUpcoming(started, [
      event(1900, 'Anchor'),
      event(1920, 'Later'),
    ]);
    assert.equal(extended.phase, 'playing');
    if (extended.phase !== 'playing') return;
    assert.equal(extended.queue.length, 1);
    assert.equal(extended.queue[0]?.year, 1920);
    let finished: ReturnType<typeof resolveFeedback> = extended;
    let guard = 0;
    while (finished.phase === 'playing' && guard < 5) {
      guard += 1;
      finished = resolveFeedback(applyPlacement(finished, 0));
    }
    assert.equal(finished.phase, 'done');
    const resumed = addUpcoming(finished, [event(1930, 'After')]);
    assert.equal(resumed.phase, 'playing');
    if (resumed.phase !== 'playing') return;
    assert.equal(resumed.upcoming.year, 1930);
    assert.equal(resumed.score, finished.score);
  });
});

describe('wikipedia events', () => {
  const payload = {
    events: [
      {
        year: 1969,
        text: '1969 – A crewed ship lands on the moon.',
        pages: [
          {
            title: 'Moon landing',
            content_urls: {
              desktop: { page: 'https://en.wikipedia.org/wiki/Moon_landing' },
            },
          },
        ],
      },
      {
        year: 1969,
        text: 'The 1969 voyage is described with its year in the clue.',
        pages: [{ title: 'Spoiler' }],
      },
      { year: 1066, text: 'A fleet crosses the channel.' },
      { year: -44, text: 'A roman general is assassinated in the senate.' },
      { year: 2001, text: 'A king &amp; a queen are crowned together.' },
      {
        year: 1920,
        text: 'Maqsood Ahmed, Pakistani cricketer (died 1999)',
        pages: [{ title: 'Maqsood Ahmed' }],
      },
      { year: 1944, text: 'A treaty is signed in 1919 after the armistice.' },
      {
        year: 1480,
        text: 'A painter of the 15th century is recorded in the city.',
      },
      {
        year: 1812,
        text: 'More than 2,200 people leave the city before winter.',
      },
      { year: 2027, text: 'A future fair opens its gates.' },
      { year: 12.5, text: 'This year is not a whole number.' },
      { year: 1880, text: 'Too short' },
    ],
    births: [
      {
        year: 1867,
        text: 'A physicist is born in a rented room.',
        pages: [{ title: 'Marie Curie' }],
      },
      {
        year: 1915,
        text: 'Fred Hoyle, English astronomer and author (d. 2001)',
        pages: [{ title: 'Fred Hoyle' }],
      },
    ],
  };

  it('strips dates from clues and drops ones that still reveal the year', () => {
    const events = parseOnThisDay(payload, 'event', 2026);
    assert.deepEqual(
      events.map((item) => item.year),
      [1969, 1066, -44, 2001, 1920, 1944, 1480, 1812]
    );
    assert.equal(events[0]?.text, 'A crewed ship lands on the moon.');
    assert.equal(events[0]?.url, 'https://en.wikipedia.org/wiki/Moon_landing');
    assert.equal(events[0]?.kind, 'event');
    assert.equal(events[3]?.text, 'A king & a queen are crowned together.');
    assert.equal(events[4]?.text, 'Maqsood Ahmed, Pakistani cricketer');
    assert.equal(events[5]?.text, 'A treaty is signed after the armistice.');
    assert.equal(events[6]?.text, 'A painter is recorded in the city.');
    assert.equal(
      events[7]?.text,
      'More than 2,200 people leave the city before winter.'
    );
    const births = parseOnThisDay(payload, 'birth', 2026);
    assert.equal(births[0]?.title, 'Marie Curie');
    assert.equal(births[1]?.text, 'Fred Hoyle, English astronomer and author');
    assert.deepEqual(parseOnThisDay(null, 'event', 2026), []);
  });

  it('rejects a corrupt cache entry', () => {
    const raw = JSON.stringify([event(1776, 'Congress')]);
    assert.equal(parseCachedEvents(raw)?.[0]?.year, 1776);
    assert.equal(parseCachedEvents(raw)?.[0]?.article, 'Congress');
    assert.equal(parseCachedEvents('{"year":1776}'), null);
    assert.equal(parseCachedEvents('not-json'), null);
    assert.equal(
      parseCachedEvents(
        JSON.stringify([
          {
            id: 'event:1776:congress',
            year: 1776,
            text: 'A congress meets in the hall.',
            title: 'Congress',
            url: '',
            kind: 'event',
          },
        ])
      ),
      null
    );
  });
});

describe('difficulty bands', () => {
  it('keeps the yearly view ranges exclusive at each boundary', () => {
    assert.equal(isDifficulty('easy'), true);
    assert.equal(isDifficulty('Easy'), false);
    assert.equal(matchesDifficulty(1_000_000, 'easy'), true);
    assert.equal(matchesDifficulty(1_000_000, 'medium'), false);
    assert.equal(matchesDifficulty(999_999, 'medium'), true);
    assert.equal(matchesDifficulty(100_000, 'medium'), true);
    assert.equal(matchesDifficulty(100_000, 'hard'), false);
    assert.equal(matchesDifficulty(99_999, 'hard'), true);
    assert.equal(matchesDifficulty(10_000, 'hard'), true);
    assert.equal(matchesDifficulty(9_999, 'hard'), false);
    assert.equal(matchesDifficulty(9_999, 'easy'), false);
  });

  it('sums a year of monthly pageviews', () => {
    const window = viewYearWindow(new Date('2026-11-11T12:00:00Z'));
    assert.equal(window.start, '2025110100');
    assert.equal(window.end, '2026103100');
    const january = viewYearWindow(new Date('2026-01-15T00:00:00Z'));
    assert.equal(january.start, '2025010100');
    assert.equal(january.end, '2025123100');
    assert.equal(
      pageviewsUrl('Known One', window),
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Known_One/monthly/${window.start}/${window.end}`
    );
    assert.equal(
      sumPageviews({
        items: [{ views: 10 }, { views: 5 }, { views: 'nope' }, null],
      }),
      15
    );
    assert.equal(sumPageviews({ items: [] }), null);
    assert.equal(sumPageviews({}), null);
    const pageviews: Record<string, number> = {};
    for (let day = 0; day < 60; day += 1) pageviews[`d${day}`] = 1000;
    assert.equal(annualPace(pageviews), Math.round((60_000 * 365) / 60));
    assert.equal(annualPace({}), null);
    const parsed = parsePageviewQuery({
      query: {
        pages: {
          '1': { title: 'World War II', pageviews },
          '2': { title: 'Missing Page', missing: '' },
        },
      },
    });
    assert.equal(parsed.get('world_war_ii'), Math.round((60_000 * 365) / 60));
    assert.equal(parsed.get('missing_page'), 0);
  });
});

const paceResponse = (
  url: string,
  viewsFor: (title: string) => number | 'missing'
): Response => {
  const titles = new URL(url).searchParams.get('titles') ?? '';
  const pages: Record<string, unknown> = {};
  let id = 1;
  for (const raw of titles.split('|')) {
    if (raw.length === 0) continue;
    const title = decodeURIComponent(raw).replace(/_/g, ' ');
    const views = viewsFor(title);
    if (views === 'missing') {
      pages[String(id)] = { title, missing: '' };
    } else {
      const pageviews: Record<string, number> = {};
      for (let day = 0; day < 60; day += 1) pageviews[`d${day}`] = views / 365;
      pages[String(id)] = { title, pageviews };
    }
    id += 1;
  }
  return Response.json({ query: { pages } });
};

describe('fetchDeck', () => {
  const historical = [
    1100, 1280, 1410, 1560, 1675, 1730, 1810, 1895, 1946, 2004,
  ].map((year, index) => ({
    year,
    text: `Chronicle ${index} reshapes the written record of the age.`,
    pages: [{ title: `Chronicle ${index}` }],
  }));
  const births = [
    {
      year: 640,
      text: 'A poet is born beside a salt marsh.',
      pages: [{ title: 'Marsh Poet' }],
    },
    {
      year: 875,
      text: 'A singer is born in a hill town.',
      pages: [{ title: 'Hill Singer' }],
    },
  ];

  const wikipediaFetch = (
    calls: string[],
    agents: Array<string | null>
  ): typeof fetch => {
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      agents.push(new Headers(init?.headers).get('user-agent'));
      if (url.includes('prop=pageviews')) {
        return paceResponse(url, () => 1_600_000);
      }
      if (url.includes('/births/')) return Response.json({ births });
      return Response.json({ events: historical });
    };
    return impl;
  };

  it('deals a wikipedia deck and then uses the cache', async () => {
    const calls: string[] = [];
    const agents: Array<string | null> = [];
    const store = new Map<string, string>();
    const cache: DeckCache = {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value);
      },
    };
    const deck = await fetchDeck({
      difficulty: 'easy',
      random: seeded(11),
      cache,
      fetch: wikipediaFetch(calls, agents),
    });
    const onThisDay = calls.filter((url) =>
      url.includes('https://en.wikipedia.org/api/rest_v1/feed/onthisday/')
    );
    const viewCalls = calls.filter((url) => url.includes('prop=pageviews'));
    assert.equal(onThisDay.length, 1);
    assert.equal(viewCalls.length, 1);
    assert.ok(viewCalls[0]?.includes('Chronicle_0'));
    assert.ok(onThisDay.every((url) => url.includes('/events/')));
    assert.ok(agents.every((agent) => agent?.includes('TimelineGuesser')));
    assert.equal(deck.length, 9);
    assert.equal(new Set(deck.map((card) => card.year)).size, 9);
    assert.ok(deck.every((card) => card.kind === 'event'));
    const years = deck
      .map((card) => card.year)
      .sort((left, right) => left - right);
    assert.equal(deck[0]?.year, years[Math.floor(years.length / 2)]);

    const cachedCalls = calls.length;
    const again = await fetchDeck({
      difficulty: 'easy',
      random: seeded(11),
      cache,
      fetch: wikipediaFetch(calls, agents),
    });
    assert.equal(calls.length, cachedCalls);
    assert.deepEqual(
      again.map((card) => card.id),
      deck.map((card) => card.id)
    );
  });

  it('keeps only the chosen view band', async () => {
    const pages = [
      { title: 'Famous', year: 1900, views: 2_000_000 },
      { title: 'Known One', year: 1800, views: 150_000 },
      { title: 'Known Two', year: 1700, views: 100_000 },
      { title: 'Known Three', year: 1600, views: 999_999 },
      { title: 'Known Four', year: 1500, views: 100_001 },
      { title: 'Obscure', year: 1400, views: 50_000 },
      { title: 'Tiny', year: 1300, views: 9_999 },
      { title: 'Million', year: 2000, views: 1_000_000 },
    ];
    const events = pages.map((page) => ({
      year: page.year,
      text: `${page.title} leaves a mark on the written record.`,
      pages: [{ title: page.title }],
    }));
    const bandedFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('prop=pageviews')) {
        return paceResponse(url, (title) => {
          const views = pages.find((page) => page.title === title)?.views;
          return views === 9_999 || views === undefined ? 'missing' : views;
        });
      }
      if (url.includes('/births/')) return Response.json({ births: [] });
      return Response.json({ events });
    };
    const deck = await fetchDeck({
      difficulty: 'medium',
      random: () => 0.3,
      fetch: bandedFetch,
    });
    assert.deepEqual(
      deck.map((card) => card.year).sort((left, right) => left - right),
      [1500, 1600, 1700, 1800]
    );
    assert.equal(deck[0]?.year, 1700);
    assert.ok(deck.every((card) => card.title.startsWith('Known')));
  });

  it('uses famous births when the event pages are below the band', async () => {
    const calls: string[] = [];
    const impl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('prop=pageviews')) {
        return paceResponse(url, (title) =>
          title.startsWith('Famous') ? 2_000_000 : 5_000
        );
      }
      if (url.includes('/births/')) {
        return Response.json({
          births: ['Poet', 'Singer', 'Painter', 'Dancer'].map(
            (name, index) => ({
              year: 1801 + index,
              text: `A ${name.toLowerCase()} is born and remembered widely.`,
              pages: [{ title: `Famous ${name}` }],
            })
          ),
        });
      }
      return Response.json({
        events: [1, 2, 3, 4].map((number) => ({
          year: 1900 + number,
          text: `Obscure chronicle ${number} reshapes a local record.`,
          pages: [{ title: `Obscure ${number}` }],
        })),
      });
    };
    const deck = await fetchDeck({
      difficulty: 'easy',
      random: () => 0.3,
      fetch: impl,
    });
    const birthFeed = calls.findIndex((url) => url.includes('/births/'));
    const eventView = calls.findIndex((url) => url.includes('Obscure_'));
    assert.ok(eventView !== -1 && birthFeed !== -1 && eventView < birthFeed);
    assert.equal(deck.length, 4);
    assert.ok(deck.every((card) => card.kind === 'birth'));
  });

  it('samples the tail of a long day, where the famous pages often sit', async () => {
    const impl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('prop=pageviews')) {
        return paceResponse(url, (title) => {
          const match = /Late (\d+)/.exec(title);
          const index = match ? Number(match[1]) : 0;
          return index >= 10 ? 2_000_000 : 5_000;
        });
      }
      if (url.includes('/births/')) return Response.json({ births: [] });
      return Response.json({
        events: Array.from({ length: 16 }, (_, index) => ({
          year: 1200 + index,
          text: `Late ${index} leaves a mark on the written record.`,
          pages: [{ title: `Late ${index}` }],
        })),
      });
    };
    const deck = await fetchDeck({
      difficulty: 'easy',
      random: () => 0.3,
      fetch: impl,
    });
    const titles = deck.map((card) => card.title);
    assert.ok(titles.includes('Late 15'));
    assert.ok(!titles.includes('Late 0'));
  });

  it('retries a rate limit before counting the page', async () => {
    const seen = new Set<string>();
    const impl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('prop=pageviews')) {
        if (!seen.has(url)) {
          seen.add(url);
          return new Response('slow down', { status: 429 });
        }
        return paceResponse(url, () => 2_000_000);
      }
      if (url.includes('/births/')) return Response.json({ births: [] });
      return Response.json({
        events: [1, 2, 3, 4].map((number) => ({
          year: 1600 + number,
          text: `Noted chronicle ${number} reshapes the written record.`,
          pages: [{ title: `Noted ${number}` }],
        })),
      });
    };
    const deck = await fetchDeck({
      difficulty: 'easy',
      random: () => 0.3,
      fetch: impl,
    });
    assert.equal(deck.length, 4);
  });

  it('says the archive missed when pageview lookups fail', async () => {
    const impl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('prop=pageviews')) {
        return new Response('unavailable', { status: 503 });
      }
      if (url.includes('/births/')) return Response.json({ births: [] });
      return Response.json({
        events: [
          {
            year: 1900,
            text: 'A noted chronicle reshapes the written record.',
            pages: [{ title: 'Noted Chronicle' }],
          },
        ],
      });
    };
    await assert.rejects(
      () =>
        fetchDeck({
          difficulty: 'easy',
          fetch: impl,
          random: () => 0.3,
        }),
      /Wikipedia pageviews did not answer/
    );
  });

  it('fails when wikipedia has no usable dates', async () => {
    const emptyFetch: typeof fetch = async () =>
      Response.json({ events: [], births: [] });
    await assert.rejects(
      () =>
        fetchDeck({
          difficulty: 'easy',
          fetch: emptyFetch,
          random: () => 0.3,
        }),
      /Only found 0 easy events/
    );
  });
});
