export const DECK_SIZE = 9;
export const MIN_DECK_SIZE = 4;
export const STARTING_LIVES = 3;

export type TimelineKind = 'event' | 'birth';

export type TimelineEvent = {
  id: string;
  year: number;
  text: string;
  /** Display title. May be shortened. */
  title: string;
  /** Exact Wikipedia article title used for pageview lookups. Empty when the event has no page. */
  article: string;
  url: string;
  kind: TimelineKind;
};

export type PlacedCard = {
  event: TimelineEvent;
  /** Null on the opening card, which the player did not place. */
  hit: boolean | null;
};

export type PlacementFeedback = {
  hit: boolean;
  slot: number;
  correct: number;
  year: number;
};

export type PlayingState = {
  phase: 'playing';
  placed: PlacedCard[];
  upcoming: TimelineEvent;
  queue: TimelineEvent[];
  score: number;
  lives: number;
  feedback: PlacementFeedback | null;
};

/** The hand is empty, but lives remain, so another page can still be dealt. */
export type WaitingState = {
  phase: 'waiting';
  placed: PlacedCard[];
  score: number;
  lives: number;
};

export type DoneState = {
  phase: 'done';
  placed: PlacedCard[];
  score: number;
  lives: number;
};

export type DeckResponse = {
  type: 'deck';
  source: 'wikipedia';
  events: TimelineEvent[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isTimelineEvent = (value: unknown): value is TimelineEvent => {
  if (!isRecord(value)) return false;
  const { id, year, text, title, article, url, kind } = value;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof year === 'number' &&
    Number.isInteger(year) &&
    typeof text === 'string' &&
    text.length > 0 &&
    typeof title === 'string' &&
    title.length > 0 &&
    typeof article === 'string' &&
    typeof url === 'string' &&
    (kind === 'event' || kind === 'birth')
  );
};

export const parseDeckResponse = (
  value: unknown,
  minimum = 2
): DeckResponse | null => {
  if (
    !isRecord(value) ||
    value.type !== 'deck' ||
    value.source !== 'wikipedia'
  ) {
    return null;
  }
  const minEvents = minimum < 1 ? 1 : minimum;
  if (!Array.isArray(value.events) || value.events.length < minEvents)
    return null;
  const events: TimelineEvent[] = [];
  for (const item of value.events) {
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
  return { type: 'deck', source: 'wikipedia', events };
};

/** Signed years render as BCE. Wikipedia's on-this-day feed uses negative years for BCE. */
export const formatYear = (year: number): string => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return String(year);
};

export const formatScore = (score: number): string =>
  score > 0 ? `+${score}` : String(score);

/**
 * Slot 0 is before everything already on the line.
 * The last slot is after everything. The list must be sorted and years unique.
 */
export const correctSlotIndex = (
  placed: readonly { year: number }[],
  year: number
): number => {
  for (let index = 0; index < placed.length; index += 1) {
    const card = placed[index];
    if (card !== undefined && year < card.year) return index;
  }
  return placed.length;
};

export const scoreForPlacement = (hit: boolean): number => (hit ? 1 : 0);

export const insertAt = <T>(
  items: readonly T[],
  index: number,
  item: T
): T[] => {
  const bounded = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, bounded), item, ...items.slice(bounded)];
};

export const shuffle = <T>(
  items: readonly T[],
  random: () => number = Math.random
): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.max(
      0,
      Math.min(index, Math.floor(random() * (index + 1)))
    );
    const current = copy[index];
    const next = copy[swapIndex];
    if (current === undefined || next === undefined) continue;
    copy[index] = next;
    copy[swapIndex] = current;
  }
  return copy;
};

/** The opening card is a middle year, so the line can grow in both directions. */
export const orderDeck = (
  events: readonly TimelineEvent[],
  random: () => number = Math.random
): TimelineEvent[] => {
  if (events.length === 0) return [];
  const sorted = [...events].sort((left, right) => left.year - right.year);
  const anchorIndex = Math.floor(sorted.length / 2);
  const anchor = sorted[anchorIndex];
  if (!anchor) return [];
  const rest = shuffle(
    sorted.filter((_, index) => index !== anchorIndex),
    random
  );
  return [anchor, ...rest];
};

