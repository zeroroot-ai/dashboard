'use client';

/**
 * GraphSettings
 *
 * Right-hand settings panel for the knowledge-graph explorer. Every control is
 * bound to the consolidated `graph-view-store` display settings (which persist),
 * and each one visibly affects the rendered graph. Replaces the previous empty
 * "Graph Settings" sheet (dashboard#666).
 */

import { Settings2, RotateCcw } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGraphViewStore, type LabelDensity } from '@/src/stores/graph-view-store';

export interface GraphSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </Label>
        <span className="text-sm font-medium text-foreground tabular-nums">{display}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm text-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function GraphSettings({ open, onOpenChange }: GraphSettingsProps) {
  const display = useGraphViewStore((s) => s.display);
  const setDisplay = useGraphViewStore((s) => s.setDisplay);
  const resetDisplay = useGraphViewStore((s) => s.resetDisplay);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 overflow-y-auto">
        <SheetHeader className="border-b border-border pb-3">
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Graph Settings
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 py-4">
          {/* Labels */}
          <SwitchRow
            label="Show labels"
            checked={display.showLabels}
            onCheckedChange={(v) => setDisplay({ showLabels: v })}
          />
          <div className="flex items-center justify-between">
            <Label className="text-sm text-foreground">Label density</Label>
            <Select
              value={display.labelDensity}
              onValueChange={(v) => setDisplay({ labelDensity: v as LabelDensity })}
            >
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sparse">Sparse</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="dense">Dense</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Sizing */}
          <SliderRow
            label="Node size"
            value={display.nodeSize}
            min={0.5}
            max={2}
            step={0.1}
            display={`${display.nodeSize.toFixed(1)}×`}
            onChange={(v) => setDisplay({ nodeSize: v })}
          />
          <SliderRow
            label="Link width"
            value={display.linkWidth}
            min={0.5}
            max={3}
            step={0.1}
            display={`${display.linkWidth.toFixed(1)}×`}
            onChange={(v) => setDisplay({ linkWidth: v })}
          />
          <SliderRow
            label="Glow"
            value={display.glow}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(display.glow * 100)}%`}
            onChange={(v) => setDisplay({ glow: v })}
          />

          <Separator />

          {/* Physics (force layout) */}
          <SliderRow
            label="Repulsion"
            value={display.charge}
            min={-400}
            max={-20}
            step={10}
            display={`${Math.abs(display.charge)}`}
            onChange={(v) => setDisplay({ charge: v })}
          />
          <SliderRow
            label="Link distance"
            value={display.linkDistance}
            min={20}
            max={200}
            step={5}
            display={`${display.linkDistance}`}
            onChange={(v) => setDisplay({ linkDistance: v })}
          />

          <Separator />

          {/* Performance */}
          <SwitchRow
            label="Particles"
            checked={display.particles}
            onCheckedChange={(v) => setDisplay({ particles: v })}
          />
          <SwitchRow
            label="Performance mode"
            checked={display.performanceMode}
            onCheckedChange={(v) => setDisplay({ performanceMode: v })}
          />
          <p className="text-xs text-muted-foreground -mt-3">
            Performance mode disables particles and glow for the smoothest frame rate on large graphs.
          </p>

          <Separator />

          {/* Visualizations */}
          <SwitchRow
            label="Severity heatmap"
            checked={display.severityHeatmap}
            onCheckedChange={(v) => setDisplay({ severityHeatmap: v })}
          />
          <p className="text-xs text-muted-foreground -mt-3">
            Color and enlarge finding nodes by severity so the riskiest parts stand out.
          </p>

          <Separator />

          <Button variant="outline" size="sm" onClick={resetDisplay} className="self-start">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default GraphSettings;
