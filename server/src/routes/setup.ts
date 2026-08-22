import { limits } from '../config/env';
import { prisma } from '../prisma/client';
import { createResourceRouter } from '../lib/resourceRouter';
import { setupCreateSchema, setupUpdateSchema } from '../schemas/content';

export const setupRouters = createResourceRouter({
  path: 'setup',
  noun: 'Setup item',
  delegate: prisma.setupItem,
  createSchema: setupCreateSchema,
  max: () => limits().maxSetup,
  plural: 'setup rows',
  updateSchema: setupUpdateSchema,
});
