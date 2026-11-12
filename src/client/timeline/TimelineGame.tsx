import { navigateTo } from '@devvit/web/client';
import { useEffect, useRef } from 'react';
import {
  DIFFICULTIES,
  DIFFICULTY_BANDS,
  type Difficulty,
} from '../../shared/difficulty';
import {
  formatScore,
  formatYear,
  tally,
  type PlacedCard,
} from '../../shared/timeline';
import { ActiveCard } from './ActiveCard';
import { TimelineBoard } from './TimelineBoard';
import { useAspectRatio } from './useAspectRatio';
import { useCardDrag } from './useCardDrag';
import { useTimelineGame } from '../hooks/useTimelineGame';

export const TimelineGame = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { layout, compact } = useAspectRatio(shellRef);
  const status = useTimelineGame();
  const playing = status.phase === 'playing' ? status.game : null;
  const { drag, handlers } = useCardDrag({
    enabled: playing !== null && playing.feedback === null,
    layout,
    scrollerRef,
    onDrop: status.place,
  });

  const placedKey =
    status.phase === 'playing' || status.phase === 'done'
      ? status.game.placed.map((card) => card.event.id).join('\n')
      : '';
  const previousPlaced = useRef('');

  useEffect(() => {
    const current = placedKey.split('\n').filter((id) => id.length > 0);
    const prior = previousPlaced.current
      .split('\n')
      .filter((id) => id.length > 0);
    previousPlaced.current = placedKey;
    const fresh = current.filter((id) => !prior.includes(id));
    const freshId = fresh[0];
    if (prior.length === 0 || fresh.length !== 1 || !freshId) return;
    const node = document.querySelector(
      `[data-event-id="${CSS.escape(freshId)}"]`
    );
    if (!(node instanceof HTMLElement)) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches
      ? 'auto'
      : 'smooth';
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
  }, [placedKey]);

  const score =
    status.phase === 'playing' || status.phase === 'done'
      ? status.game.score
      : null;
  const scoreColor =
    score === null || score === 0
      ? 'text-[var(--ink)]'
      : score > 0
        ? 'text-[var(--good)]'
        : 'text-[var(--miss)]';
  const round =
    playing === null
      ? null
      : `${playing.placed.length} of ${playing.placed.length + playing.queue.length}`;
  const feedback = playing?.feedback ?? null;
  const showBoard = status.phase === 'playing' || status.phase === 'done';

  return (
    <div
      ref={shellRef}
      data-testid="game"
      data-layout={layout}
      className="game-shell flex h-full min-h-0 flex-col"
    >
      <header
        className={`flex shrink-0 items-start justify-between gap-3 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
      >
        <div className="min-w-0">
          <h1
            className={`font-display leading-none ${compact ? 'text-2xl' : 'text-3xl'}`}
          >
            Timeline
          </h1>
          <p className="mt-1 text-xs leading-snug text-[var(--muted)]">
            {status.phase === 'choose'
              ? 'Pick how well known the pages should be.'
              : status.phase === 'done'
                ? 'Every event is on its true year.'
                : compact
                  ? 'Drag or tap a gap. Right +1, wrong −1.'
                  : 'Drag into a gap, or tap one. Right +1, wrong −1.'}{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() =>
                navigateTo(
                  'https://en.wikipedia.org/wiki/Wikipedia:On_this_day'
                )
              }
            >
              Wikipedia
            </button>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
            Score
          </p>
          <p
            data-testid="score"
            className={`font-display text-3xl leading-none tabular-nums ${scoreColor}`}
          >
            {score === null ? '—' : formatScore(score)}
          </p>
          {status.phase !== 'choose' ? (
            <p data-testid="round" className="mt-1 text-xs text-[var(--muted)]">
              {round
                ? `${DIFFICULTY_BANDS[status.difficulty].label} · ${round}`
                : DIFFICULTY_BANDS[status.difficulty].label}
            </p>
          ) : null}
        </div>
      </header>

      {feedback ? (
        <p
          role="status"
          data-testid="feedback"
          className={`shrink-0 px-4 py-2 text-center text-sm font-semibold ${feedback.hit ? 'bg-[var(--good-bg)] text-[var(--good)]' : 'bg-[var(--miss-bg)] text-[var(--miss)]'}`}
        >
          {feedback.hit
            ? 'That gap is right.'
            : `That belongs in ${formatYear(feedback.year)}.`}
        </p>
      ) : null}

      {status.phase === 'choose' ? (
        <ModePicker layout={layout} compact={compact} onChoose={status.start} />
      ) : null}

      {status.phase === 'loading' ? (
        <div
          data-testid="loading"
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <p className="font-display text-4xl">
            {DIFFICULTY_BANDS[status.difficulty].label}
          </p>
          <p className="loading-line text-sm text-[var(--muted)]">
            Gathering pages from Wikipedia…
          </p>
        </div>
      ) : null}

      {status.phase === 'error' ? (
        <div
          data-testid="error"
          className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <p className="font-display text-3xl">
            {status.empty ? 'This range is thin' : 'The archive is quiet'}
          </p>
          <p className="max-w-xs text-sm text-[var(--muted)]">
            {status.empty
              ? 'Not enough pages landed in that range.'
              : 'Wikipedia didn’t answer, so there’s no timeline to play yet.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="btn" onClick={status.reload}>
              Try again
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              data-testid="change-difficulty"
              onClick={status.chooseAgain}
            >
              Change difficulty
            </button>
          </div>
        </div>
      ) : null}

      {showBoard ? (
        <TimelineBoard
          placed={status.game.placed}
          layout={layout}
          compact={compact}
          scrollerRef={scrollerRef}
          activeSlot={drag?.slot ?? null}
          correctSlot={feedback ? feedback.correct : null}
          wrongSlot={feedback && !feedback.hit ? feedback.slot : null}
          interactive={playing !== null}
          locked={feedback !== null}
          onPlace={status.place}
        />
      ) : null}

      {playing ? (
        <div
          className={`shrink-0 border-t border-[var(--card-line)] bg-[var(--paper)] ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
        >
          <ActiveCard
            key={playing.upcoming.id}
            event={playing.upcoming}
            feedback={playing.feedback}
            dragging={drag !== null}
            compact={compact}
            handlers={handlers}
          />
        </div>
      ) : null}

      {status.phase === 'done' ? (
        <Result
          score={status.game.score}
          placed={status.game.placed}
          onAgain={status.reload}
          onChange={status.chooseAgain}
        />
      ) : null}

      {drag && playing ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 w-[min(18rem,70vw)] rounded-2xl border border-[var(--accent)] bg-[var(--card)] px-3 py-3 text-sm shadow-[var(--shadow)]"
          style={{
            left: drag.x,
            top: drag.y,
            transform: 'translate(-50%, -70%)',
          }}
        >
          <p className="line-clamp-4 leading-snug">{playing.upcoming.text}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {drag.slot === null ? 'Drag to a gap' : 'Release to place'}
          </p>
        </div>
      ) : null}
    </div>
  );
};

