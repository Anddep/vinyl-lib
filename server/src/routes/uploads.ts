import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { limits } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { sniffImageType } from '../lib/imageType';
import { ownerOf } from '../lib/owner';
import { requireUser } from '../middleware/requireUser';
import { prisma } from '../prisma/client';

export const uploadsRouter = Router();

/**
 * Where covers land. A named Docker volume mounts over this path in every
 * environment; UPLOAD_DIR overrides it so tests can write to a temp directory
 * instead of the source tree.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(__dirname, '..', '..', 'uploads');

// memoryStorage so nothing touches disk until the bytes have been sniffed —
// diskStorage would write the payload first and ask questions afterwards.
// The cap is read once at import: multer wants it when the middleware is built,
// and it is not a value that changes while the process runs.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limits().maxUploadBytes, files: 1 },
});

uploadsRouter.post(
  '/uploads',
  requireUser,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const ownerId = ownerOf(res);

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const type = sniffImageType(req.file.buffer);
    if (!type) {
      res.status(400).json({ error: 'Not a supported image (jpeg, png, webp or avif)' });
      return;
    }

    // One indexed sum, rather than walking the owner directory: a readdir plus
    // a stat per file would be O(n) on the hot path of every upload.
    const used = await prisma.upload.aggregate({ where: { ownerId }, _sum: { bytes: true } });
    if ((used._sum.bytes ?? 0) + req.file.size > limits().uploadQuotaBytes) {
      res.status(413).json({ error: 'Upload quota reached. Remove some covers first.' });
      return;
    }

    // Generated name and an extension derived from the sniffed type, so neither
    // the client filename nor its extension reaches the filesystem. The owner
    // directory makes ownership legible on disk and makes per-user cleanup
    // possible when an account goes.
    const relative = `${ownerId}/${randomUUID()}.${type}`;
    await mkdir(path.join(UPLOAD_DIR, String(ownerId)), { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, relative), req.file.buffer);
    // File first, row second: a file with no row is a leak the operator can
    // find, where a row with no file would 404 a cover that appears to exist.
    await prisma.upload.create({ data: { ownerId, path: relative, bytes: req.file.size } });

    res.status(201).json({ url: `/uploads/${relative}` });
  }),
);

// multer rejects outside the normal error chain; translate its size error into
// the status that actually describes it.
uploadsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is larger than the per-file limit' });
    return;
  }
  next(err);
});
