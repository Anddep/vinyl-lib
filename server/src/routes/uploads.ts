import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../lib/asyncHandler';
import { sniffImageType } from '../lib/imageType';
import { requireUser } from '../middleware/requireUser';

export const uploadsRouter = Router();

/**
 * Where covers land. A named Docker volume mounts over this path in every
 * environment; UPLOAD_DIR overrides it so tests can write to a temp directory
 * instead of the source tree.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(__dirname, '..', '..', 'uploads');

const MAX_BYTES = 5 * 1024 * 1024;

// memoryStorage so nothing touches disk until the bytes have been sniffed —
// diskStorage would write the payload first and ask questions afterwards.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

uploadsRouter.post(
  '/uploads',
  requireUser,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const type = sniffImageType(req.file.buffer);
    if (!type) {
      res.status(400).json({ error: 'Not a supported image (jpeg, png, webp or avif)' });
      return;
    }

    // Generated name and an extension derived from the sniffed type, so
    // neither the client filename nor its extension reaches the filesystem.
    const filename = `${randomUUID()}.${type}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer);

    res.status(201).json({ url: `/uploads/${filename}` });
  }),
);

// multer rejects outside the normal error chain; translate its size error into
// the status that actually describes it.
uploadsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is larger than 5 MB' });
    return;
  }
  next(err);
});
