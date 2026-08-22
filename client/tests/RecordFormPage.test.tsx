import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecordFormPage from '../src/admin/records/RecordFormPage';

afterEach(() => vi.restoreAllMocks());

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/records/new']}>
      <Routes>
        <Route path="/admin/records/new" element={<RecordFormPage />} />
        <Route path="/admin/records" element={<p>Records list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillRequired(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^title$/i), 'Bitches Brew');
  await userEvent.type(screen.getByLabelText(/^artist$/i), 'Miles Davis');
  await userEvent.type(screen.getByLabelText(/^year$/i), '1970');
  await userEvent.type(screen.getByLabelText(/^format$/i), '2×LP');
  await userEvent.type(screen.getByLabelText(/^genre$/i), 'Jazz');
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RecordFormPage', () => {
  it('renders server field errors against the right inputs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { error: 'Validation failed', fields: { url: 'Must be an http or https URL' } },
        400,
      ),
    );

    renderNew();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Must be an http or https URL')).toBeInTheDocument();
  });

  it('sends year as a number, not a string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 1 }, 201));

    renderNew();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // The zod schema is z.number(); a string "1970" would come back a 400.
    expect(body.year).toBe(1970);
    expect(typeof body.year).toBe('number');
  });

  it('omits blank optional fields rather than sending empty strings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 1 }, 201));

    renderNew();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // An empty string url would fail the protocol allowlist; it must be absent.
    expect(body.url).toBeUndefined();
    expect(body.note).toBeUndefined();
    expect(body.label).toBeUndefined();
  });

  it('navigates back to the list after a successful save', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 1 }, 201));

    renderNew();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Records list')).toBeInTheDocument();
  });

  it('shows a form-level error when the request fails outright', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    renderNew();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network down|could not save/i);
  });
});
