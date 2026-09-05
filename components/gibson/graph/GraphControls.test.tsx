import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { GraphControls } from './GraphControls';
import { useGraphViewStore, DEFAULT_DISPLAY } from '@/src/stores/graph-view-store';

function noop() {}

function renderControls() {
  return render(
    <GraphControls onZoomIn={noop} onZoomOut={noop} onFit={noop} onReset={noop} />
  );
}

describe('GraphControls', () => {
  beforeEach(() => {
    useGraphViewStore.setState({
      layoutMode: 'force',
      selectedNodeId: null,
      hoveredNodeId: null,
      display: DEFAULT_DISPLAY,
      nodeCount: 0,
      edgeCount: 0,
    });
  });

  it('renders all four layout buttons', () => {
    renderControls();
    for (const label of ['Force-directed layout', 'Hierarchy layout', 'Radial layout', 'Timeline layout']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('clicking a layout button updates the store layout mode', () => {
    renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Radial layout' }));
    expect(useGraphViewStore.getState().layoutMode).toBe('radial');
  });

  it('layout buttons never become disabled after selection (no wedge)', () => {
    renderControls();
    const labels = ['Force-directed layout', 'Hierarchy layout', 'Radial layout', 'Timeline layout'];
    // Click each layout repeatedly; buttons must stay enabled the whole time.
    for (let i = 0; i < 12; i++) {
      const label = labels[i % labels.length];
      const btn = screen.getByRole('button', { name: label });
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(btn).not.toBeDisabled();
    }
    // Final click landed on the expected mode.
    expect(useGraphViewStore.getState().layoutMode).toBe('timeline');
  });

  it('marks the active layout with aria-pressed', () => {
    useGraphViewStore.setState({ layoutMode: 'hierarchy' });
    renderControls();
    expect(screen.getByRole('button', { name: 'Hierarchy layout' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Radial layout' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('toggles labels and particles via the store', () => {
    renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Hide labels' }));
    expect(useGraphViewStore.getState().display.showLabels).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Disable particles' }));
    expect(useGraphViewStore.getState().display.particles).toBe(false);
  });
});
