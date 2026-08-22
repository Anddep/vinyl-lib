import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageField } from '../src/admin/components/ImageField';

/**
 * ImageField is controlled, so a bare mock leaves `value` frozen and every
 * keystroke reports a single character. This harness feeds the value back the
 * way a real form does.
 */
function Harness({
  onChange,
  initial = null,
}: {
  onChange: (v: string | null) => void;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <ImageField
      label="Cover"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ImageField', () => {
  it('reports a pasted url', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /url/i }));
    await userEvent.type(screen.getByLabelText(/image url/i), 'https://example.com/a.jpg');

    expect(onChange).toHaveBeenLastCalledWith('https://example.com/a.jpg');
    expect(screen.getByLabelText(/image url/i)).toHaveValue('https://example.com/a.jpg');
  });

  it('clears the value', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Cover" value="https://example.com/a.jpg" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uploads a file and reports the returned path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/uploads/abc.png' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onChange = vi.fn();
    render(<ImageField label="Cover" value={null} onChange={onChange} />);

    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/choose a file/i), file);

    expect(onChange).toHaveBeenCalledWith('/uploads/abc.png');

    // No JSON Content-Type: the browser must set the multipart boundary.
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('surfaces an upload failure instead of silently doing nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'File is larger than 5 MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onChange = vi.fn();
    render(<ImageField label="Cover" value={null} onChange={onChange} />);

    const file = new File(['x'], 'big.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/choose a file/i), file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/larger than 5 MB/i);
    expect(onChange).not.toHaveBeenCalled();
  });
});
