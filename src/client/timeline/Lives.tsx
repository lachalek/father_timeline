import { STARTING_LIVES } from '../../shared/timeline';
import { FatherTime } from './FatherTime';

export const Lives = ({
  lives,
  breaking,
  compact,
  dense = false,
}: {
  lives: number;
  breaking: boolean;
  compact: boolean;
  dense?: boolean;
}) => {
  const breakingIndex = breaking ? lives - 1 : -1;
  return (
    <div className="flex items-end justify-end">
      <div
        className="relative z-20 flex items-center gap-1"
        data-testid="lives"
        aria-label={`${Math.max(0, lives - (breaking ? 1 : 0))} of ${STARTING_LIVES} hourglasses`}
      >
        <span
          className={`leading-none text-[var(--muted)] ${dense ? 'text-[0.65rem]' : 'text-xs'}`}
        >
          Lives:
        </span>
        {Array.from({ length: STARTING_LIVES }, (_, index) => {
          const state =
            index === breakingIndex
              ? 'breaking'
              : index < lives
                ? 'full'
                : 'gone';
          if (state === 'gone') {
            return (
              <span
                key={index}
                data-testid={`life-${index}`}
                data-state="gone"
                className="inline-block"
              />
            );
          }
          return (
            <Hourglass
              key={index}
              compact={compact || dense}
              dense={dense}
              breaking={state === 'breaking'}
              index={index}
            />
          );
        })}
      </div>
      <FatherTime
        smashing={breaking}
        className={
          dense ? '-ml-1 h-14' : compact ? '-ml-2 h-24' : '-ml-3 h-32'
        }
      />
    </div>
  );
};

const Hourglass = ({
  breaking,
  compact,
  dense,
  index,
}: {
  breaking: boolean;
  compact: boolean;
  dense: boolean;
  index: number;
}) => (
  <svg
    viewBox="0 0 32 44"
    data-testid={`life-${index}`}
    data-state={breaking ? 'breaking' : 'full'}
    className={`hourglass text-[var(--ink)] ${breaking ? 'is-breaking' : ''}`}
    width={dense ? 14 : compact ? 20 : 26}
    height={dense ? 20 : compact ? 28 : 36}
    aria-hidden
  >
    <g className="glass-top">
      <path
        d="M7 7 H25 L18 20 H14 Z"
        fill="rgb(255 255 255 / 28%)"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M11 9 H21 L17.2 16 H14.8 Z" fill="#e2b340" />
    </g>
    <g className="glass-bottom">
      <path
        d="M7 37 H25 L18 24 H14 Z"
        fill="rgb(255 255 255 / 28%)"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M13 33 H19 L17.2 27 H14.8 Z" fill="#e2b340" />
    </g>
    <g className="glass-cap">
      <rect x="5" y="4" width="22" height="3.2" rx="1" fill="#6b4423" />
      <rect x="5" y="36.8" width="22" height="3.2" rx="1" fill="#6b4423" />
    </g>
  </svg>
);
