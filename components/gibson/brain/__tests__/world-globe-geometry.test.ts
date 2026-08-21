import { describe, it, expect } from 'vitest';
import {
  hashToLatLon,
  worldToGlobe,
  project,
  rgbaFrom,
  globeHostId,
} from '@/components/gibson/brain/world-globe-geometry';
import type {
  WorldGraphHost,
  WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';

const host = (
  scopeId: string,
  address: string,
  over: Partial<WorldGraphHost> = {},
): WorldGraphHost => ({
  scopeId,
  address,
  openPorts: [22, 443],
  juicy: 0.7,
  attention: 0.3,
  surprise: '',
  ...over,
});

const finding = (
  id: string,
  scopeId: string,
  address: string,
  severity = 'high',
): WorldGraphFinding => ({ id, title: `finding ${id}`, scopeId, address, severity });

describe('hashToLatLon', () => {
  it('is deterministic for the same id', () => {
    expect(hashToLatLon('host:s1/10.0.0.1')).toEqual(
      hashToLatLon('host:s1/10.0.0.1'),
    );
  });

  it('separates different ids', () => {
    expect(hashToLatLon('host:s1/10.0.0.1')).not.toEqual(
      hashToLatLon('host:s1/10.0.0.2'),
    );
  });

  it('stays within the drawable band', () => {
    for (const id of ['a', 'host:s/1', 'x'.repeat(40), '10.0.0.255']) {
      const { lat, lon } = hashToLatLon(id);
      expect(lat).toBeGreaterThanOrEqual(-72);
      expect(lat).toBeLessThanOrEqual(72);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });
});

describe('worldToGlobe', () => {
  it('emits one point per host, keyed and placed by host id', () => {
    const pts = worldToGlobe([host('s1', '10.0.0.1')], []);
    expect(pts).toHaveLength(1);
    expect(pts[0].id).toBe(globeHostId('s1', '10.0.0.1'));
    expect(pts[0]).toMatchObject(hashToLatLon(globeHostId('s1', '10.0.0.1')));
  });

  it('belief is the juicier of juicy/attention, clamped to [0,1]', () => {
    expect(worldToGlobe([host('s', 'a', { juicy: 0.2, attention: 0.9 })], [])[0].belief).toBe(0.9);
    expect(worldToGlobe([host('s', 'a', { juicy: 5, attention: 0 })], [])[0].belief).toBe(1);
  });

  it('marks a host with the highest severity affecting it', () => {
    const pts = worldToGlobe(
      [host('s1', '10.0.0.1')],
      [
        finding('f1', 's1', '10.0.0.1', 'low'),
        finding('f2', 's1', '10.0.0.1', 'critical'),
        finding('f3', 's1', '10.0.0.1', 'medium'),
      ],
    );
    expect(pts[0].severity).toBe('critical');
  });

  it('drops a finding whose host is absent in the frame (no dangling marker)', () => {
    const pts = worldToGlobe([], [finding('f1', 's1', '10.0.0.1')]);
    expect(pts).toHaveLength(0);
  });

  it('does not cross scopes: same address, different scope is a different host', () => {
    const pts = worldToGlobe([host('s2', '10.0.0.1')], [finding('f1', 's1', '10.0.0.1')]);
    expect(pts[0].severity).toBeUndefined();
  });

  it('normalizes an unknown severity string to info', () => {
    const pts = worldToGlobe([host('s', 'a')], [finding('f', 's', 'a', 'bogus')]);
    expect(pts[0].severity).toBe('info');
  });
});

describe('project', () => {
  it('puts lat/lon 0 at rotation 0 on the near face (z>0), centered', () => {
    const p = project(0, 0, 0, 100, 200, 150);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
    expect(p.z).toBeCloseTo(1);
  });

  it('sends the antipode to the far hemisphere (z<0)', () => {
    expect(project(0, 180, 0, 100, 0, 0).z).toBeLessThan(0);
  });
});

describe('rgbaFrom', () => {
  it('expands a hex literal to rgba at the given alpha', () => {
    expect(rgbaFrom('#9ee640', 0.5)).toBe('rgba(158, 230, 64, 0.5)');
  });

  it('re-alphas an existing rgb/rgba literal', () => {
    expect(rgbaFrom('rgba(139, 92, 246, 0.45)', 0.1)).toBe('rgba(139, 92, 246, 0.1)');
    expect(rgbaFrom('rgb(1, 2, 3)', 0.2)).toBe('rgba(1, 2, 3, 0.2)');
  });
});
