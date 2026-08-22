import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { limits } from '../../src/config/env';
import { UPLOAD_DIR } from '../../src/routes/uploads';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

afterAll(async () => {
  await rm(UPLOAD_DIR, { recursive: true, force: true });
});

describe('POST /api/uploads', () => {
  it('requires a session', async () => {
    const response = await request(app).post('/api/uploads').attach('file', png, 'cover.png');
    expect(response.status).toBe(401);
  });

  it('stores a png under the owner directory and returns its url', async () => {
    const { agent, user } = await signInAgent();
    const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

    expect(response.status).toBe(201);
    // The client filename never reaches the path — the name is a fresh UUID,
    // under a directory named for the owner.
    expect(response.body.url).toMatch(new RegExp(`^/uploads/${user.id}/[0-9a-f-]{36}\\.png$`));

    const written = await readdir(join(UPLOAD_DIR, String(user.id)));
    expect(written).toContain(response.body.url.split('/').pop());
  });

  it('records the bytes against the owner', async () => {
    const { agent, user } = await signInAgent();
    await agent.post('/api/uploads').attach('file', png, 'cover.png').expect(201);

    const rows = await prisma.upload.findMany({ where: { ownerId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].bytes).toBe(png.length);
  });

  it('refuses a file that would cross the quota, and writes nothing', async () => {
    const { agent, user } = await signInAgent();
    // Pre-fill the ledger to one byte under the cap.
    await prisma.upload.create({
      data: { ownerId: user.id, path: `${user.id}/seed.png`, bytes: limits().uploadQuotaBytes - 1 },
    });

    const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

    expect(response.status).toBe(413);
    expect(await prisma.upload.count({ where: { ownerId: user.id } })).toBe(1);
  });

  it('does not count one owner usage against another', async () => {
    const first = await signInAgent();
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });
    await prisma.upload.create({
      data: {
        ownerId: first.user.id,
        path: `${first.user.id}/seed.png`,
        bytes: limits().uploadQuotaBytes,
      },
    });

    await first.agent.post('/api/uploads').attach('file', png, 'cover.png').expect(413);
    await second.agent.post('/api/uploads').attach('file', png, 'cover.png').expect(201);
  });

  it('rejects a payload whose extension lies', async () => {
    const { agent } = await signInAgent();
    const response = await agent
      .post('/api/uploads')
      .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), 'cover.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/image/i);
  });

  it('rejects an SVG even though it is an image format', async () => {
    const { agent } = await signInAgent();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

    const response = await agent.post('/api/uploads').attach('file', svg, 'cover.svg');

    expect(response.status).toBe(400);
  });

  it('rejects a file over the 5 MB cap', async () => {
    const { agent } = await signInAgent();
    const oversized = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);

    const response = await agent.post('/api/uploads').attach('file', oversized, 'big.png');

    expect(response.status).toBe(413);
  });

  it('400s when no file is attached', async () => {
    const { agent } = await signInAgent();
    const response = await agent.post('/api/uploads');

    expect(response.status).toBe(400);
  });
});
