import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loginAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe.each([
  ['/api/wishlist', { title: 'Karma', artist: 'Pharoah Sanders' }],
  ['/api/setup', { icon: 'turntable', label: 'Turntable', value: 'Technics SL-1200 MK2' }],
])('%s writes', (url, valid) => {
  it('rejects an unauthenticated create', async () => {
    const response = await request(app).post(url).send(valid);
    expect(response.status).toBe(401);
  });

  it('rejects an unauthenticated delete', async () => {
    const response = await request(app).delete(`${url}/1`);
    expect(response.status).toBe(401);
  });

  it('creates, updates and deletes', async () => {
    const agent = await loginAgent();

    const created = await agent.post(url).send(valid);
    expect(created.status).toBe(201);
    expect(created.body.position).toBe(0);

    const updated = await agent.patch(`${url}/${created.body.id}`).send({ position: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.position).toBe(3);

    await agent.delete(`${url}/${created.body.id}`).expect(204);
  });

  it('404s an unknown id', async () => {
    const agent = await loginAgent();
    await agent.patch(`${url}/9999`).send({ position: 1 }).expect(404);
    await agent.delete(`${url}/9999`).expect(404);
  });

  it('reports missing required fields by name', async () => {
    const agent = await loginAgent();
    const response = await agent.post(url).send({});

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields).length).toBeGreaterThan(0);
  });
});

describe('wishlist cover art', () => {
  it('accepts an uploaded path and an external URL', async () => {
    const agent = await loginAgent();

    await agent
      .post('/api/wishlist')
      .send({ title: 'A', artist: 'X', coverUrl: '/uploads/abc.png' })
      .expect(201);
    await agent
      .post('/api/wishlist')
      .send({ title: 'B', artist: 'X', coverUrl: 'https://img.example/a.jpg' })
      .expect(201);
  });

  it('rejects a javascript: cover URL', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/wishlist')
      .send({ title: 'C', artist: 'X', coverUrl: 'javascript:alert(1)' });

    expect(response.status).toBe(400);
    expect(response.body.fields.coverUrl).toBeDefined();
  });

  it('no longer accepts the removed pressing field', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/wishlist')
      .send({ title: 'D', artist: 'X', pressing: '1971 original' });

    expect(response.status).toBe(201);
    expect(response.body.pressing).toBeUndefined();
  });
});

describe('setup icon validation', () => {
  it('rejects an icon with no matching component', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/setup')
      .send({ icon: 'gramophone', label: 'X', value: 'Y' });

    expect(response.status).toBe(400);
    expect(response.body.fields.icon).toBeDefined();
  });

  it.each(['turntable', 'cartridge', 'amplifier', 'speakers', 'cable'])(
    'accepts the %s icon',
    async (icon) => {
      const agent = await loginAgent();
      await agent.post('/api/setup').send({ icon, label: 'X', value: 'Y' }).expect(201);
    },
  );
});

describe('PATCH /api/settings', () => {
  it('requires a session', async () => {
    await request(app).patch('/api/settings').send({ collectingSince: '2009' }).expect(401);
  });

  it('upserts and overwrites a setting', async () => {
    const agent = await loginAgent();

    await agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);
    await agent.patch('/api/settings').send({ collectingSince: '2011' }).expect(200);

    const stored = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });
    expect(stored?.value).toBe('2011');
  });

  it('stores the hero and setup copy', async () => {
    const agent = await loginAgent();

    const response = await agent.patch('/api/settings').send({
      heroEyebrow: 'Personal vinyl library · est. 2009',
      heroHeadline: 'Andriy keeps\nthe records\nspinning',
      heroLede: 'Every sleeve here has been played at least twice.',
      setupHeading: 'What it all plays on',
    });

    expect(response.status).toBe(200);
    // Newlines survive the round trip — the headline is broken by hand.
    expect(response.body.heroHeadline).toBe('Andriy keeps\nthe records\nspinning');
    expect(response.body.setupHeading).toBe('What it all plays on');
  });

  it('accepts an uploaded path for the section images', async () => {
    const agent = await loginAgent();

    const response = await agent
      .patch('/api/settings')
      .send({ heroImageUrl: '/uploads/hero.jpg', setupImageUrl: 'https://img.example/setup.jpg' });

    expect(response.status).toBe(200);
    expect(response.body.heroImageUrl).toBe('/uploads/hero.jpg');
  });

  it('rejects a javascript: image URL', async () => {
    const agent = await loginAgent();
    const response = await agent
      .patch('/api/settings')
      .send({ heroImageUrl: 'javascript:alert(1)' });

    expect(response.status).toBe(400);
    expect(response.body.fields.heroImageUrl).toBeDefined();
  });

  it('rejects an unknown key rather than storing junk', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/settings').send({ nonsense: 'x' });

    expect(response.status).toBe(400);
  });

  it('rejects a year that is not four digits', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/settings').send({ collectingSince: 'ages ago' });

    expect(response.status).toBe(400);
    expect(response.body.fields.collectingSince).toBeDefined();
  });
});

describe('GET /api/settings', () => {
  it('returns stored settings as a flat object', async () => {
    const agent = await loginAgent();
    await agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);

    const response = await request(app).get('/api/settings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ collectingSince: '2009' });
  });

  it('returns an empty object before anything is set', async () => {
    const response = await request(app).get('/api/settings');

    expect(response.body).toEqual({});
  });
});
