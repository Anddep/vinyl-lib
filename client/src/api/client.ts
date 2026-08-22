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

export const getRecentRecords = (): Promise<VinylRecord[]> =>
  request<VinylRecord[]>('/records?sort=addedAt&limit=6');

export const getStats = (): Promise<Stats> => request<Stats>('/stats');

export interface Genre {
  name: string;
  count: number;
}

/** Genres actually present in the collection — drives the homepage filter. */
export const getGenres = (): Promise<Genre[]> => request<Genre[]>('/genres');
export const getWishlist = (): Promise<WishlistItem[]> => request<WishlistItem[]>('/wishlist');
export const getSetup = (): Promise<SetupItem[]> => request<SetupItem[]>('/setup');

/* ---- Record CRUD ---- */

export const getRecords = (): Promise<VinylRecord[]> => request<VinylRecord[]>('/records');

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

export const getSettings = (): Promise<SiteSettings> => request<SiteSettings>('/settings');

export const updateSettings = (data: SiteSettings): Promise<SiteSettings> =>
  request<SiteSettings>('/settings', { method: 'PATCH', body: JSON.stringify(data) });

/* ---- Auth ---- */

export const getAuthStatus = (): Promise<{ authenticated: boolean }> =>
  request<{ authenticated: boolean }>('/auth/me');

export const login = (password: string): Promise<void> =>
  request<void>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });

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
