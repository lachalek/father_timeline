import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import { isDifficulty } from '../../shared/difficulty.ts';
import {
  DAILY_LOGIN_MESSAGE,
  displayName,
  type DailyFailure,
} from '../../shared/daily.ts';
import { liveDaily } from '../core/liveDaily.ts';
import type { Player } from '../core/daily.ts';
import { dailyDateForPost } from '../core/post.ts';

const game = liveDaily();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const currentPlayer = (): Player | null => {
  const id = context.userId;
  if (!id) return null;
  return { id, username: displayName(context.username) };
};

const currentDate = (): Promise<string> =>
  dailyDateForPost(context.postId, context.postData, new Date());

const fail = (failure: DailyFailure): Response => {
  const status =
    failure.code === 'busy'
      ? 409
      : failure.code === 'deck'
        ? 502
        : failure.code === 'login'
          ? 401
          : 400;
  return Response.json(failure, { status });
};

export const api = new Hono();

api.get('/daily', async (c) => {
  return c.json(await game.overview(currentPlayer(), await currentDate()));
});

api.post('/daily/start', async (c) => {
  const player = currentPlayer();
  if (!player) {
    return fail({
      type: 'error',
      code: 'login',
      message: DAILY_LOGIN_MESSAGE,
    });
  }
  const body = await readBody(c.req.raw);
  if (!isRecord(body) || !isDifficulty(body.difficulty)) {
    return fail({
      type: 'error',
      code: 'slot',
      message: 'Choose easy, medium, or hard.',
    });
  }
  const result = await game.start(player, body.difficulty, await currentDate());
  if (result.type === 'error') return fail(result);
  return c.json(result);
});

api.post('/daily/place', async (c) => {
  const player = currentPlayer();
  if (!player) {
    return fail({
      type: 'error',
      code: 'login',
      message: DAILY_LOGIN_MESSAGE,
    });
  }
  const body = await readBody(c.req.raw);
  if (!isRecord(body) || !isDifficulty(body.difficulty)) {
    return fail({
      type: 'error',
      code: 'slot',
      message: 'Choose easy, medium, or hard.',
    });
  }
  if (typeof body.slot !== 'number' || !Number.isInteger(body.slot)) {
    return fail({
      type: 'error',
      code: 'slot',
      message: 'That spot isn’t open.',
    });
  }
  const result = await game.place(
    player,
    body.difficulty,
    body.slot,
    await currentDate()
  );
  if (result.type === 'error') return fail(result);
  return c.json(result);
});
