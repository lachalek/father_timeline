import { telemetry } from '@devvit/analytics/client/reddit';
import type { Difficulty } from '../../shared/difficulty';

let ready = false;
let open = false;

const quiet = async (run: () => Promise<unknown>): Promise<void> => {
  try {
    await run();
  } catch (error) {
    console.error('Journey telemetry failed', error);
  }
};

export const markReady = (): void => {
  if (ready) return;
  ready = true;
  void quiet(() => telemetry.appReady());
};

export const beginRun = (): void => {
  if (open) return;
  open = true;
  void quiet(async () => {
    if (!telemetry.getActiveJourneyId()) await telemetry.startJourney();
  });
};

export const noteProgress = (
  progress: number,
  difficulty: Difficulty
): void => {
  if (!open || progress <= 0) return;
  void quiet(() => telemetry.progress({ progress, action: difficulty }));
};

export const finishRun = (
  progress: number,
  difficulty: Difficulty,
  won: boolean,
  score: number
): void => {
  if (!open) return;
  open = false;
  void quiet(async () => {
    if (progress > 0) {
      await telemetry.progress({ progress, action: difficulty });
    }
    await telemetry.endJourney({
      complete: won,
      game: { win: won, score },
    });
  });
};

export const abandonRun = (): void => {
  if (!open) return;
  open = false;
  void quiet(() => telemetry.endJourney({ complete: false }));
};
