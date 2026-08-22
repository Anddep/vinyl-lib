import { readdir, rm } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { UPLOAD_DIR } from '../../src/routes/uploads';
import { signInAgent } from '../helpers/auth';

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

  it('stores a png under a generated name and returns its url', async () => {
    const { agent } = await signInAgent();
    const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

    expect(response.status).toBe(201);
    // The client filename never reaches the path — the name is a fresh UUID.
    expect(response.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);

    const written = await readdir(UPLOAD_DIR);
    expect(written).toContain(response.body.url.replace('/uploads/', ''));
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
