import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';

function Probe(): JSX.Element {
  const { user, loading } = useAuth();
  if (loading) {
    return <p>checking</p>;
  }
  return <p>{user ? user.displayName : 'nobody'}</p>;
}

function mockMe(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AuthProvider', () => {
  it('exposes the signed-in user', async () => {
    mockMe({
      user: { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('Andriy')).toBeInTheDocument();
  });

  it('exposes null when signed out', async () => {
    mockMe({ user: null });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('nobody')).toBeInTheDocument();
  });

  it('treats a failed check as signed out rather than crashing the tree', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('nobody')).toBeInTheDocument();
  });

  it('throws when used outside the provider, so a missing mount is loud', () => {
    // React logs the thrown error; silence it so the run stays readable.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    quiet.mockRestore();
  });
});
