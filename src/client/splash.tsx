import './index.css';

import { navigateTo, requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseDailyOverview, type DailyBoard } from '../shared/daily';
import {
  DIFFICULTIES,
  DIFFICULTY_BANDS,
  type Difficulty,
} from '../shared/difficulty';
import { formatScore } from '../shared/timeline';
import { FatherTime } from './timeline/FatherTime';

const WIKIPEDIA_DONATE =
  'https://donate.wikimedia.org/w/index.php?title=Special:LandingPage&country=US&uselang=en&wmf_medium=spontaneous&wmf_source=fr-redir&wmf_campaign=spontaneous';

const SLOTS = [0, 1, 2, 3, 4];

const emptyBoards = (): Record<Difficulty, DailyBoard> => ({
  easy: { top: [], you: null },
  medium: { top: [], you: null },
  hard: { top: [], you: null },
});

const SplashLeaderboard = ({
  boards,
}: {
  boards: Record<Difficulty, DailyBoard>;
}) => (
  <section
    data-testid="splash-leaderboard"
    className="shrink-0 border-t border-[var(--card-line)] bg-[var(--card)] px-2 pt-1 pb-1.5"
  >
    <p className="text-center text-[0.6rem] font-semibold tracking-[0.18em] text-[var(--muted)] uppercase">
      Daily Leaderboard
    </p>
    <div className="mt-1 grid w-full grid-cols-3">
      {DIFFICULTIES.map((id) => (
        <div
          key={id}
          data-testid={`splash-board-${id}`}
          className="min-w-0 px-1.5"
        >
          <p className="text-center font-display text-sm leading-none">
            {DIFFICULTY_BANDS[id].label}
          </p>
          <ol className="mt-0.5">
            {SLOTS.map((slot) => {
              const entry = boards[id].top[slot] ?? null;
              return (
                <li
                  key={slot}
                  data-filled={entry ? 'true' : 'false'}
                  className={`flex h-4 items-baseline gap-1 text-[0.65rem] leading-4 ${
                    entry?.you ? 'font-semibold' : ''
                  }`}
                >
                  <span className="w-3 shrink-0 tabular-nums text-[var(--muted)]">
                    {slot + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry?.username ?? ''}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--good)]">
                    {entry ? formatScore(entry.score) : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  </section>
);

export const Splash = () => {
  const [boards, setBoards] = useState(emptyBoards);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/daily', {
          signal: controller.signal,
        });
        const overview = parseDailyOverview(await response.json());
        if (overview) setBoards(overview.boards);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        console.error('Failed to load the daily boards', error);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="game-shell flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-2">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <FatherTime className="h-40" />
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="logo-title text-[3.5rem]">
              Father
              <span className="block text-[var(--accent)]">Timeline</span>
            </h1>
            <p className="text-base text-[var(--muted)]">
              Powered by{' '}
              <button
                type="button"
                className="cursor-pointer font-semibold text-[var(--ink)] underline"
                onClick={() => navigateTo(WIKIPEDIA_DONATE)}
              >
                Wikipedia
              </button>
            </p>
            <button
              type="button"
              className="btn btn-lg"
              onClick={(event) =>
                requestExpandedMode(event.nativeEvent, 'game')
              }
            >
              Play
            </button>
          </div>
        </div>
      </div>
      <SplashLeaderboard boards={boards} />
    </div>
  );
};

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
