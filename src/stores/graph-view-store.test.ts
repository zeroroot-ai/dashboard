/**
 * Graph View Store Tests
 *
 * The store is the single source of truth for the knowledge-graph explorer.
 * These tests assert the external behavior of its actions — in particular the
 * regression guard that switching layout never lands the controls in a wedged
 * state (the original "clicking a layout button disables all of them" bug).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphViewStore, DEFAULT_DISPLAY, type GraphLayoutMode } from './graph-view-store';

describe('Graph View Store', () => {
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

  it('starts with sane defaults', () => {
    const s = useGraphViewStore.getState();
    expect(s.layoutMode).toBe('force');
    expect(s.display).toEqual(DEFAULT_DISPLAY);
    expect(s.nodeCount).toBe(0);
    expect(s.edgeCount).toBe(0);
    expect(s.selectedNodeId).toBeNull();
  });

  describe('layout', () => {
    it('sets the layout mode', () => {
      useGraphViewStore.getState().setLayoutMode('radial');
      expect(useGraphViewStore.getState().layoutMode).toBe('radial');
    });

    it('can switch layouts repeatedly without wedging (regression: stuck controls)', () => {
      const modes: GraphLayoutMode[] = ['force', 'hierarchy', 'radial', 'timeline'];
      // Hammer every mode many times; the store must remain mutable throughout.
      for (let i = 0; i < 25; i++) {
        const mode = modes[i % modes.length];
        useGraphViewStore.getState().setLayoutMode(mode);
        expect(useGraphViewStore.getState().layoutMode).toBe(mode);
      }
      // There is no "animating/disabled" flag that could lock the controls.
      expect('layoutAnimating' in useGraphViewStore.getState()).toBe(false);
    });
  });

  describe('selection', () => {
    it('selects and clears a node', () => {
      useGraphViewStore.getState().selectNode('node-1');
      expect(useGraphViewStore.getState().selectedNodeId).toBe('node-1');
      useGraphViewStore.getState().selectNode(null);
      expect(useGraphViewStore.getState().selectedNodeId).toBeNull();
    });

    it('tracks the hovered node', () => {
      useGraphViewStore.getState().setHoveredNode('node-2');
      expect(useGraphViewStore.getState().hoveredNodeId).toBe('node-2');
    });
  });

  describe('display', () => {
    it('merges partial display settings', () => {
      useGraphViewStore.getState().setDisplay({ nodeSize: 2 });
      const d = useGraphViewStore.getState().display;
      expect(d.nodeSize).toBe(2);
      // unspecified keys are preserved
      expect(d.showLabels).toBe(DEFAULT_DISPLAY.showLabels);
    });

    it('toggles labels and particles', () => {
      const before = useGraphViewStore.getState().display;
      useGraphViewStore.getState().toggleLabels();
      expect(useGraphViewStore.getState().display.showLabels).toBe(!before.showLabels);
      useGraphViewStore.getState().toggleParticles();
      expect(useGraphViewStore.getState().display.particles).toBe(!before.particles);
    });

    it('resets display to defaults', () => {
      useGraphViewStore.getState().setDisplay({ nodeSize: 5, particles: false, showLabels: false });
      useGraphViewStore.getState().resetDisplay();
      expect(useGraphViewStore.getState().display).toEqual(DEFAULT_DISPLAY);
    });
  });

  describe('stats', () => {
    it('records live node/edge counts', () => {
      useGraphViewStore.getState().setStats(42, 99);
      const s = useGraphViewStore.getState();
      expect(s.nodeCount).toBe(42);
      expect(s.edgeCount).toBe(99);
    });
  });
});
