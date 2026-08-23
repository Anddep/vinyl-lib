import type { SetupItem, SiteSettings, VinylRecord, WishlistItem } from '../types/collection';

export interface Stats {
  totalRecords: number;
  topGenre: { name: string; count: number } | null;
  topArtist: { name: string; count: number } | null;
  collectingSince: string | null;
  addedLast30Days: number;
}

/** Carries the API's per-field validation errors so forms can render them inline. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // Merged after the spread so a caller passing its own headers extends the
    // defaults instead of replacing them and losing Content-Type.
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      problem?.error ?? `Request to ${path} failed with ${response.status}`,
      response.status,
      problem?.fields ?? {},
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/** Whose collection a set of reads is about. */
export type Scope = { kind: 'own' } | { kind: 'public'; slug: string };

export interface Genre {
  name: string;
  count: number;
}

export interface CollectionApi {
  getRecords: () => Promise<VinylRecord[]>;
  getRecentRecords: () => Promise<VinylRecord[]>;
  getStats: () => Promise<Stats>;
  getGenres: () => Promise<Genre[]>;
  getWishlist: () => Promise<WishlistItem[]>;
  getSetup: () => Promise<SetupItem[]>;
  getSettings: () => Promise<SiteSettings>;
}

/**
 * The seven collection reads, bound to one owner.
 *
 * The two scopes differ only in a path prefix, which is the point: the section
 * components take data as props and never learn whose it is, so the public
 * collection page and the admin dashboard render from the same code.
 *
 * Mutations are deliberately not here. They are always the signed-in user's
 * own, and giving them a scope would imply one that does not exist.
 */
export function collectionApi(scope: Scope): CollectionApi {
  const base = scope.kind === 'own' ? '' : `/u/${encodeURIComponent(scope.slug)}`;

  return {
    getRecords: () => request<VinylRecord[]>(`${base}/records`),
    getRecentRecords: () => request<VinylRecord[]>(`${base}/records?sort=addedAt&limit=6`),
    getStats: () => request<Stats>(`${base}/stats`),
    getGenres: () => request<Genre[]>(`${base}/genres`),
    getWishlist: () => request<WishlistItem[]>(`${base}/wishlist`),
    getSetup: () => request<SetupItem[]>(`${base}/setup`),
    getSettings: () => request<SiteSettings>(`${base}/settings`),
  };
}

/* ---- Record CRUD ---- */

export const getRecord = (id: number): Promise<VinylRecord> =>
  request<VinylRecord>(`/records/${id}`);

export const createRecord = (data: unknown): Promise<VinylRecord> =>
  request<VinylRecord>('/records', { method: 'POST', body: JSON.stringify(data) });

export const updateRecord = (id: number, data: unknown): Promise<VinylRecord> =>
  request<VinylRecord>(`/records/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteRecord = (id: number): Promise<void> =>
  request<void>(`/records/${id}`, { method: 'DELETE' });

/* ---- Wishlist and setup CRUD ---- */

export const createWishlistItem = (data: unknown): Promise<WishlistItem> =>
  request<WishlistItem>('/wishlist', { method: 'POST', body: JSON.stringify(data) });
export const updateWishlistItem = (id: number, data: unknown): Promise<WishlistItem> =>
  request<WishlistItem>(`/wishlist/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteWishlistItem = (id: number): Promise<void> =>
  request<void>(`/wishlist/${id}`, { method: 'DELETE' });

export const createSetupItem = (data: unknown): Promise<SetupItem> =>
  request<SetupItem>('/setup', { method: 'POST', body: JSON.stringify(data) });
export const updateSetupItem = (id: number, data: unknown): Promise<SetupItem> =>
  request<SetupItem>(`/setup/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSetupItem = (id: number): Promise<void> =>
  request<void>(`/setup/${id}`, { method: 'DELETE' });

/* ---- Settings ---- */

export const updateSettings = (data: SiteSettings): Promise<SiteSettings> =>
  request<SiteSettings>('/settings', { method: 'PATCH', body: JSON.stringify(data) });

/* ---- Profile and account ---- */

/** What a visitor is told about a collection's owner. */
export interface Profile {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export const getProfile = (slug: string): Promise<Profile> =>
  request<Profile>(`/u/${encodeURIComponent(slug)}`);

export interface AuthUser {
  id: number;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export interface AccountUpdate {
  slug?: string;
  displayName?: string;
  isPublic?: boolean;
}

export const updateAccount = (data: AccountUpdate): Promise<AuthUser> =>
  request<AuthUser>('/account', { method: 'PATCH', body: JSON.stringify(data) });

/* ---- Auth ---- */

/** `{ user: null }` when signed out — "nobody" is an answer, not an error. */
export const getAuthStatus = (): Promise<{ user: AuthUser | null }> =>
  request<{ user: AuthUser | null }>('/auth/me');

/** Which providers the server can actually complete a sign-in with. */
export const getProviders = (): Promise<string[]> => request<string[]>('/auth/providers');

export const logout = (): Promise<void> => request<void>('/auth/logout', { method: 'POST' });

/**
 * Deliberately bypasses `request()`: that helper always sets a JSON
 * Content-Type, which would override the multipart boundary the browser needs
 * to generate for a FormData body.
 */
export async function uploadCover(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/uploads', { method: 'POST', body });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(problem?.error ?? 'Upload failed', response.status, problem?.fields ?? {});
  }
  return response.json() as Promise<{ url: string }>;
}
