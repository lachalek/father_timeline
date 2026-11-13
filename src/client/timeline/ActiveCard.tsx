import {
  formatYear,
  type PlacementFeedback,
  type TimelineEvent,
} from '../../shared/timeline';
import type { CardPointerHandlers } from './useCardDrag';

export const ActiveCard = ({
  event,
  feedback,
  dragging,
  compact,
  handlers,
}: {
  event: TimelineEvent;
  feedback: PlacementFeedback | null;
  dragging: boolean;
  compact: boolean;
  handlers: CardPointerHandlers;
}) => {
  const tone = feedback
    ? feedback.hit
      ? 'border-solid border-[var(--good)]'
      : 'shake border-solid border-[var(--miss)]'
    : 'border-dashed border-[var(--accent)]';
  return (
    <article
      data-testid="active-card"
      aria-grabbed={dragging}
      aria-describedby="place-hint"
      className={`touch-none rounded-2xl border-2 bg-[var(--card)] text-left shadow-[var(--shadow)] select-none ${tone} ${dragging ? 'cursor-grabbing opacity-35' : 'cursor-grab'} ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
      {...handlers}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.65rem] tracking-[0.18em] text-[var(--muted)] uppercase">
          {event.kind === 'birth' ? 'Birth' : 'Event'}
        </p>
        <p
          className={`font-display leading-none ${compact ? 'text-lg' : 'text-2xl'} ${feedback ? (feedback.hit ? 'text-[var(--good)]' : 'text-[var(--miss)]') : 'text-[var(--muted)]'}`}
        >
          {feedback ? formatYear(feedback.year) : 'Year hidden'}
        </p>
      </div>
      <p
        className={`mt-2 leading-snug ${compact ? 'line-clamp-3 text-sm' : 'line-clamp-4 text-base'}`}
      >
        {event.text}
      </p>
      <p id="place-hint" className="mt-2 text-xs text-[var(--muted)]">
        {feedback
          ? feedback.hit
            ? 'Right gap. +1'
            : 'Wrong gap.'
          : 'Drag onto the line, or tap a gap.'}
      </p>
    </article>
  );
};
