import './index.css';

import { navigateTo, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FatherTime } from './timeline/FatherTime';

const WIKIPEDIA_DONATE =
  'https://donate.wikimedia.org/w/index.php?title=Special:LandingPage&country=US&uselang=en&wmf_medium=spontaneous&wmf_source=fr-redir&wmf_campaign=spontaneous';

export const Splash = () => {
  return (
    <div className="game-shell flex h-full min-h-0 items-center justify-center px-4 py-3">
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
            onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
          >
            Play
          </button>
        </div>
      </div>
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
