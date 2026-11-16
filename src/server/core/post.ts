import { reddit, redis } from '@devvit/web/server';
import {
  dailyDateKey,
  formatDailyDate,
  isDailyDateKey,
} from '../../shared/daily.ts';
import {
  boardExpiration,
  dailyExpiration,
  dailyPostKey,
  postDateKey,
} from './daily.ts';

const POST_LOOKUP_DAYS = 4;

const isPostId = (value: string): value is `t3_${string}` =>
  value.startsWith('t3_');

const dateFromPostData = (data: unknown): string | undefined => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !Object.hasOwn(data, 'date')
  ) {
    return undefined;
  }
  const date = Reflect.get(data, 'date');
  return isDailyDateKey(date) ? date : undefined;
};

const rememberPostDate = async (
  postId: string,
  date: string,
  now: Date
): Promise<void> => {
  await redis.set(postDateKey(postId), date, {
    expiration: boardExpiration(now),
  });
};

const stampPostDate = async (
  postId: `t3_${string}`,
  date: string
): Promise<void> => {
  try {
    const post = await reddit.getPostById(postId);
    const stored = dateFromPostData(await post.getPostData());
    if (stored === date) return;
    await post.setPostData({ date });
  } catch (error) {
    console.error('Could not store the post date', error);
  }
};

/**
 * The leaderboard belongs to the post. A new post starts on its own date,
 * and an older post keeps the date it was created with.
 */
export const dailyDateForPost = async (
  postId: string | undefined,
  postData: unknown,
  now: Date
): Promise<string> => {
  const stamped = dateFromPostData(postData);
  if (stamped) return stamped;
  const today = dailyDateKey(now);
  if (!postId) return today;
  const stored = await redis.get(postDateKey(postId));
  if (isDailyDateKey(stored)) return stored;
  for (let offset = 0; offset < POST_LOOKUP_DAYS; offset += 1) {
    const date = dailyDateKey(
      new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)
    );
    const id = await redis.get(dailyPostKey(date));
    if (id !== postId) continue;
    await rememberPostDate(postId, date, now);
    if (isPostId(postId)) await stampPostDate(postId, date);
    return date;
  }
  return today;
};

export const createPost = async (): Promise<{
  id: string;
  created: boolean;
}> => {
  const now = new Date();
  const date = dailyDateKey(now);
  const key = dailyPostKey(date);
  const existing = await redis.get(key);
  if (existing) {
    await rememberPostDate(existing, date, now);
    if (isPostId(existing)) await stampPostDate(existing, date);
    return { id: existing, created: false };
  }
  const post = await reddit.submitCustomPost({
    title: `Father Timeline · ${formatDailyDate(date)}`,
    postData: { date },
  });
  await redis.set(key, post.id, {
    nx: true,
    expiration: dailyExpiration(now),
  });
  const saved = await redis.get(key);
  const id = saved ?? post.id;
  await rememberPostDate(id, date, now);
  return { id, created: id === post.id };
};
