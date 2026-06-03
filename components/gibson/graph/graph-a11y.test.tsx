/**
 * Accessibility sweep for the graph-explorer controls.
 *
 * Asserts that every interactive control is a real button/input with an
 * accessible name and is reachable (not hidden/disabled), so keyboard and
 * screen-reader users can operate the graph.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { GraphControls } from './GraphControls';
import { GraphTimeline } from './GraphTimeline';
import { GraphSearch } from './GraphSearch';
import { useGraphViewStore, DEFAULT_DISPLAY } from '@/src/stores/graph-view-store';

const noop = () => {};

beforeEach(() => {
  useGraphViewStore.setState({
    layoutMode: 'force',
    selectedNodeId: null,
    hoveredNodeId: null,
    display: { ...DEFAULT_DISPLAY },
    showLegend: false,
    showMinimap: false,
    nodeCount: 10,
    edgeCount: 5,
  });
});

describe('GraphControls accessibility', () => {
  function renderAll() {
    return render(
      <GraphControls
        onZoomIn={noop}
        onZoomOut={noop}
        onFit={noop}
        onReset={noop}
        onOpenSettings={noop}
        onExportPng={noop}
        onExportJson={noop}
        onToggleTimeline={noop}
      />
    );
  }

  it('every control is a button with an accessible name, and none are disabled', () => {
    renderAll();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(8);
    for (const btn of buttons) {
      expect(btn).toHaveAccessibleName();
      expect(btn).toBeEnabled();
    }
  });

  it('exposes the key actions by accessible name', () => {
    renderAll();
    for (const name of [
      'Zoom in',
      'Zoom out',
      'Fit to view',
      'Reset view',
      'Force-directed layout',
      'Timeline layout',
      'Show legend',
      'Show minimap',
      'Export PNG',
      'Export JSON',
      'Settings',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('GraphTimeline accessibility', () => {
  it('play, slider, and close are labeled', () => {
    render(
      <GraphTimeline
        min={0}
        max={100}
        value={50}
        playing={false}
        onChange={noop}
        onTogglePlay={noop}
        onClose={noop}
      />
    );
    expect(screen.getByRole('button', { name: 'Play timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close timeline' })).toBeInTheDocument();
    // The Radix slider thumb is keyboard-operable; assert it is reachable.
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });
});

describe('GraphSearch accessibility', () => {
  it('the search input has an accessible name', () => {
    render(<GraphSearch nodes={[]} onFocusNode={noop} />);
    expect(screen.getByRole('textbox', { name: 'Search nodes' })).toBeInTheDocument();
  });
});
