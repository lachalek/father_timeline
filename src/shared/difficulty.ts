export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type DifficultyBand = {
  label: string;
  detail: string;
  /** Inclusive yearly pageviews. */
  min: number;
  /** Exclusive ceiling. Null means no ceiling. */
  max: number | null;
};

export const DIFFICULTY_BANDS: Record<Difficulty, DifficultyBand> = {
  easy: {
    label: 'Easy',
    detail: '1M+ views a year',
    min: 1_000_000,
    max: null,
  },
  medium: {
    label: 'Medium',
    detail: '100K–1M views a year',
    min: 100_000,
    max: 1_000_000,
  },
  hard: {
    label: 'Hard',
    detail: '10K–100K views a year',
    min: 10_000,
    max: 100_000,
  },
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  value === 'easy' || value === 'medium' || value === 'hard';

export const matchesDifficulty = (
  views: number,
  difficulty: Difficulty
): boolean => {
  const band = DIFFICULTY_BANDS[difficulty];
  if (views < band.min) return false;
  if (band.max !== null && views >= band.max) return false;
  return true;
};
