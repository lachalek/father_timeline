import { redis, scheduler as jobs } from '@devvit/web/server';
import { Hono } from 'hono';
import { dailyDateKey, dailyPublishWindow } from '../../shared/daily.ts';
import { DIFFICULTIES } from '../../shared/difficulty.ts';
import { dailyPostKey } from '../core/daily.ts';
import { liveDaily, warmPool, type PoolFill } from '../core/liveDaily.ts';
import { createPost } from '../core/post.ts';

const FILL_PASSES = 2;
const FILL_FOLLOW_UPS = 24;
const FILL_DELAY_MS = 90_000;

export const scheduler = new Hono();

const fillRunsKey = (date: string): string => `daily:v1:fill-runs:${date}`;

const noteFillRun = async (date: string): Promise<number> => {
  const key = fillRunsKey(date);
  const raw = await redis.get(key);
  const count = (typeof raw === 'string' ? Number(raw) : 0) + 1;
  const runs = Number.isFinite(count) && count > 0 ? count : 1;
  await redis.set(key, String(runs), {
    expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return runs;
};

const growUntilPaused = async (): Promise<PoolFill | null> => {
  let latest: PoolFill | null = null;
  for (let pass = 0; pass < FILL_PASSES; pass += 1) {
    latest = await warmPool();
    console.log(
      `Pool easy ${latest.counts.easy}, medium ${latest.counts.medium}, hard ${latest.counts.hard}`
    );
    if (latest.filled || latest.added === 0) break;
  }
  return latest;
};

scheduler.post('/daily', async (c) => {
  const now = new Date();
  const publishWindow = dailyPublishWindow(now);
  if (publishWindow === 'skip') return c.json({}, 200);
  if (publishWindow === 'catch-up') {
    const existing = await redis.get(dailyPostKey(dailyDateKey(now)));
    if (existing) return c.json({}, 200);
  }
  try {
    await createPost();
  } catch (error) {
    console.error('Daily post failed', error);
    return c.json({ status: 'error' }, 500);
  }
  let fill: PoolFill | null = null;
  try {
    fill = await growUntilPaused();
  } catch (error) {
    console.error('Pool growth failed', error);
  }
  const daily = liveDaily();
  for (const difficulty of DIFFICULTIES) {
    try {
      await daily.ensureDeck(difficulty);
    } catch (error) {
      console.error(`Daily ${difficulty} deck failed`, error);
    }
  }
  if (fill && !fill.filled && fill.added > 0) {
    try {
      const runs = await noteFillRun(dailyDateKey(new Date()));
      if (runs <= FILL_FOLLOW_UPS) {
        await jobs.runJob({
          name: 'daily-challenge',
          runAt: new Date(Date.now() + FILL_DELAY_MS),
        });
      }
    } catch (error) {
      console.error('Pool follow-up failed', error);
    }
  }
  return c.json({}, 200);
});
