import type { Severity } from '@/src/lib/graph/entity-taxonomy';
import type {
  WorldGraphHost,
  WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';

/**
 * Pure geometry + projection for the World globe (gibson#752, port of the
 * marketing World section). The globe is an alternative rendering of the same
 * folded frame the WorldGraph draws: hosts are points on a sphere, glowing by
 * belief, marked by the highest-severity finding that affects them. It carries
 * NO geography — a host has no lat/lon in the World, so a point's position is a
 * deterministic hash of its id (stable across renders and scrubs), not a map
 * location.
 *
 * Everything here is pure so the placement, severity aggregation, and
 * finding→host matching are unit-testable without a canvas. Colors are resolved
 * in the component from the shared graph theme, never here.
 */

export interface GlobePoint {
  /** The host node id, matching WorldGraph's `host:<scope>/<address>`. */
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Belief in [0,1] — drives glow radius and intensity. */
  belief: number;
  /** Highest severity among findings affecting this host, if any. */
  severity?: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const globeHostId = (scopeId: string, address: string): string =>
  `host:${scopeId}/${address}`;

/**
 * Deterministic id → {lat, lon}. Two independent FNV-1a streams (the second
 * salted) spread points over the sphere without clustering. Latitude is capped
 * to ±72° so nothing sits under the poles where labels collide.
 */
export function hashToLatLon(id: string): { lat: number; lon: number } {
  const fnv = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0xffffffff;
  };
  const lat = (fnv(0x811c9dc5) * 2 - 1) * 72;
  const lon = (fnv(0x1b873593) * 2 - 1) * 180;
  return { lat, lon };
}

/**
 * Project a lat/lon (degrees) onto a rotating sphere. `z > 0` is the near
 * hemisphere (facing the viewer); callers fade or cull the far side by `z`.
 */
export function project(
  latDeg: number,
  lonDeg: number,
  rotation: number,
  radius: number,
  cx: number,
  cy: number,
): { x: number; y: number; z: number } {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180 + rotation;
  return {
    x: cx + Math.cos(lat) * Math.sin(lon) * radius,
    y: cy - Math.sin(lat) * radius,
    z: Math.cos(lat) * Math.cos(lon),
  };
}

/**
 * Project a World frame into globe points. One point per host, placed by the
 * hash of its id, glowing by belief (the juicier of juicy/attention), and
 * carrying the highest severity among the findings that affect it. A finding is
 * matched to a host only when that host is present in the same frame (same rule
 * as WorldGraph's AFFECTS edge), so a frame folded before the host was observed
 * raises no marker.
 */
export function worldToGlobe(
  hosts: WorldGraphHost[],
  findings: WorldGraphFinding[],
): GlobePoint[] {
  const byId = new Map<string, GlobePoint>();
  for (const h of hosts) {
    const id = globeHostId(h.scopeId, h.address);
    const { lat, lon } = hashToLatLon(id);
    byId.set(id, {
      id,
      label: h.address,
      lat,
      lon,
      belief: Math.max(0, Math.min(1, Math.max(h.juicy, h.attention))),
    });
  }
  for (const f of findings) {
    const point = byId.get(globeHostId(f.scopeId, f.address));
    if (!point) continue;
    const sev = normalizeSeverity(f.severity);
    if (!point.severity || SEVERITY_RANK[sev] > SEVERITY_RANK[point.severity]) {
      point.severity = sev;
    }
  }
  return [...byId.values()];
}

function normalizeSeverity(raw: string): Severity {
  const s = raw.toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') {
    return s;
  }
  return 'info';
}

/**
 * Compose an rgba() string at `alpha` from a theme color that is a hex
 * (`#rrggbb`), `rgb(...)`, or `rgba(...)` literal (the forms the graph theme
 * emits). Lets the canvas vary a token color's opacity for glows without
 * hardcoding any color of its own.
 */
export function rgbaFrom(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((v) => parseFloat(v));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