const ModePicker = ({
  layout,
  compact,
  onChoose,
}: {
  layout: 'row' | 'column';
  compact: boolean;
  onChoose: (difficulty: Difficulty) => void;
}) => (
  <div
    data-testid="mode-picker"
    className="flex flex-1 flex-col items-center justify-center px-4 py-4"
  >
    <div
      className={
        layout === 'row'
          ? 'grid w-full max-w-3xl grid-cols-3 gap-3'
          : 'flex w-full max-w-sm flex-col gap-3'
      }
    >
      {DIFFICULTIES.map((id) => {
        const band = DIFFICULTY_BANDS[id];
        return (
          <button
            key={id}
            type="button"
            data-testid={`mode-${id}`}
            className={`cursor-pointer rounded-2xl border border-[var(--card-line)] bg-[var(--card)] text-left shadow-[var(--shadow)] ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}
            onClick={() => onChoose(id)}
          >
            <span
              className={`font-display leading-none ${compact ? 'text-xl' : 'text-2xl'}`}
            >
              {band.label}
            </span>
            <span className="mt-1 block text-sm text-[var(--muted)]">
              {band.detail}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

const Result = ({
  score,
  placed,
  onAgain,
  onChange,
}: {
  score: number;
  placed: PlacedCard[];
  onAgain: () => void;
  onChange: () => void;
}) => {
  const { right, wrong } = tally(placed);
  const color =
    score > 0
      ? 'text-[var(--good)]'
      : score < 0
        ? 'text-[var(--miss)]'
        : 'text-[var(--ink)]';
  return (
    <footer
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--card-line)] px-4 py-3"
      data-testid="result"
    >
      <div>
        <p className="text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
          Final score
        </p>
        <p
          className={`font-display text-4xl leading-none tabular-nums ${color}`}
        >
          {formatScore(score)}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {right} right · {wrong} wrong
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-quiet"
          data-testid="change-difficulty"
          onClick={onChange}
        >
          Change difficulty
        </button>
        <button
          type="button"
          className="btn"
          data-testid="play-again"
          onClick={onAgain}
        >
          Play again
        </button>
      </div>
    </footer>
  );
};
