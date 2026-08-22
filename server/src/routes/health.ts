import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';

export const healthRouter = Router();

/**
 * Deliberately not wrapped in asyncHandler. A healthcheck should answer 503
 * "database unreachable" rather than a generic 500 — the Docker healthcheck
 * and any monitor read this endpoint to decide whether the service is up.
 */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
      message: error instanceof Error ? error.message : 'Unknown database error',
    });
  }
});
