'use client';

/**
 * GraphTimeline
 *
 * Scrubber that replays graph growth over a mission run: play / pause / drag to
 * reveal nodes discovered up to a point in time. Bounds + cutoff are computed by
 * the page from node timestamps; this component is presentational.
 */

import { Play, Pause, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface GraphTimelineProps {
  min: number;
  max: number;
  value: number;
  playing: boolean;
  onChange: (value: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  className?: string;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function GraphTimeline({
  min,
  max,
  value,
  playing,
  onChange,
  onTogglePlay,
  onClose,
  className,
}: GraphTimelineProps) {
  return (
    <div
      className={cn(
        'absolute z-20 bottom-32 left-1/2 -translate-x-1/2 w-[28rem] max-w-[80%]',
        'flex items-center gap-3 px-3 py-2 rounded-lg bg-background/90 backdrop-blur-md border border-border',
        className
      )}
      aria-label="Graph timeline scrubber"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        className="flex items-center justify-center w-8 h-8 rounded-md border border-border text-foreground hover:bg-accent flex-shrink-0"
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        aria-pressed={playing}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>

      <Slider
        min={min}
        max={max}
        step={Math.max(1, Math.round((max - min) / 200))}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
        aria-label="Timeline position"
      />

      <span className="text-xs font-mono text-muted-foreground tabular-nums w-36 text-right flex-shrink-0">
        {formatTime(value)}
      </span>

      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground flex-shrink-0"
        aria-label="Close timeline"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default GraphTimeline;
