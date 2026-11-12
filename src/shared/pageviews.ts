export type ViewWindow = {
  start: string;
  end: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pad = (value: number): string => String(value).padStart(2, '0');

/** Last 12 complete months, as Wikimedia monthly stamps YYYYMMDDHH. */
export const viewYearWindow = (now: Date): ViewWindow => {
  const endMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const startMonth = new Date(
    Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 11, 1)
  );
  const lastDay = new Date(
    Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 0)
  );
  const stamp = (date: Date, day: number): string =>
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(day)}00`;
  return {
    start: stamp(startMonth, 1),
    end: stamp(endMonth, lastDay.getUTCDate()),
  };
};

export const pageviewsUrl = (article: string, window: ViewWindow): string => {
  const title = encodeURIComponent(article.replace(/ /g, '_'));
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${window.start}/${window.end}`;
};

export const pageviewKey = (title: string): string =>
  title.replace(/ /g, '_').toLowerCase();

/** One request scores many articles. Wikipedia returns about 60 daily counts. */
export const pageviewQueryUrl = (articles: readonly string[]): string => {
  const titles = articles
    .map((article) => encodeURIComponent(article.replace(/ /g, '_')))
    .join('|');
  return `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageviews&pvipdays=60&titles=${titles}`;
};

/**
 * Scale the latest daily counts to a year.
 * Null when fewer than 30 days came back, which is too thin to stand in for a year.
 */
export const annualPace = (pageviews: unknown): number | null => {
  if (!isRecord(pageviews)) return null;
  let total = 0;
  let days = 0;
  for (const value of Object.values(pageviews)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      continue;
    }
    total += value;
    days += 1;
  }
  if (days < 30) return null;
  return Math.round((total * 365) / days);
};

export const parsePageviewQuery = (payload: unknown): Map<string, number> => {
  const found = new Map<string, number>();
  if (!isRecord(payload)) return found;
  const { query } = payload;
  if (!isRecord(query) || !isRecord(query.pages)) return found;
  for (const page of Object.values(query.pages)) {
    if (
      !isRecord(page) ||
      typeof page.title !== 'string' ||
      page.title.length === 0
    ) {
      continue;
    }
    const key = pageviewKey(page.title);
    if ('missing' in page) {
      found.set(key, 0);
      continue;
    }
    const pace = annualPace(page.pageviews);
    if (pace === null) continue;
    found.set(key, pace);
  }
  return found;
};

/** Sum monthly view counts. Null when the payload has no usable months. */
export const sumPageviews = (payload: unknown): number | null => {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return null;
  let total = 0;
  let counted = 0;
  for (const item of payload.items) {
    if (!isRecord(item)) continue;
    const { views } = item;
    if (typeof views !== 'number' || !Number.isFinite(views) || views < 0) {
      continue;
    }
    total += views;
    counted += 1;
  }
  if (counted === 0) return null;
  return total;
};
