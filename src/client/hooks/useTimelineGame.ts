import { useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../../shared/difficulty';
import {
  doneStateFromDaily,
  parseDailyDone,
  parseDailyFailure,
  parseDailyOverview,
  parseDailyPlaced,
  parseDailyPlaying,
  placementProgress,
  playingStateFromDaily,
  type DailyBoard,
  type DailyDoneResponse,
  type DailyOverview,
  type DailyPlayingResponse,
} from '../../shared/daily';
import type { DoneState, PlayingState } from '../../shared/timeline';
import {
  abandonRun,
  beginRun,
  finishRun,
  noteProgress,
} from '../timeline/journey';

const HIT_FEEDBACK_MS = 1100;
/** Covers the scythe swing, impact hold, shatter, and the lives sliding in. */
const MISS_FEEDBACK_MS = 1900;

type Status =
  | { phase: 'choose'; overview: DailyOverview | null; problem: string | null }
  | { phase: 'loading'; difficulty: Difficulty }
  | { phase: 'error'; difficulty: Difficulty; message: string }
  | {
      phase: 'playing';
      difficulty: Difficulty;
      game: PlayingState;
      steps: number;
      problem: string | null;
    }
  | {
      phase: 'done';
      difficulty: Difficulty;
      game: DoneState;
      date: string;
      bests: Record<Difficulty, number | null>;
      boards: Record<Difficulty, DailyBoard>;
    };

const readBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const doneStatus = (next: DailyDoneResponse): Status => ({
  phase: 'done',
  difficulty: next.difficulty,
  game: doneStateFromDaily(next),
  date: next.date,
  bests: next.bests,
  boards: next.boards,
});

export const useTimelineGame = () => {
  const [status, setStatus] = useState<Status>({
    phase: 'choose',
    overview: null,
    problem: null,
  });
  const [placing, setPlacing] = useState(false);
  const loadId = useRef(0);
  const placingLock = useRef(false);
  const placementId = useRef(0);
  const pending = useRef<{
    token: number;
    next: DailyPlayingResponse | DailyDoneResponse;
  } | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  const refreshOverview = useCallback(async (id: number) => {
    try {
      const response = await fetch('/api/daily');
      const overview = parseDailyOverview(await readBody(response));
      if (id !== loadId.current) return;
      setStatus((current) => {
        if (current.phase !== 'choose') return current;
        return overview
          ? { phase: 'choose', overview, problem: null }
          : {
              phase: 'choose',
              overview: null,
              problem: 'The daily boards didn’t load.',
            };
      });
    } catch (error) {
      console.error('Failed to load the daily boards', error);
      if (id !== loadId.current) return;
      setStatus((current) => {
        if (current.phase !== 'choose') return current;
        return {
          phase: 'choose',
          overview: null,
          problem: 'The daily boards didn’t load.',
        };
      });
    }
  }, []);

  useEffect(() => {
    void refreshOverview(loadId.current);
  }, [refreshOverview]);

  const start = useCallback((difficulty: Difficulty) => {
    const id = ++loadId.current;
    pending.current = null;
    setStatus({ phase: 'loading', difficulty });
    void (async () => {
      try {
        const response = await fetch('/api/daily/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ difficulty }),
        });
        const body = await readBody(response);
        if (id !== loadId.current) return;
        const failure = parseDailyFailure(body);
        if (!response.ok || failure) {
          setStatus({
            phase: 'error',
            difficulty,
            message: failure?.message ?? 'Today’s deck didn’t load.',
          });
          return;
        }
        const done = parseDailyDone(body);
        if (done) {
          setStatus(doneStatus(done));
          return;
        }
        const playing = parseDailyPlaying(body);
        if (!playing) {
          setStatus({
            phase: 'error',
            difficulty,
            message: 'Today’s deck didn’t load.',
          });
          return;
        }
        beginRun();
        setStatus({
          phase: 'playing',
          difficulty,
          game: playingStateFromDaily(playing),
          steps: playing.steps,
          problem: null,
        });
      } catch (error) {
        console.error('Failed to deal today’s deck', error);
        if (id !== loadId.current) return;
        setStatus({
          phase: 'error',
          difficulty,
          message: 'Today’s deck didn’t load.',
        });
      }
    })();
  }, []);

  const reload = useCallback(() => {
    const current = statusRef.current;
    if (current.phase === 'choose') {
      void refreshOverview(++loadId.current);
      return;
    }
    if (current.phase === 'loading') return;
    start(current.difficulty);
  }, [refreshOverview, start]);

  const chooseAgain = useCallback(() => {
    const id = ++loadId.current;
    pending.current = null;
    abandonRun();
    setStatus({ phase: 'choose', overview: null, problem: null });
    void refreshOverview(id);
  }, [refreshOverview]);

  const place = useCallback((slot: number) => {
    const current = statusRef.current;
    if (
      current.phase !== 'playing' ||
      current.game.feedback ||
      placingLock.current
    ) {
      return;
    }
    placingLock.current = true;
    setPlacing(true);
    const id = loadId.current;
    const difficulty = current.difficulty;
    void (async () => {
      try {
        const response = await fetch('/api/daily/place', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ difficulty, slot }),
        });
        const body = await readBody(response);
        if (id !== loadId.current) return;
        const failure = parseDailyFailure(body);
        if (!response.ok || failure) {
          setStatus((latest) =>
            latest.phase === 'playing'
              ? {
                  ...latest,
                  problem:
                    failure?.message ??
                    'That placement didn’t save. Try the gap again.',
                }
              : latest
          );
          return;
        }
        const done = parseDailyDone(body);
        if (done) {
          setStatus(doneStatus(done));
          return;
        }
        const placed = parseDailyPlaced(body);
        if (!placed) {
          setStatus((latest) =>
            latest.phase === 'playing'
              ? {
                  ...latest,
                  problem: 'That placement didn’t save. Try the gap again.',
                }
              : latest
          );
          return;
        }
        const token = ++placementId.current;
        pending.current = { token, next: placed.next };
        setStatus((latest) => {
          if (latest.phase !== 'playing') return latest;
          return {
            ...latest,
            problem: null,
            game: { ...latest.game, feedback: placed.feedback },
          };
        });
      } catch (error) {
        console.error('Failed to save a placement', error);
        if (id !== loadId.current) return;
        setStatus((latest) =>
          latest.phase === 'playing'
            ? {
                ...latest,
                problem: 'That placement didn’t save. Try the gap again.',
              }
            : latest
        );
      } finally {
        placingLock.current = false;
        setPlacing(false);
      }
    })();
  }, []);

  const feedback = status.phase === 'playing' ? status.game.feedback : null;

  useEffect(() => {
    if (!feedback) return undefined;
    const token = placementId.current;
    const timer = window.setTimeout(
      () => {
        const move = pending.current;
        if (!move || move.token !== token) return;
        pending.current = null;
        const next = move.next;
        if (next.type === 'done') {
          finishRun(
            placementProgress(next.placed.length, next.steps),
            next.difficulty,
            next.lives > 0,
            next.score
          );
          setStatus(doneStatus(next));
          return;
        }
        noteProgress(
          placementProgress(next.placed.length, next.steps),
          next.difficulty
        );
        setStatus({
          phase: 'playing',
          difficulty: next.difficulty,
          game: playingStateFromDaily(next),
          steps: next.steps,
          problem: null,
        });
      },
      feedback.hit ? HIT_FEEDBACK_MS : MISS_FEEDBACK_MS
    );
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return { ...status, placing, place, start, reload, chooseAgain };
};
