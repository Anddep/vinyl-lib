import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../src/admin/RequireAuth';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/login" element={<p>Login screen</p>} />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <p>Secret dashboard</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockAuth(authenticated: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ authenticated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RequireAuth', () => {
  it('shows the children when authenticated', async () => {
    mockAuth(true);

    renderAt('/admin');

    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', async () => {
    mockAuth(false);

    renderAt('/admin');

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).toBeNull();
  });

  it('never flashes protected content while the check is pending', async () => {
    // A pending promise: the guard must render nothing rather than optimistically
    // showing the shell to someone who may not be signed in.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('Secret dashboard')).toBeNull());
    expect(screen.queryByText('Login screen')).toBeNull();
  });

  it('treats a failed auth check as unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    renderAt('/admin');

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });
});
