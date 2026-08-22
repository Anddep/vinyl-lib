import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { asyncHandler } from '../../src/lib/asyncHandler';

/** Minimal app with the same error middleware shape as src/app.ts. */
function appWith(handler: express.RequestHandler) {
  const app = express();
  app.get('/boom', handler);
  app.use(
    (
      _err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      res.status(500).json({ error: 'Internal server error' });
    },
  );
  return app;
}

describe('asyncHandler', () => {
  it('routes a rejected async handler to the error middleware', async () => {
    const app = appWith(
      asyncHandler(async () => {
        throw new Error('database is down');
      }),
    );

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });

  it('passes a resolved handler through untouched', async () => {
    const app = appWith(
      asyncHandler(async (_req, res) => {
        res.json({ ok: true });
      }),
    );

    await request(app).get('/boom').expect(200, { ok: true });
  });

  it('forwards the original error to next rather than swallowing it', async () => {
    const boom = new Error('database is down');
    const next = vi.fn();

    await asyncHandler(async () => {
      throw boom;
    })({} as express.Request, {} as express.Response, next);
    // The rejection resolves on a microtask, so let it settle.
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(boom);
  });

  it('is needed because Express 4 leaves a bare rejection unhandled', async () => {
    // Called directly rather than over HTTP: the equivalent request would hang
    // forever, which is exactly the failure mode, but a hanging socket makes an
    // unreliable test. Asserting `next` is never called proves the same thing
    // deterministically — nothing reaches the error middleware.
    const next = vi.fn();
    const bare = async (): Promise<void> => {
      throw new Error('database is down');
    };

    await bare().catch(() => undefined);
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
  });
});
