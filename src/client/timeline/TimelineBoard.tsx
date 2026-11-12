import { navigateTo } from '@devvit/web/client';
import type { ReactNode, RefObject } from 'react';
import { formatYear, type PlacedCard } from '../../shared/timeline';
import type { TimelineLayout } from './useAspectRatio';

type TimelineBoardProps = {
  placed: PlacedCard[];
  layout: TimelineLayout;
  compact: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
  activeSlot: number | null;
  correctSlot: number | null;
  wrongSlot: number | null;
  interactive: boolean;
  locked: boolean;
  onPlace: (slot: number) => void;
};

const slotLabel = (index: number, placed: readonly PlacedCard[]): string => {
  const before = placed[index - 1];
  const after = placed[index];
  if (!before && after) return `Place before ${formatYear(after.event.year)}`;
  if (before && !after) return `Place after ${formatYear(before.event.year)}`;
  if (before && after) {
    return `Place between ${formatYear(before.event.year)} and ${formatYear(after.event.year)}`;
  }
  return 'Place on the timeline';
};

const Slot = ({
  index,
  label,
  layout,
  hot,
  correct,
  wrong,
  locked,
  onPlace,
}: {
  index: number;
  label: string;
  layout: TimelineLayout;
  hot: boolean;
  correct: boolean;
  wrong: boolean;
  locked: boolean;
  onPlace: (slot: number) => void;
}) => {
  const tone = correct
    ? 'slot-glow border-transparent bg-[var(--good)] text-[var(--on-good)]'
    : wrong
      ? 'border-transparent bg-[var(--miss)] text-[var(--on-miss)]'
      : hot
        ? 'scale-110 border-transparent bg-[var(--accent)] text-[var(--on-accent)]'
        : 'border-[var(--line)] bg-[var(--slot)] text-[var(--ink)]';
  const size =
    hot || correct || wrong ? 'h-12 w-12 text-lg' : 'h-8 w-8 text-base';
  return (
    <button
      type="button"
      data-testid="slot"
      data-slot={index}
      aria-label={label}
      disabled={locked}
      onClick={() => onPlace(index)}
      className={
        layout === 'row'
          ? 'relative z-10 flex min-h-28 w-14 shrink-0 cursor-pointer touch-manipulation items-center justify-center self-stretch disabled:cursor-default disabled:opacity-100'
          : 'relative z-10 flex h-14 w-full shrink-0 cursor-pointer touch-manipulation items-center justify-center disabled:cursor-default disabled:opacity-100'
      }
    >
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-full border font-semibold transition ${size} ${tone}`}
      >
        {correct ? '✓' : wrong ? '×' : '+'}
      </span>
    </button>
  );
};

const PlacedEvent = ({
  card,
  layout,
  compact,
}: {
  card: PlacedCard;
  layout: TimelineLayout;
  compact: boolean;
}) => {
  const wiki = card.event.url.startsWith('https://') ? card.event.url : null;
  const width =
    layout === 'row' ? (compact ? 'w-36' : 'w-44') : 'w-[min(100%,26rem)]';
  const border =
    card.hit === false ? 'border-[var(--miss)]' : 'border-[var(--card-line)]';
  return (
    <article
      data-testid="placed-card"
      data-event-id={card.event.id}
      data-year={card.event.year}
      className={`card-enter relative z-10 ${width} shrink-0 self-center rounded-2xl border bg-[var(--card)] px-3 py-3 text-left shadow-[var(--shadow)] ${border}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-xl leading-none text-[var(--accent)]">
          {formatYear(card.event.year)}
        </p>
        {card.hit === null ? (
          <p className="text-[0.65rem] tracking-[0.16em] text-[var(--muted)] uppercase">
            Start
          </p>
        ) : null}
        {card.hit === false ? (
          <p className="text-[0.65rem] tracking-[0.16em] text-[var(--miss)] uppercase">
            Missed
          </p>
        ) : null}
      </div>
      <p
        className={`mt-2 leading-snug ${compact && layout === 'row' ? 'line-clamp-3 text-xs' : 'line-clamp-4 text-sm'}`}
      >
        {card.event.text}
      </p>
      {wiki ? (
        <button
          type="button"
          className="mt-2 cursor-pointer text-[0.7rem] text-[var(--muted)] underline"
          onClick={() => navigateTo(wiki)}
        >
          Wikipedia
        </button>
      ) : null}
    </article>
  );
};

export const TimelineBoard = ({
  placed,
  layout,
  compact,
  scrollerRef,
  activeSlot,
  correctSlot,
  wrongSlot,
  interactive,
  locked,
  onPlace,
}: TimelineBoardProps) => {
  const nodes: ReactNode[] = [];
  for (let index = 0; index <= placed.length; index += 1) {
    if (interactive) {
      nodes.push(
        <Slot
          key={`slot-${index}`}
          index={index}
          label={slotLabel(index, placed)}
          layout={layout}
          hot={activeSlot === index && correctSlot === null}
          correct={correctSlot === index}
          wrong={wrongSlot === index && wrongSlot !== correctSlot}
          locked={locked}
          onPlace={onPlace}
        />
      );
    } else {
      nodes.push(
        <div
          key={`gap-${index}`}
          aria-hidden
          className={layout === 'row' ? 'w-6 shrink-0' : 'h-4'}
        />
      );
    }
    const card = placed[index];
    if (card) {
      nodes.push(
        <PlacedEvent
          key={card.event.id}
          card={card}
          layout={layout}
          compact={compact}
        />
      );
    }
  }

  return (
    <div
      ref={scrollerRef}
      data-testid="timeline"
      className={
        layout === 'row'
          ? 'timeline-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden'
          : 'timeline-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto'
      }
    >
      <div
        className={
          layout === 'row'
            ? 'flex h-full min-h-full w-max min-w-full items-center justify-center px-3 py-4'
            : 'flex min-h-full w-full flex-col items-center px-4 py-4'
        }
      >
        <div
          role="group"
          aria-label="Timeline"
          className={
            layout === 'row'
              ? 'relative flex min-h-48 items-center'
              : 'relative flex w-full max-w-lg flex-col items-center'
          }
        >
          <div
            aria-hidden
            className={
              layout === 'row'
                ? 'pointer-events-none absolute top-1/2 right-0 left-0 z-0 h-0.5 -translate-y-1/2 bg-[var(--line)] opacity-70'
                : 'pointer-events-none absolute top-0 bottom-0 left-1/2 z-0 w-0.5 -translate-x-1/2 bg-[var(--line)] opacity-70'
            }
          />
          {nodes}
        </div>
      </div>
    </div>
  );
};