/** Picks events with distinct years, spread across the whole range we were given. */
export const selectDeck = (
  candidates: readonly TimelineEvent[],
  size: number,
  random: () => number = Math.random
): TimelineEvent[] => {
  const byYear = new Map<number, TimelineEvent>();
  for (const event of candidates) {
    if (!Number.isInteger(event.year)) continue;
    if (!byYear.has(event.year)) byYear.set(event.year, event);
  }
  const unique = [...byYear.values()].sort(
    (left, right) => left.year - right.year
  );
  if (unique.length <= size) return orderDeck(unique, random);
  if (size <= 1) {
    const only = unique[Math.floor(unique.length / 2)];
    return only ? [only] : [];
  }

  const picked: TimelineEvent[] = [];
  const used = new Set<number>();
  const last = unique.length - 1;
  for (let step = 0; step < size; step += 1) {
    const ideal = Math.round((step * last) / (size - 1));
    let index = ideal;
    for (let offset = 0; used.has(index) && offset <= last; offset += 1) {
      const earlier = ideal - offset;
      const later = ideal + offset;
      if (earlier >= 0 && !used.has(earlier)) index = earlier;
      else if (later <= last && !used.has(later)) index = later;
    }
    used.add(index);
    const event = unique[index];
    if (event) picked.push(event);
  }
  return orderDeck(picked, random);
};

/** Adds later events without repeating a year already on the table or in hand. */
export const addUpcoming = (
  state: PlayingState | WaitingState | DoneState,
  events: readonly TimelineEvent[]
): PlayingState | WaitingState | DoneState => {
  const seen = new Set<number>();
  for (const card of state.placed) seen.add(card.event.year);
  if (state.phase === 'playing') {
    seen.add(state.upcoming.year);
    for (const event of state.queue) seen.add(event.year);
  }
  const fresh: TimelineEvent[] = [];
  for (const event of events) {
    if (seen.has(event.year)) continue;
    seen.add(event.year);
    fresh.push(event);
  }
  if (fresh.length === 0 || (state.phase === 'done' && state.lives <= 0)) {
    return state;
  }
  if (state.phase === 'playing') {
    return { ...state, queue: [...state.queue, ...fresh] };
  }
  const [upcoming, ...queue] = fresh;
  if (!upcoming) return state;
  return {
    phase: 'playing',
    placed: state.placed,
    upcoming,
    queue,
    score: state.score,
    lives: state.lives,
    feedback: null,
  };
};

export const startGame = (
  events: readonly TimelineEvent[]
): PlayingState | DoneState | null => {
  const [anchor, ...rest] = events;
  if (!anchor) return null;
  const placed: PlacedCard[] = [{ event: anchor, hit: null }];
  const [upcoming, ...queue] = rest;
  if (!upcoming)
    return { phase: 'done', placed, score: 0, lives: STARTING_LIVES };
  return {
    phase: 'playing',
    placed,
    upcoming,
    queue,
    score: 0,
    lives: STARTING_LIVES,
    feedback: null,
  };
};

export const applyPlacement = (
  state: PlayingState,
  slot: number
): PlayingState => {
  if (state.feedback) return state;
  if (!Number.isInteger(slot) || slot < 0 || slot > state.placed.length)
    return state;
  const correct = correctSlotIndex(
    state.placed.map((card) => card.event),
    state.upcoming.year
  );
  const hit = slot === correct;
  return {
    ...state,
    score: state.score + scoreForPlacement(hit),
    feedback: { hit, slot, correct, year: state.upcoming.year },
  };
};

/**
 * A miss still joins the line at its true year.
 * Later rounds have to fit between the events that are actually there.
 */
export const resolveFeedback = (
  state: PlayingState
): PlayingState | WaitingState | DoneState => {
  if (!state.feedback) return state;
  const placed = insertAt(state.placed, state.feedback.correct, {
    event: state.upcoming,
    hit: state.feedback.hit,
  });
  const lives = state.feedback.hit ? state.lives : state.lives - 1;
  const [upcoming, ...queue] = state.queue;
  if (lives <= 0) {
    return {
      phase: 'done',
      placed,
      score: state.score,
      lives: 0,
    };
  }
  if (!upcoming) {
    return { phase: 'waiting', placed, score: state.score, lives };
  }
  return {
    phase: 'playing',
    placed,
    upcoming,
    queue,
    score: state.score,
    lives,
    feedback: null,
  };
};

export const tally = (
  placed: readonly PlacedCard[]
): { right: number; wrong: number } => {
  let right = 0;
  let wrong = 0;
  for (const card of placed) {
    if (card.hit === true) right += 1;
    else if (card.hit === false) wrong += 1;
  }
  return { right, wrong };
};
