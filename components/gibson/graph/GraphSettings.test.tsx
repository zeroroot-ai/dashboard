import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { GraphSettings } from './GraphSettings';
import { useGraphViewStore, DEFAULT_DISPLAY } from '@/src/stores/graph-view-store';

function renderOpen() {
  return render(<GraphSettings open onOpenChange={() => {}} />);
}

describe('GraphSettings', () => {
  beforeEach(() => {
    useGraphViewStore.setState({
      layoutMode: 'force',
      selectedNodeId: null,
      hoveredNodeId: null,
      display: { ...DEFAULT_DISPLAY },
      nodeCount: 0,
      edgeCount: 0,
    });
  });

  it('renders the real settings controls (not an empty panel)', () => {
    renderOpen();
    expect(screen.getByText('Graph Settings')).toBeInTheDocument();
    expect(screen.getByText('Node size')).toBeInTheDocument();
    expect(screen.getByText('Link width')).toBeInTheDocument();
    expect(screen.getByText('Repulsion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument();
  });

  it('toggling "Show labels" writes through to the store', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('switch', { name: 'Show labels' }));
    expect(useGraphViewStore.getState().display.showLabels).toBe(false);
  });

  it('toggling "Performance mode" writes through to the store', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('switch', { name: 'Performance mode' }));
    expect(useGraphViewStore.getState().display.performanceMode).toBe(true);
  });

  it('reset-to-defaults restores the default display settings', () => {
    useGraphViewStore.getState().setDisplay({
      nodeSize: 1.9,
      particles: false,
      glow: 0,
      performanceMode: true,
      labelDensity: 'dense',
    });
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    expect(useGraphViewStore.getState().display).toEqual(DEFAULT_DISPLAY);
  });
});
