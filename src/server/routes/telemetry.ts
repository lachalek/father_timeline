import {
  TELEMETRY_UNSPECIFIED_RECEIPT,
  type JourneyReceipt,
} from '@devvit/analytics/shared/reddit';
import { Hono } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';

const invalidReceipt: JourneyReceipt = {
  status: 'JOURNEY_RECEIPT_INVALID',
  message: 'Invalid: Event payload was not recorded.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const readBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const telemetryRoutes = new Hono();

telemetryRoutes.post('/journey/start', async (c) => {
  try {
    const response = await telemetry.startJourney();
    if (!isText(response.journeyId)) {
      return c.json(
        {
          error: 'Internal server error',
          receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
        },
        500
      );
    }
    return c.json(response);
  } catch (error) {
    console.error('Telemetry start failed', error);
    return c.json(
      {
        error: 'Internal server error',
        receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
      },
      500
    );
  }
});

telemetryRoutes.post('/journey/app-ready', async (c) => {
  try {
    return c.json(await telemetry.appReady());
  } catch (error) {
    console.error('Telemetry app ready failed', error);
    return c.json(
      {
        error: 'Internal server error',
        receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
      },
      500
    );
  }
});

telemetryRoutes.post('/journey/progress', async (c) => {
  const body = await readBody(c.req.raw);
  if (!isRecord(body) || !isText(body.journeyId)) {
    return c.json(
      { error: 'journeyId is required.', receipt: invalidReceipt },
      400
    );
  }
  if (
    typeof body.progress !== 'number' ||
    !Number.isFinite(body.progress) ||
    body.progress < 0 ||
    body.progress > 1
  ) {
    return c.json(
      {
        error: 'progress must be a number between 0 and 1.',
        receipt: invalidReceipt,
      },
      400
    );
  }
  if (body.action !== undefined && !isText(body.action)) {
    return c.json(
      { error: 'action must be a non-empty string.', receipt: invalidReceipt },
      400
    );
  }
  if (body.actionDetails !== undefined && !isText(body.actionDetails)) {
    return c.json(
      {
        error: 'actionDetails must be a non-empty string.',
        receipt: invalidReceipt,
      },
      400
    );
  }
  try {
    const response = await telemetry.journeyProgress({
      journeyId: body.journeyId,
      progress: body.progress,
      ...(isText(body.action) ? { action: body.action } : {}),
      ...(isText(body.actionDetails)
        ? { actionDetails: body.actionDetails }
        : {}),
    });
    return c.json(response);
  } catch (error) {
    console.error('Telemetry progress failed', error);
    return c.json(
      {
        error: 'Internal server error',
        receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
      },
      500
    );
  }
});

telemetryRoutes.post('/journey/interaction', async (c) => {
  const body = await readBody(c.req.raw);
  if (!isRecord(body) || !isText(body.action)) {
    return c.json(
      { error: 'action is required.', receipt: invalidReceipt },
      400
    );
  }
  if (body.journeyId !== undefined && typeof body.journeyId !== 'string') {
    return c.json(
      { error: 'journeyId must be a string.', receipt: invalidReceipt },
      400
    );
  }
  if (body.actionDetails !== undefined && !isText(body.actionDetails)) {
    return c.json(
      {
        error: 'actionDetails must be a non-empty string.',
        receipt: invalidReceipt,
      },
      400
    );
  }
  try {
    const response = await telemetry.journeyInteraction({
      journeyId: isText(body.journeyId) ? body.journeyId : '',
      action: body.action,
      actionDetails: isText(body.actionDetails) ? body.actionDetails : '',
    });
    return c.json(response);
  } catch (error) {
    console.error('Telemetry interaction failed', error);
    return c.json(
      {
        error: 'Internal server error',
        receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
      },
      500
    );
  }
});

telemetryRoutes.post('/journey/end', async (c) => {
  const body = await readBody(c.req.raw);
  if (!isRecord(body) || !isText(body.journeyId)) {
    return c.json(
      { error: 'journeyId is required.', receipt: invalidReceipt },
      400
    );
  }
  if (body.complete !== undefined && typeof body.complete !== 'boolean') {
    return c.json(
      { error: 'complete must be a boolean.', receipt: invalidReceipt },
      400
    );
  }
  if (body.game !== undefined && !isRecord(body.game)) {
    return c.json(
      { error: 'game must be an object.', receipt: invalidReceipt },
      400
    );
  }
  const game = isRecord(body.game) ? body.game : null;
  if (game && game.win !== undefined && typeof game.win !== 'boolean') {
    return c.json(
      { error: 'game.win must be a boolean.', receipt: invalidReceipt },
      400
    );
  }
  if (
    game &&
    game.score !== undefined &&
    (typeof game.score !== 'number' || !Number.isFinite(game.score))
  ) {
    return c.json(
      { error: 'game.score must be a number.', receipt: invalidReceipt },
      400
    );
  }
  try {
    const response = await telemetry.endJourney({
      journeyId: body.journeyId,
      complete: body.complete === true,
      ...(game
        ? {
            game: {
              win: game.win === true,
              score: typeof game.score === 'number' ? game.score : 0,
            },
          }
        : {}),
    });
    return c.json(response);
  } catch (error) {
    console.error('Telemetry end failed', error);
    return c.json(
      {
        error: 'Internal server error',
        receipt: TELEMETRY_UNSPECIFIED_RECEIPT,
      },
      500
    );
  }
});
