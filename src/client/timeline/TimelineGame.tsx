import { navigateTo } from '@devvit/web/client';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  DAILY_LOGIN_MESSAGE,
  formatDailyDate,
  ordinal,
  type DailyBoard,
  type LevelStanding,
} from '../../shared/daily';
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
import { useTimelineGame } from '../hooks/useTimelineGame';
import { ActiveCard } from './ActiveCard';
import { FatherTime } from './FatherTime';
import { markReady } from './journey';
import { Lives } from './Lives';
import { TimelineBoard } from './TimelineBoard';
import { useAspectRatio } from './useAspectRatio';
import { useCardDrag } from './useCardDrag';

export const TimelineGame = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { layout, compact, fullscreen } = useAspectRatio(shellRef);
  const mobile = layout === 'column';
  const status = useTimelineGame();
  const playing = status.phase === 'playing' ? status.game : null;
  const { drag, handlers } = useCardDrag({
    enabled: playing !== null && playing.feedback === null && !status.placing,
    layout,
    scrollerRef,
    onDrop: status.place,
  });

  useEffect(() => {
    markReady();
  }, []);

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
  const feedback = playing?.feedback ?? null;
  const showBoard = status.phase === 'playing' || status.phase === 'done';
  const lives =
    status.phase === 'playing' || status.phase === 'done'
      ? status.game.lives
      : null;
  const guidance =
    status.phase === 'choose'
      ? 'One shared deck for each level. You can play each one once today.'
      : status.phase === 'done'
        ? lives === 0
          ? null
          : 'Every event is on its true year.'
        : mobile
          ? null
          : 'Drag the event onto the timeline, or tap the timeline to place the event.';
  const doneDock = fullscreen && status.phase === 'done' && layout === 'row';

  return (
    <div
      ref={shellRef}
      data-testid="game"
      data-layout={layout}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      className="game-shell flex h-full min-h-0 flex-col"
    >
      <header
        className={
          fullscreen
            ? `relative z-30 shrink-0 px-8 ${doneDock ? 'pt-2 pb-0' : status.phase === 'done' ? 'pt-3 pb-0' : 'pt-5 pb-1'}`
            : `relative z-30 flex shrink-0 justify-between ${mobile ? 'items-center gap-2 px-3 py-1' : 'items-start gap-3 px-4 py-3'}`
        }
      >
        {fullscreen && !doneDock ? (
          <div className="absolute top-5 right-8 text-right">
            <p className="text-xs tracking-[0.18em] text-[var(--muted)] uppercase">
              Score
            </p>
            <p
              data-testid="score"
              className={`font-display text-4xl leading-none tabular-nums ${scoreColor}`}
            >
              {score === null ? '—' : formatScore(score)}
            </p>
            {status.phase !== 'choose' ? (
              <p
                data-testid="difficulty"
                className="mt-1 text-sm text-[var(--muted)]"
              >
                {DIFFICULTY_BANDS[status.difficulty].label}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className={fullscreen ? 'flex flex-col items-center' : 'min-w-0'}>
          <h1
            className={`logo-title ${fullscreen ? `${doneDock ? 'pb-0 text-[2.75rem]' : status.phase === 'done' ? 'pb-1 text-[4.25rem]' : 'pb-2 text-[4.25rem]'}` : mobile ? 'text-base whitespace-nowrap' : 'text-[2rem]'}`}
          >
            Father <span className="text-[var(--accent)]">Timeline</span>
          </h1>
          {mobile && score !== null ? (
            <p className="mt-1 flex items-baseline gap-1.5 leading-none">
              <span className="text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
                Score
              </span>
              <span
                data-testid="score"
                className={`font-display text-lg tabular-nums ${scoreColor}`}
              >
                {formatScore(score)}
              </span>
            </p>
          ) : null}
          {guidance ? (
            <p
              className={`mt-1 leading-snug text-[var(--muted)] ${fullscreen ? 'text-center text-sm' : 'text-xs'}`}
            >
              {guidance}{' '}
              <button
                type="button"
                className="cursor-pointer font-semibold text-[var(--ink)] underline"
                onClick={() =>
                  navigateTo(
                    'https://en.wikipedia.org/wiki/Wikipedia:On_this_day'
                  )
                }
              >
                Wikipedia
              </button>
            </p>
          ) : null}
          {fullscreen && lives !== null ? (
            <Lives
              lives={lives}
              breaking={feedback !== null && !feedback.hit}
              compact={false}
              fullscreen
              settled={status.phase === 'done'}
              defeated={status.phase === 'done' && lives === 0}
            />
          ) : null}
        </div>
        {fullscreen ? null : (
          <div className={`shrink-0 ${mobile ? '' : 'text-right'}`}>
            {lives !== null ? (
              <Lives
                lives={lives}
                breaking={feedback !== null && !feedback.hit}
                compact={compact}
                dense={mobile || status.phase === 'done'}
                defeated={status.phase === 'done' && lives === 0}
              />
            ) : null}
            {mobile || status.phase === 'done' ? null : (
              <>
                <p className="mt-1 text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
                  Score
                </p>
                <p
                  data-testid="score"
                  className={`font-display text-3xl leading-none tabular-nums ${scoreColor}`}
                >
                  {score === null ? '—' : formatScore(score)}
                </p>
                {status.phase !== 'choose' ? (
                  <p
                    data-testid="difficulty"
                    className="mt-1 text-xs text-[var(--muted)]"
                  >
                    {DIFFICULTY_BANDS[status.difficulty].label}
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </header>

      {feedback ? (
        <p
          role="status"
          data-testid="feedback"
          className={`shrink-0 px-4 py-2 text-center text-sm font-semibold ${feedback.hit ? 'bg-[var(--good-bg)] text-[var(--good)]' : 'bg-[var(--miss-bg)] text-[var(--miss)]'}`}
        >
          {feedback.hit
            ? 'Correct!'
            : `That belongs in ${formatYear(feedback.year)}.`}
        </p>
      ) : null}

      {status.phase === 'choose' ? (
        <ModePicker
          layout={layout}
          compact={compact}
          overview={status.overview}
          problem={status.problem}
          onChoose={status.start}
        />
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
            Dealing today’s deck…
          </p>
        </div>
      ) : null}

      {status.phase === 'error' ? (
        <div
          data-testid="error"
          className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <p className="font-display text-3xl">The archive is quiet</p>
          <p className="max-w-xs text-sm text-[var(--muted)]">
            {status.message}
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
              Back to levels
            </button>
          </div>
        </div>
      ) : null}

      {showBoard ? (
        <TimelineBoard
          placed={status.game.placed}
          layout={layout}
          compact={compact}
          fullscreen={fullscreen}
          settled={status.phase === 'done'}
          scrollerRef={scrollerRef}
          activeSlot={drag?.slot ?? null}
          correctSlot={feedback ? feedback.correct : null}
          wrongSlot={feedback && !feedback.hit ? feedback.slot : null}
          interactive={playing !== null}
          locked={feedback !== null}
          onPlace={status.place}
          hint={
            mobile &&
            playing !== null &&
            playing.placed.length === 1 &&
            playing.feedback === null
              ? 'Drag the event onto the timeline, or tap the timeline to place the event.'
              : null
          }
        />
      ) : null}

      {playing ? (
        <div
          className={`shrink-0 border-t border-[var(--card-line)] bg-[var(--paper)] ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
        >
          {status.phase === 'playing' && status.problem ? (
            <p
              data-testid="place-error"
              className="mb-2 text-center text-sm text-[var(--miss)]"
            >
              {status.problem}
            </p>
          ) : null}
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
        doneDock ? (
          <div className="shrink-0 px-8 pt-10 pb-3">
            <div className="mx-auto flex w-full max-w-5xl items-end justify-center gap-10">
              <LevelLeaderboard
                board={status.boards[status.difficulty]}
                label={DIFFICULTY_BANDS[status.difficulty].label}
                date={status.date}
                layout={layout}
                docked
              />
              <Result
                score={status.game.score}
                lives={status.game.lives}
                placed={status.game.placed}
                compact={compact}
                docked
                onChange={status.chooseAgain}
              />
            </div>
          </div>
        ) : (
          <>
            <LevelLeaderboard
              board={status.boards[status.difficulty]}
              label={DIFFICULTY_BANDS[status.difficulty].label}
              date={status.date}
              layout={layout}
              fullscreen={fullscreen}
            />
            <Result
              score={status.game.score}
              lives={status.game.lives}
              placed={status.game.placed}
              compact={compact}
              dense={fullscreen}
              onChange={status.chooseAgain}
            />
          </>
        )
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

const bestLine = (standing: LevelStanding | undefined): string => {
  if (standing?.best === null || standing?.best === undefined) {
    return 'Personal Best: —';
  }
  return `Personal Best: ${formatScore(standing.best)}`;
};

const ModePicker = ({
  layout,
  compact,
  overview,
  problem,
  onChoose,
}: {
  layout: 'row' | 'column';
  compact: boolean;
  overview: {
    loggedIn: boolean;
    levels: Record<Difficulty, LevelStanding>;
  } | null;
  problem: string | null;
  onChoose: (difficulty: Difficulty) => void;
}) => {
  const wide = layout === 'row';
  return (
    <div
      data-testid="mode-picker"
      className={`flex min-h-0 flex-1 flex-col items-center justify-center ${wide ? 'gap-6 px-8 py-2' : 'gap-4 px-4 py-3'}`}
    >
      <FatherTime
        className={
          wide ? (compact ? 'h-28' : 'h-44') : compact ? 'h-32' : 'h-56'
        }
      />
      <div
        className={`flex w-full min-w-0 flex-col items-center gap-3 ${wide ? 'max-w-5xl' : 'max-w-sm'}`}
      >
        {overview && !overview.loggedIn ? (
          <p
            data-testid="login-required"
            className="max-w-xs text-center text-sm text-[var(--ink)]"
          >
            {DAILY_LOGIN_MESSAGE}
          </p>
        ) : (
          <div
            className={
              wide
                ? 'grid w-full grid-cols-3 gap-4'
                : 'flex w-full flex-col gap-3'
            }
          >
            {DIFFICULTIES.map((id) => {
              const band = DIFFICULTY_BANDS[id];
              const standing = overview?.levels[id];
              const played = standing?.played === true;
              const dailyScore =
                played &&
                standing?.score !== null &&
                standing?.score !== undefined
                  ? standing.score
                  : null;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`mode-${id}`}
                  data-played={played ? 'true' : 'false'}
                  className={`flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border text-left shadow-[var(--shadow)] ${compact ? 'px-3 py-3' : 'px-4 py-4'} ${
                    played
                      ? 'border-[var(--played-line)] bg-[var(--played)] text-[var(--ink)]'
                      : 'border-[var(--card-line)] bg-[var(--card)] text-[var(--ink)]'
                  }`}
                  onClick={() => onChoose(id)}
                >
                  <span className="min-w-0">
                    <span
                      className={`block font-display leading-none ${wide || compact ? 'text-xl' : 'text-2xl'}`}
                    >
                      {band.label}
                    </span>
                    <span
                      className={`mt-1 block text-[var(--ink)] ${wide ? 'text-xs' : 'text-sm'}`}
                    >
                      {bestLine(standing)}
                    </span>
                  </span>
                  {dailyScore !== null ? (
                    <span className="shrink-0 text-right">
                      <span className="block text-[0.65rem] tracking-[0.12em] text-[var(--ink)] uppercase">
                        Daily Score
                      </span>
                      <span
                        className={`mt-1 block font-display leading-none text-[var(--good)] ${wide || compact ? 'text-2xl' : 'text-3xl'}`}
                      >
                        {formatScore(dailyScore)}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {problem ? (
          <p className="max-w-xs text-center text-sm text-[var(--miss)]">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
};

const BOARD_SLOTS = [0, 1, 2, 3, 4];

const LeaderboardSlot = ({
  board,
  slot,
  roomy,
}: {
  board: DailyBoard;
  slot: number;
  roomy: boolean;
}) => {
  const entry = board.top[slot] ?? null;
  return (
    <li
      data-filled={entry ? 'true' : 'false'}
      data-you={entry?.you ? 'true' : 'false'}
      className={`flex min-w-0 items-baseline ${
        roomy
          ? `gap-2 rounded-lg px-2 py-1 text-sm ${entry?.you ? 'bg-[var(--good-bg)] font-semibold' : ''}`
          : `h-4 gap-1 text-xs ${entry?.you ? 'font-semibold' : ''}`
      }`}
    >
      <span
        className={`shrink-0 text-center tabular-nums ${roomy ? 'w-4 font-display' : 'w-3'} ${
          entry && slot === 0 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
        }`}
      >
        {slot + 1}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry?.username ?? ''}</span>
      <span
        className={`shrink-0 text-[var(--good)] tabular-nums ${roomy ? 'font-display text-lg leading-none' : ''}`}
      >
        {entry ? formatScore(entry.score) : ''}
      </span>
    </li>
  );
};

const LeaderboardCard = ({
  board,
  label,
  date,
  rankLine,
}: {
  board: DailyBoard;
  label: string;
  date: string;
  rankLine: ReactNode;
}) => (
  <div className="w-full overflow-hidden rounded-2xl border border-[var(--card-line)] bg-[var(--card)] shadow-[var(--shadow)]">
    <div className="border-b border-[var(--card-line)] px-4 py-2 text-center">
      <p className="font-display text-xl leading-none">Daily Leaderboard</p>
      <p className="mt-1 text-[0.65rem] tracking-[0.14em] text-[var(--muted)] uppercase">
        {label} · {formatDailyDate(date)}
      </p>
    </div>
    <ol className="space-y-0.5 px-2 py-1.5">
      {BOARD_SLOTS.map((slot) => (
        <LeaderboardSlot key={slot} board={board} slot={slot} roomy />
      ))}
    </ol>
    {rankLine ? <div className="px-3 pb-2">{rankLine}</div> : null}
  </div>
);

const LevelLeaderboard = ({
  board,
  label,
  date,
  layout,
  fullscreen = false,
  docked = false,
}: {
  board: DailyBoard;
  label: string;
  date: string;
  layout: 'row' | 'column';
  fullscreen?: boolean;
  docked?: boolean;
}) => {
  const listed = board.top.some((entry) => entry.you);
  const rankLine =
    board.you && !listed ? (
      <p
        data-testid="your-rank"
        className="mt-1 text-center text-xs font-semibold"
      >
        {board.you.username} · {ordinal(board.you.rank)} ·{' '}
        {formatScore(board.you.score)}
      </p>
    ) : null;
  if (layout === 'row') {
    if (docked) {
      return (
        <section
          data-testid="leaderboard"
          className="min-w-0 w-full max-w-md flex-1"
        >
          <LeaderboardCard
            board={board}
            label={label}
            date={date}
            rankLine={rankLine}
          />
        </section>
      );
    }
    return (
      <section
        data-testid="leaderboard"
        className={`shrink-0 px-4 pb-2 ${fullscreen ? 'pt-3' : 'pt-1'}`}
      >
        <LeaderboardCard
          board={board}
          label={label}
          date={date}
          rankLine={rankLine}
        />
      </section>
    );
  }
  return (
    <section
      data-testid="leaderboard"
      className="shrink-0 border-t border-[var(--card-line)] bg-[var(--card)] px-3 py-1.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-base leading-none">Daily Leaderboard</p>
        <p className="text-[0.6rem] tracking-[0.14em] text-[var(--muted)] uppercase">
          {label} · {formatDailyDate(date)}
        </p>
      </div>
      <ol className="mt-1">
        {BOARD_SLOTS.map((slot) => (
          <LeaderboardSlot key={slot} board={board} slot={slot} roomy={false} />
        ))}
      </ol>
      {rankLine}
    </section>
  );
};

const Result = ({
  score,
  lives: _lives,
  placed,
  compact,
  dense = false,
  docked = false,
  onChange,
}: {
  score: number;
  lives: number;
  placed: PlacedCard[];
  compact: boolean;
  dense?: boolean;
  docked?: boolean;
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
      className={`flex shrink-0 gap-3 px-4 ${docked ? 'w-auto flex-col items-end border-0 py-0 pr-0' : `flex-wrap items-center justify-between border-t border-[var(--card-line)] ${dense ? 'py-1.5' : 'py-2'}`}`}
      data-testid="result"
    >
      <div>
        <p className="text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
          Final score
        </p>
        <p
          className={`font-display leading-none tabular-nums ${compact ? 'text-3xl' : 'text-4xl'} ${color}`}
        >
          {formatScore(score)}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {right} right · {wrong} wrong
        </p>
      </div>
      <button
        type="button"
        className="btn"
        data-testid="change-difficulty"
        onClick={onChange}
      >
        Back to levels
      </button>
    </footer>
  );
};
