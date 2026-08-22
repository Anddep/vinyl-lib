import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WishlistPage from '../src/admin/WishlistPage';

const items = [{ id: 1, title: 'Karma', artist: 'Pharoah Sanders', position: 0 }];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('WishlistPage', () => {
  it('deletes only after confirmation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(items));

    render(<WishlistPage />);
    expect(await screen.findByText('Karma')).toBeInTheDocument();

    const rowDelete = () =>
      within(screen.getByRole('table')).getByRole('button', { name: /delete/i });

    await userEvent.click(rowDelete());
    const callsBefore = fetchSpy.mock.calls.length;

    // Cancel must not issue any request.
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }),
    );
    expect(fetchSpy.mock.calls).toHaveLength(callsBefore);

    await userEvent.click(rowDelete());
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }),
    );

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/wishlist/1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('omits a blank optional url rather than sending an empty string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

    render(<WishlistPage />);

    await userEvent.type(screen.getByLabelText(/^title$/i), 'Fly or Die');
    await userEvent.type(screen.getByLabelText(/^artist$/i), 'jaimie branch');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const post = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    const body = JSON.parse((post?.[1] as RequestInit).body as string);

    // An empty string would fail the URL protocol allowlist server-side.
    expect(body.url).toBeUndefined();
    expect(body.position).toBe(0);
    expect(body.title).toBe('Fly or Die');
  });

  it('renders server field errors against the matching input', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ error: 'Validation failed', fields: { title: 'Title is required' } }, 400),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });

    render(<WishlistPage />);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Title is required');
  });
});
