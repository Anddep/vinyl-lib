import { collectionApi } from './client';

/**
 * The signed-in user's own collection.
 *
 * A module constant rather than a hook: the scope cannot change within a
 * session, and a fresh object per render would be noise for `useResource`,
 * which wants a stable fetcher.
 */
export const ownCollection = collectionApi({ kind: 'own' });
