import './index.css';

import { navigateTo, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="game-shell flex h-full min-h-0 flex-col items-center justify-center gap-3 px-5 py-4 text-center">
      <p className="text-[0.68rem] tracking-[0.22em] text-[var(--muted)] uppercase">
        A history game
      </p>
      <h1 className="font-display text-4xl leading-none">Timeline</h1>
      <p className="max-w-sm text-sm leading-snug text-[var(--muted)]">
        Choose easy, medium, or hard, then drag each event into place.
      </p>
      <div aria-hidden className="flex items-center gap-2 py-1">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
        <span className="h-0.5 w-8 bg-[var(--line)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" />
        <span className="h-0.5 w-8 bg-[var(--line)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" />
      </div>
      <button
        type="button"
        className="btn"
        onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
      >
        Play
      </button>
      <button
        type="button"
        className="cursor-pointer text-xs text-[var(--muted)] underline"
        onClick={() =>
          navigateTo('https://en.wikipedia.org/wiki/Wikipedia:On_this_day')
        }
      >
        Events from Wikipedia
      </button>
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
