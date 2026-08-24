import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../src/admin/AccountPage';
import { AuthProvider } from '../src/auth/AuthProvider';

const USER = { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true };

function mockApi(patch: { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (init?.method === 'PATCH') {
      return json(patch.body, patch.status);
    }
    return json({ user: USER });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

// The form is in the document from the first render, empty, and an effect fills
// it once AuthProvider has fetched the user. Waiting for an element is not
// enough, because the elements are already there: a read can catch a field
// while it is still blank, and an edit can be undone when the effect lands
// afterwards and puts the fetched values back. Wait for the data instead.
async function renderLoadedPage(): Promise<void> {
  renderPage();
  await waitFor(() => expect(screen.getByLabelText(/address/i)).toHaveValue(USER.slug));
}

afterEach(() => vi.restoreAllMocks());

describe('AccountPage', () => {
  it('shows the current address and the URL it produces', async () => {
    mockApi({ status: 200, body: USER });

    await renderLoadedPage();

    expect(screen.getByLabelText(/address/i)).toHaveValue('andriy');
    expect(screen.getByText(/\/u\/andriy/)).toBeInTheDocument();
  });

  it('warns that changing the address breaks shared links', async () => {
    mockApi({ status: 200, body: USER });

    renderPage();

    expect(await screen.findByText(/links you have already shared/i)).toBeInTheDocument();
  });

  it('saves a new address', async () => {
    const fetchStub = mockApi({ status: 200, body: { ...USER, slug: 'andriy-d' } });

    await renderLoadedPage();
    const field = screen.getByLabelText(/address/i);
    await userEvent.clear(field);
    await userEvent.type(field, 'andriy-d');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[1]?.body)).toContain('andriy-d');
  });

  it('renders a taken address as a field error, not a page error', async () => {
    mockApi({
      status: 409,
      body: { error: 'Validation failed', fields: { slug: 'That address is taken' } },
    });

    await renderLoadedPage();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/taken/i);
  });

  it('toggles the collection between public and private', async () => {
    const fetchStub = mockApi({ status: 200, body: { ...USER, isPublic: false } });

    await renderLoadedPage();
    await userEvent.click(screen.getByLabelText(/visible to anyone/i));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[1]?.body)).toContain('"isPublic":false');
  });
});
