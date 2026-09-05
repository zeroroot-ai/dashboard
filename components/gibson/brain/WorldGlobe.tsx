'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getThemeColors } from '@/src/lib/graph/theme-colors';
import { getSeverityColor } from '@/src/lib/graph/entity-taxonomy';
import { CANVAS_TEXT, CANVAS_TEXT_HALO } from '@/src/lib/graph/canvas-style';
import {
  worldToGlobe,
  project,
  rgbaFrom,
  type GlobePoint,
} from '@/components/gibson/brain/world-globe-geometry';
import type {
  WorldGraphMission,
  WorldGraphHost,
  WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';

interface WorldGlobeProps {
  missions: WorldGraphMission[];
  hosts: WorldGraphHost[];
  findings: WorldGraphFinding[];
  /** Node ids highlighted at the selected tick (the diff delta). */
  highlightNodeIds?: string[];
}

/**
 * WorldGlobe renders the ECS brain's World (epic ecs-brain, gibson#752) as a
 * slowly rotating globe: each discovered host is a point placed by a stable
 * hash of its id (the World has no geography), glowing by belief and marked by
 * the highest-severity finding that affects it. It is an alternative to the
 * force-directed WorldGraph over the SAME folded frame the Scroller is showing,
 * so scrubbing re-materializes the globe at that point in time — scrub back and
 * a host (and its finding marker) un-happens, because it only ever existed as a
 * folded event.
 *
 * All canvas colors come from the shared graph theme (`src/lib/graph`), so the
 * globe stays inside the no-hardcoded-colors guard and matches the graph. The
 * loop respects prefers-reduced-motion (no rotation) and pauses entirely while
 * the canvas is off-screen.
 */
export function WorldGlobe({
  missions,
  hosts,
  findings,
  highlightNodeIds,
}: WorldGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => worldToGlobe(hosts, findings), [hosts, findings]);
  const highlight = useMemo(
    () => new Set(highlightNodeIds ?? []),
    [highlightNodeIds],
  );

  // Keep the latest render inputs in a ref so the animation loop reads current
  // data without being torn down and rebuilt on every frame/prop change.
  const stateRef = useRef({ points, highlight });
  stateRef.current = { points, highlight };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const theme = getThemeColors();
    const reduce =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let cx = 0;
    let cy = 0;
    let radius = 0;
    let rotation = 0;
    let raf = 0;
    let visible = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(300, rect.height);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = width / 2;
      cy = height / 2;
      radius = Math.min(width, height) * 0.36;
    };

    const drawGraticule = () => {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = project(lat, lon, rotation, radius, cx, cy);
          if (p.z < 0) {
            started = false;
            continue;
          }
          if (started) {
            ctx.lineTo(p.x, p.y);
          } else {
            ctx.moveTo(p.x, p.y);
            started = true;
          }
        }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = project(lat, lon, rotation, radius, cx, cy);
          if (p.z < 0) {
            started = false;
            continue;
          }
          if (started) {
            ctx.lineTo(p.x, p.y);
          } else {
            ctx.moveTo(p.x, p.y);
            started = true;
          }
        }
        ctx.stroke();
      }
    };

    const drawSphere = () => {
      const grd = ctx.createRadialGradient(
        cx - radius * 0.3,
        cy - radius * 0.35,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      grd.addColorStop(0, rgbaFrom(theme.glowColors.primary, 0.1));
      grd.addColorStop(1, theme.background);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = rgbaFrom(theme.glowColors.primary, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const colorFor = (pt: GlobePoint): string =>
      pt.severity ? getSeverityColor(pt.severity) : theme.nodeColors.host;

    const drawPoints = (t: number) => {
      const { points: pts, highlight: hi } = stateRef.current;
      const placed = pts
        .map((pt) => ({ pt, p: project(pt.lat, pt.lon, rotation, radius, cx, cy) }))
        .sort((a, b) => a.p.z - b.p.z);

      for (const { pt, p } of placed) {
        const front = p.z > 0;
        const fade = front ? 1 : 0.15;
        const color = colorFor(pt);

        if (front && pt.belief > 0.2) {
          const gr = 6 + pt.belief * 30;
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
          glow.addColorStop(0, rgbaFrom(theme.glowColors.primary, 0.12 + pt.belief * 0.4));
          glow.addColorStop(1, rgbaFrom(theme.glowColors.primary, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
          ctx.fill();
        }

        const rad = pt.severity ? 4.4 : 3.4;

        if (front && pt.severity && !reduce) {
          const pulse = (Math.sin(t / 380 + p.x) + 1) / 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad + 3 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = rgbaFrom(color, 0.25 + pulse * 0.4);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        if (front && hi.has(pt.id)) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad + 6, 0, Math.PI * 2);
          ctx.strokeStyle = rgbaFrom(theme.glowColors.active, 0.9);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = rgbaFrom(color, fade);
        ctx.fill();

        if (front) {
          ctx.font = "500 10.5px 'JetBrains Mono', ui-monospace, monospace";
          ctx.textAlign = p.x > cx ? 'left' : 'right';
          const lx = p.x + (p.x > cx ? rad + 6 : -(rad + 6));
          ctx.lineWidth = 3;
          ctx.strokeStyle = CANVAS_TEXT_HALO;
          ctx.strokeText(pt.label, lx, p.y + 3.5);
          ctx.fillStyle = CANVAS_TEXT;
          ctx.fillText(pt.label, lx, p.y + 3.5);
        }
      }
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      drawSphere();
      drawGraticule();
      drawPoints(t);
      if (!reduce) rotation += 0.0016;
      if (visible) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (raf) return;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(() => {
      resize();
      // A resize while paused (reduced motion, off-screen) still needs one draw.
      if (!raf) requestAnimationFrame(frame);
    });
    ro.observe(canvas.parentElement ?? canvas);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.01 },
    );
    io.observe(canvas);

    resize();
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
    };
    // The loop reads live data through stateRef, so it is built once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (points.length === 0 && missions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing in the World yet.</p>
    );
  }

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-md border border-border bg-card">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        aria-label="A globe of the tenant World: each discovered host is a point, glowing by belief and marked by the severity of any finding that affects it, reconstructed as of the current tick."
      />
    </div>
  );
}
