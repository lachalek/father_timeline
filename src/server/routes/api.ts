import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { fetchDeck, type DeckCache } from '../../shared/deck';
import { isDifficulty } from '../../shared/difficulty';
import { DECK_SIZE, type DeckResponse } from '../../shared/timeline';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const cache: DeckCache = {
  get: (key) => redis.get(key),
  set: async (key, value, ttlMs) => {
    await redis.set(key, value, {
      expiration: new Date(Date.now() + ttlMs),
    });
  },
};

const excludeYears = (raw: string | undefined): Set<number> => {
  const years = new Set<number>();
  if (!raw) return years;
  for (const part of raw.split(',').slice(0, 40)) {
    if (!/^-?\d+$/.test(part)) continue;
    years.add(Number(part));
  }
  return years;
};

const requestedTarget = (raw: string | undefined): number => {
  if (!raw || !/^\d+$/.test(raw)) return DECK_SIZE;
  const target = Number(raw);
  if (target < 1) return 1;
  if (target > DECK_SIZE) return DECK_SIZE;
  return target;
};

export const api = new Hono();

api.get('/deck', async (c) => {
  const difficulty = c.req.query('difficulty');
  if (!isDifficulty(difficulty)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Choose easy, medium, or hard' },
      400
    );
  }
  const fill = c.req.query('fill') === '1';
  try {
    const events = await fetchDeck({
      cache,
      difficulty,
      // Two cards are enough to put the first event on the line. The client asks for the rest.
      minimum: fill ? 1 : 2,
      maxDays: 2,
      stopEarly: !fill,
      target: fill ? requestedTarget(c.req.query('limit')) : DECK_SIZE,
      excludeYears: excludeYears(c.req.query('exclude')),
    });
    return c.json<DeckResponse>({
      type: 'deck',
      source: 'wikipedia',
      events,
    });
  } catch (error) {
    if (fill) {
      return c.json<DeckResponse>({
        type: 'deck',
        source: 'wikipedia',
        events: [],
      });
    }
    console.error('API Deck Error:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Could not load Wikipedia events';
    return c.json<ErrorResponse>({ status: 'error', message }, 502);
  }
});
