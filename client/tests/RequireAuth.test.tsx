import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import { RequireAuth } from '../src/admin/RequireAuth';

const USER = { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<p>Landing</p>} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <p>Secret dashboard</p>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockMe(user: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RequireAuth', () => {
  it('shows the children when signed in', async () => {
    mockMe(USER);

    renderAt('/admin');

    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
  });

  it('redirects to the landing page when signed out', async () => {
    mockMe(null);

    renderAt('/admin');

    expect(await screen.findByText('Landing')).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).toBeNull();
  });

  it('never flashes protected content while the check is pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('Secret dashboard')).toBeNull());
    expect(screen.queryByText('Landing')).toBeNull();
  });

  it('treats a failed check as signed out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    renderAt('/admin');

    expect(await screen.findByText('Landing')).toBeInTheDocument();
  });
});
