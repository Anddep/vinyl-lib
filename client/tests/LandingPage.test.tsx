import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import LandingPage from '../src/pages/LandingPage';

/** /auth/me and /auth/providers are both fetched on mount. */
function mockApi(user: unknown, providers: string[] = ['google', 'github']) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('/auth/providers') ? providers : { user };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/u/:slug" element={<p>Andriy collection</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('LandingPage', () => {
  it('renders one sign-in link per configured provider', async () => {
    mockApi(null);

    renderAt('/');

    const google = await screen.findByRole('link', { name: /google/i });
    expect(google).toHaveAttribute('href', '/api/auth/google');
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      '/api/auth/github',
    );
  });

  it('offers only what the server says is configured', async () => {
    mockApi(null, ['google']);

    renderAt('/');

    await screen.findByRole('link', { name: /google/i });
    expect(screen.queryByRole('link', { name: /github/i })).toBeNull();
  });

  it('carries an invite code onto every provider link', async () => {
    mockApi(null);

    renderAt('/?invite=abc123');

    expect(await screen.findByRole('link', { name: /google/i })).toHaveAttribute(
      'href',
      '/api/auth/google?invite=abc123',
    );
  });

  it('explains a failed sign-in', async () => {
    mockApi(null);

    renderAt('/?error=email_unverified');

    expect(await screen.findByRole('alert')).toHaveTextContent(/verified email/i);
  });

  it('explains an invite-only signup without blaming the visitor', async () => {
    mockApi(null);

    renderAt('/?error=invite_required');

    expect(await screen.findByRole('alert')).toHaveTextContent(/invit/i);
  });

  it('sends a signed-in owner to their own collection', async () => {
    mockApi({ id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true });

    renderAt('/');

    expect(await screen.findByText('Andriy collection')).toBeInTheDocument();
  });
});
