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
  const lifeSize = dense ? 'dense' : compact ? 'compact' : 'full';
  return (
    <div className="flex items-start justify-end">
      <div
        className={`relative z-20 flex items-center gap-1 ${dense ? 'mt-3.5' : compact ? 'mt-7' : 'mt-9'}`}
        data-testid="lives"
        data-life-size={lifeSize}
        aria-label={`${Math.max(0, lives - (breaking ? 1 : 0))} of ${STARTING_LIVES} hourglasses`}
      >
        <span
          className={`inline-block leading-none text-[var(--muted)] ${dense ? 'text-[0.65rem]' : 'text-xs'} ${breaking ? 'is-closing' : ''}`}
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
              closing={breaking && index < breakingIndex}
              index={index}
            />
          );
        })}
      </div>
      <FatherTime
        smashing={breaking}
        className={dense ? '-ml-1 h-14' : compact ? '-ml-2 h-24' : '-ml-3 h-32'}
      />
    </div>
  );
};

const Hourglass = ({
  breaking,
  closing,
  compact,
  dense,
  index,
}: {
  breaking: boolean;
  closing: boolean;
  compact: boolean;
  dense: boolean;
  index: number;
}) => (
  <span
    className={`inline-flex leading-none ${closing ? 'is-closing' : ''} ${breaking ? 'relative z-30' : ''}`}
  >
    <svg
      viewBox="0 0 32 44"
      overflow="visible"
      data-testid={`life-${index}`}
      data-state={breaking ? 'breaking' : 'full'}
      className={`hourglass overflow-visible text-[var(--ink)] ${breaking ? 'is-breaking' : ''}`}
      width={dense ? 14 : compact ? 20 : 26}
      height={dense ? 20 : compact ? 28 : 36}
      aria-hidden
    >
      <g className="glass-intact">
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
      </g>
      <g className="glass-burst">
        <path className="shard" d="M10 10 L18 8 L15 18 Z" fill="currentColor" />
        <path className="shard" d="M18 9 L26 13 L19 18 Z" fill="currentColor" />
        <path className="shard" d="M9 22 L16 19 L13 28 Z" fill="currentColor" />
        <path
          className="shard"
          d="M18 22 L27 24 L20 31 Z"
          fill="currentColor"
        />
        <path className="shard" d="M12 30 L22 28 L16 37 Z" fill="#6b4423" />
        <circle className="particle" cx="15" cy="18" r="1.5" fill="#e2b340" />
        <circle className="particle" cx="19" cy="17" r="1.2" fill="#e2b340" />
        <circle className="particle" cx="13" cy="24" r="1.3" fill="#e2b340" />
        <circle className="particle" cx="21" cy="26" r="1.4" fill="#c9842a" />
        <circle className="particle" cx="16" cy="14" r="1.1" fill="#f3d98a" />
        <circle className="particle" cx="14" cy="32" r="1.3" fill="#6b4423" />
        <circle className="particle" cx="22" cy="33" r="1.2" fill="#6b4423" />
      </g>
    </svg>
  </span>
);
