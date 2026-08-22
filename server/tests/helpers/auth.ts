import request from 'supertest';
import { app } from '../../src/app';

/**
 * A Supertest agent carrying an authenticated session cookie.
 * The password matches the hash set in tests/setup.ts.
 */
export async function loginAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ password: 'test-password' }).expect(204);
  return agent;
}
