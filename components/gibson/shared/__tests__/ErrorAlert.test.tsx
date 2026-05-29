import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';

describe('ErrorAlert', () => {
  it('renders the error message', () => {
    render(<ErrorAlert error={{ message: 'Something went wrong on our end.' }} />);
    expect(screen.getByText('Something went wrong on our end.')).toBeInTheDocument();
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
