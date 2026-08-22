import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/ui/Button';

describe('Button', () => {
  it('renders a link when given an href, so anchor navigation keeps link semantics', () => {
    render(<Button href="#featured">Browse Collection</Button>);

    const link = screen.getByRole('link', { name: 'Browse Collection' });
    expect(link).toHaveAttribute('href', '#featured');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a button defaulting to type=button when given no href', () => {
    render(<Button>Send Message</Button>);

    const button = screen.getByRole('button', { name: 'Send Message' });
    // Without an explicit type, a button inside a form submits it.
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps an explicit type, so submit buttons still submit', () => {
    render(<Button type="submit">Send Message</Button>);

    expect(screen.getByRole('button', { name: 'Send Message' })).toHaveAttribute('type', 'submit');
  });
});
