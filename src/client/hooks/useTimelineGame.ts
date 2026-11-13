import { useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../../shared/difficulty';
import {
  addUpcoming,
  applyPlacement,
  DECK_SIZE,
  parseDeckResponse,
  resolveFeedback,
  startGame,
  type DoneState,
  type PlayingState,
  type TimelineEvent,
  type WaitingState,
} from '../../shared/timeline';

const HIT_FEEDBACK_MS = 1100;
const MISS_FEEDBACK_MS = 1600;

type Status =
  | { phase: 'choose' }
  | { phase: 'loading'; difficulty: Difficulty }
  | { phase: 'error'; difficulty: Difficulty; empty: boolean }
  | { phase: 'playing'; difficulty: Difficulty; game: PlayingState }
  | { phase: 'waiting'; difficulty: Difficulty; game: WaitingState }
  | { phase: 'done'; difficulty: Difficulty; game: DoneState };

export const useTimelineGame = () => {
  const [status, setStatus] = useState<Status>({ phase: 'choose' });
  const loadId = useRef(0);
  const difficultyRef = useRef<Difficulty | null>(null);

  const fill = useCallback(
    async (
      id: number,
      difficulty: Difficulty,
      dealt: readonly TimelineEvent[]
    ) => {
      try {
        const params = new URLSearchParams({
          difficulty,
          fill: '1',
          limit: String(DECK_SIZE),
          exclude: dealt.map((event) => event.year).join(','),
        });
        const response = await fetch(`/api/deck?${params}`);
        if (!response.ok || id !== loadId.current) return;
        const more = parseDeckResponse(await response.json(), 1);
        if (!more || id !== loadId.current) return;
        setStatus((current) => {
          if (
            current.phase !== 'playing' &&
            current.phase !== 'waiting' &&
            current.phase !== 'done'
          ) {
            return current;
          }
          if (current.difficulty !== difficulty) return current;
          if (more.events.length === 0) {
            if (current.phase !== 'waiting') return current;
            return {
              phase: 'done',
              difficulty,
              game: {
                phase: 'done',
                placed: current.game.placed,
                score: current.game.score,
                lives: current.game.lives,
              },
            };
          }
          const game = addUpcoming(current.game, more.events);
          if (game.phase === 'waiting') {
            return { phase: 'waiting', difficulty, game };
          }
          return game.phase === 'done'
            ? { phase: 'done', difficulty, game }
            : { phase: 'playing', difficulty, game };
        });
      } catch (error) {
        console.error('Failed to load more timeline events', error);
      }
    },
    []
  );

  const load = useCallback(
    async (id: number, difficulty: Difficulty) => {
      try {
        const response = await fetch(`/api/deck?difficulty=${difficulty}`);
        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const body: unknown = await response.json();
            if (
              typeof body === 'object' &&
              body !== null &&
              'message' in body &&
              typeof body.message === 'string'
            ) {
              detail = body.message;
            }
          } catch {
            // The status code is enough when the body is not JSON.
          }
          throw new Error(detail);
        }
        const deck = parseDeckResponse(await response.json());
        if (id !== loadId.current) return;
        const game = deck ? startGame(deck.events) : null;
        if (!deck || !game || game.phase !== 'playing') {
          throw new Error('Deck was too short to play');
        }
        setStatus({ phase: 'playing', difficulty, game });
        if (deck.events.length < DECK_SIZE) {
          void fill(id, difficulty, deck.events);
        }
      } catch (error) {
        if (id !== loadId.current) return;
        console.error('Failed to load timeline', error);
        const empty =
          error instanceof Error && error.message.includes('Only found');
        setStatus({ phase: 'error', difficulty, empty });
      }
    },
    [fill]
  );

  const start = useCallback(
    (difficulty: Difficulty) => {
      difficultyRef.current = difficulty;
      const id = ++loadId.current;
      setStatus({ phase: 'loading', difficulty });
      void load(id, difficulty);
    },
    [load]
  );

  const reload = useCallback(() => {
    const difficulty = difficultyRef.current;
    if (!difficulty) {
      setStatus({ phase: 'choose' });
      return;
    }
    start(difficulty);
  }, [start]);

  const chooseAgain = useCallback(() => {
    difficultyRef.current = null;
    loadId.current += 1;
    setStatus({ phase: 'choose' });
  }, []);

  const place = useCallback((slot: number) => {
    setStatus((current) => {
      if (current.phase !== 'playing') return current;
      const game = applyPlacement(current.game, slot);
      if (game === current.game) return current;
      return { phase: 'playing', difficulty: current.difficulty, game };
    });
  }, []);

  const feedback = status.phase === 'playing' ? status.game.feedback : null;
  const moreKey =
    status.phase === 'waiting'
      ? `wait:${status.game.placed.map((card) => card.event.year).join(',')}`
      : status.phase === 'playing' &&
          status.game.queue.length === 0 &&
          status.game.feedback === null
        ? `hand:${[...status.game.placed.map((card) => card.event.year), status.game.upcoming.year].join(',')}`
        : '';

  useEffect(() => {
    if (
      (status.phase !== 'playing' && status.phase !== 'waiting') ||
      moreKey === ''
    ) {
      return;
    }
    const events =
      status.phase === 'playing'
        ? [
            ...status.game.placed.map((card) => card.event),
            status.game.upcoming,
          ]
        : status.game.placed.map((card) => card.event);
    void fill(loadId.current, status.difficulty, events);
  }, [moreKey, fill, status]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(
      () => {
        setStatus((current) => {
          if (current.phase !== 'playing' || !current.game.feedback)
            return current;
          const game = resolveFeedback(current.game);
          if (game.phase === 'waiting') {
            return { phase: 'waiting', difficulty: current.difficulty, game };
          }
          return game.phase === 'done'
            ? { phase: 'done', difficulty: current.difficulty, game }
            : { phase: 'playing', difficulty: current.difficulty, game };
        });
      },
      feedback.hit ? HIT_FEEDBACK_MS : MISS_FEEDBACK_MS
    );
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return { ...status, place, start, reload, chooseAgain };
};
