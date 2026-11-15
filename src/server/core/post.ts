import { reddit, redis } from '@devvit/web/server';
import { dailyDateKey, formatDailyDate } from '../../shared/daily.ts';
import { dailyExpiration, dailyPostKey } from './daily.ts';

export const createPost = async (): Promise<{
  id: string;
  created: boolean;
}> => {
  const now = new Date();
  const date = dailyDateKey(now);
  const key = dailyPostKey(date);
  const existing = await redis.get(key);
  if (existing) return { id: existing, created: false };
  const post = await reddit.submitCustomPost({
    title: `Father Timeline · ${formatDailyDate(date)}`,
  });
  await redis.set(key, post.id, {
    nx: true,
    expiration: dailyExpiration(now),
  });
  const saved = await redis.get(key);
  const id = saved ?? post.id;
  return { id, created: id === post.id };
};
