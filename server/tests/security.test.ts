import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('CORS', () => {
  it('does not hand a wildcard origin to an arbitrary site', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    // The site and its API are same-origin behind both proxies, so no
    // cross-origin caller should ever be granted access.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not answer a cross-origin preflight for a write route', async () => {
    const response = await request(app)
      .options('/api/records')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('still sets helmet defaults', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
