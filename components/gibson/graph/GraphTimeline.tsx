'use client';

/**
 * GraphTimeline
 *
 * Scrubber that replays the graph over a run by Timeline sequence: play / pause
 * / drag to fold the World to a given tick (gibson#1105). `value`/`max` are the
 * scrub position and total event count; this component is presentational and
 * the page drives the fold via GetFrameAt.
 */

import { Play, Pause, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface GraphTimelineProps {
  min: number;
  max: number;
  value: number;
  playing: boolean;
  onChange: (value: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  className?: string;
}

function formatSeq(value: number, max: number): string {
  const seq = Math.round(value);
  return seq >= max ? `${max} · live` : `${seq} / ${max}`;
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
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
        aria-label="Timeline position"
      />

      <span className="text-xs font-mono text-muted-foreground tabular-nums w-28 text-right flex-shrink-0">
        {formatSeq(value, max)}
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

