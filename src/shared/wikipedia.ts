import {
  isTimelineEvent,
  type TimelineEvent,
  type TimelineKind,
} from './timeline.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const decodeText = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const clip = (text: string, max: number): string => {
  const clean = decodeText(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const sliced = clean.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const base = (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trimEnd();
  return `${base}…`;
};

const MONTH =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/** "(died 1999)" and similar life-date asides are not part of the clue. */
const DATE_ASIDE = new RegExp(
  String.raw`\s*\([^()]*(?:\b(?:born|died|baptised|baptized|floruit|circa|d\.|b\.|c\.|ca\.|fl\.)|\b(?:BC|BCE|AD|CE)\b|\b\d{3,4}\b)[^()]*\)`,
  'gi'
);

const FULL_DATE = new RegExp(
  String.raw`\b(?:on\s+|in\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTH})|(?:${MONTH})\s+\d{1,2}(?:st|nd|rd|th)?,?)\s+\d{1,4}(?:\s*(?:BC|BCE|AD|CE))?\b`,
  'gi'
);

const LIFE_DATE =
  /\b(?:born|died|d\.|b\.)\s+(?:c\.\s*|ca\.\s*)?\d{1,4}(?:\s*(?:BC|BCE|AD|CE))?\b/gi;

const PREPOSITION_YEAR =
  /\b(?:in|on|of|by|circa|around|about|c\.|ca\.)\s+\d{1,4}(?:\s*(?:BC|BCE|AD|CE))?\b/gi;

const ERA_YEAR = /\b(?:AD|CE)\s+\d{1,4}\b|\b\d{1,4}\s*(?:BC|BCE|AD|CE)\b/gi;

const YEAR_RANGE = /\b\d{3,4}\s*[–—-]\s*\d{2,4}(?:\s*(?:BC|BCE|AD|CE))?\b/g;

const CENTURY =
  /(?:\bof\s+)?\bthe\s+\d{1,2}(?:st|nd|rd|th)\s+century(?:\s*(?:BC|BCE|AD|CE))?\b/gi;

const DECADE = /(?:\bof\s+)?\bthe\s+\d{3,4}s\b|\b\d{3,4}s\b/gi;

const tidy = (text: string): string =>
  text
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.-]+|[\s,;:-]+$/g, '')
    .trim();

const removeDateAsides = (text: string): string =>
  tidy(text.replace(DATE_ASIDE, ''));

/** Dates other than a year baked into the sentence, which is rejected separately. */
const removeOtherDates = (text: string): string =>
  tidy(
    text
      .replace(FULL_DATE, '')
      .replace(YEAR_RANGE, '')
      .replace(LIFE_DATE, '')
      .replace(PREPOSITION_YEAR, '')
      .replace(ERA_YEAR, '')
      .replace(CENTURY, '')
      .replace(DECADE, '')
  );

const withoutLeadingYear = (text: string, year: number): string => {
  const source = String(Math.abs(year));
  const pattern = new RegExp(`^${source}\\s*[\\u2013\\u2014-]\\s*`);
  return text.replace(pattern, '');
};

/** The hidden year printed in the clue would give the round away. */
const mentionsYear = (text: string, year: number): boolean => {
  const source = String(Math.abs(year));
  if (source.length === 0) return false;
  const pattern = new RegExp(`(?:^|\\D)${source}(?:\\D|$)`);
  return pattern.test(text);
};

const pageUrl = (page: Record<string, unknown>): string => {
  const contentUrls = page.content_urls;
  if (isRecord(contentUrls)) {
    const desktop = contentUrls.desktop;
    if (isRecord(desktop)) {
      const pageUrlValue = readString(desktop.page);
      if (pageUrlValue) return pageUrlValue;
    }
  }
  const title = readString(page.title);
  if (!title) return '';
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
};

const slug = (title: string): string => {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'event';
};

const firstPage = (
  item: Record<string, unknown>
): Record<string, unknown> | null => {
  if (!Array.isArray(item.pages)) return null;
  const page = item.pages[0];
  return isRecord(page) ? page : null;
};

const parseItem = (
  item: unknown,
  kind: TimelineKind,
  nowYear: number
): TimelineEvent | null => {
  if (!isRecord(item)) return null;
  const { year } = item;
  const rawText = readString(item.text);
  if (
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year > nowYear ||
    !rawText
  ) {
    return null;
  }
  const decoded = withoutLeadingYear(decodeText(rawText), year);
  const withoutAsides = removeDateAsides(decoded);
  if (mentionsYear(withoutAsides, year)) return null;
  const text = clip(removeOtherDates(withoutAsides), 280);
  if (text.length < 12) return null;
  const page = firstPage(item);
  const articleTitle = page ? readString(page.title) : null;
  const title = clip(articleTitle ?? text, 90);
  const url = page ? pageUrl(page) : '';
  return {
    id: `${kind}:${year}:${slug(title)}`,
    year,
    text,
    title,
    article: articleTitle ?? '',
    url,
    kind,
  };
};

export const parseOnThisDay = (
  payload: unknown,
  kind: TimelineKind,
  nowYear = new Date().getUTCFullYear()
): TimelineEvent[] => {
  if (!isRecord(payload)) return [];
  const list = payload[kind === 'event' ? 'events' : 'births'];
  if (!Array.isArray(list)) return [];
  const events: TimelineEvent[] = [];
  for (const item of list) {
    const parsed = parseItem(item, kind, nowYear);
    if (parsed) events.push(parsed);
  }
  return events;
};

export const parseCachedEvents = (raw: string): TimelineEvent[] | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const events: TimelineEvent[] = [];
    for (const item of parsed) {
      if (!isTimelineEvent(item)) return null;
      events.push({
        id: item.id,
        year: item.year,
        text: item.text,
        title: item.title,
        article: item.article,
        url: item.url,
        kind: item.kind,
      });
    }
    return events;
  } catch {
    return null;
  }
};
