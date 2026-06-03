import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { GraphLegend } from './GraphLegend';

describe('GraphLegend', () => {
  it('lists the node and edge types it is given', () => {
    render(
      <GraphLegend
        nodeTypes={['host', 'finding', 'mission']}
        relationshipTypes={['AFFECTS', 'CONTAINS']}
      />
    );
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Finding')).toBeInTheDocument();
    expect(screen.getByText('Mission')).toBeInTheDocument();
    // relationship labels are title-cased from the lowercased type
    expect(screen.getByText('Affects')).toBeInTheDocument();
    expect(screen.getByText('Contains')).toBeInTheDocument();
    expect(screen.getByLabelText('Graph legend')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<GraphLegend nodeTypes={[]} relationshipTypes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the edges section when no relationship types are present', () => {
    render(<GraphLegend nodeTypes={['host']} relationshipTypes={[]} />);
    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.queryByText('Edges')).not.toBeInTheDocument();
  });
});
