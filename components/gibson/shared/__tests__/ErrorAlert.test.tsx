import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';

describe('ErrorAlert', () => {
  it('renders the error message', () => {
    render(<ErrorAlert error={{ message: 'Something went wrong on our end.' }} />);
    expect(screen.getByText('Something went wrong on our end.')).toBeInTheDocument();
  });

  // dashboard#705: real failures render as a BOLD FILLED banner (legible
  // white-on-red), not muddy dark-red text on the near-black card, and carry
  // the warning icon.
  it('renders a bold filled error banner with an icon', () => {
    const { container } = render(<ErrorAlert error={{ message: 'boom' }} title="Failed" />);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('bg-destructive');
    expect(alert.className).toContain('text-destructive-foreground');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  // dashboard#516: the banner copy promises a reference; when the API error
  // envelope carries a correlationId, surface it so users can quote it.
  it('renders the reference id when provided', () => {
    render(
      <ErrorAlert
        error={{ message: 'Trace data temporarily unavailable' }}
        reference="ref-abc123"
      />,
    );
    expect(screen.getByText(/ref-abc123/)).toBeInTheDocument();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
  });

  it('omits the reference line when no reference is given', () => {
    render(<ErrorAlert error={{ message: 'boom' }} />);
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });
});
