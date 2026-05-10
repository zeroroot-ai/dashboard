/**
 * <RetryPolicyEditor /> — form for the canonical proto
 * RetryPolicy. Replaces the dashboard's pre-rewrite RetryConfig
 * subset, which only carried a fraction of the proto's fields.
 *
 * Surfaces every proto field:
 *   max_retries
 *   backoff_strategy   (UNSPECIFIED | CONSTANT | LINEAR | EXPONENTIAL)
 *   initial_delay      (Duration: seconds with sub-second precision)
 *   max_delay          (Duration)
 *   multiplier         (only meaningful when EXPONENTIAL)
 *
 * Spec: mission-dashboard-rewrite Requirement 3 + Task 8.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Duration } from "@bufbuild/protobuf/wkt";
import {
  BackoffStrategy,
  type RetryPolicy,
} from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface RetryPolicyEditorProps {
  value: RetryPolicy | undefined;
  onChange: (next: RetryPolicy | undefined) => void;
}

const empty: RetryPolicy = {
  $typeName: "gibson.mission.v1.RetryPolicy" as const,
  maxRetries: 0,
  backoffStrategy: BackoffStrategy.UNSPECIFIED,
  initialDelay: undefined,
  maxDelay: undefined,
  multiplier: 0,
};

const BACKOFF_OPTIONS: Array<{
  value: BackoffStrategy;
  label: string;
  description: string;
}> = [
  {
    value: BackoffStrategy.UNSPECIFIED,
    label: "(default)",
    description: "Daemon picks a sensible default (constant).",
  },
  {
    value: BackoffStrategy.CONSTANT,
    label: "Constant",
    description: "Same delay between every retry.",
  },
  {
    value: BackoffStrategy.LINEAR,
    label: "Linear",
    description: "Delay grows linearly with each attempt.",
  },
  {
    value: BackoffStrategy.EXPONENTIAL,
    label: "Exponential",
    description: "Delay grows by `multiplier^attempt`, capped at max_delay.",
  },
];

export function RetryPolicyEditor({ value, onChange }: RetryPolicyEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<RetryPolicy>) =>
    onChange({ ...config, ...patch });

  const isExp = config.backoffStrategy === BackoffStrategy.EXPONENTIAL;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="retry-max-retries">Max retries</Label>
          <Input
            id="retry-max-retries"
            type="number"
            min={0}
            value={config.maxRetries}
            onChange={(e) =>
              update({ maxRetries: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <Label htmlFor="retry-backoff">Backoff strategy</Label>
          <Select
            value={String(config.backoffStrategy)}
            onValueChange={(v) =>
              update({ backoffStrategy: Number(v) as BackoffStrategy })
            }
          >
            <SelectTrigger id="retry-backoff">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKOFF_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {opt.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DurationInput
          id="retry-initial-delay"
          label="Initial delay (seconds)"
          value={config.initialDelay}
          onChange={(d) => update({ initialDelay: d })}
        />
        <DurationInput
          id="retry-max-delay"
          label="Max delay (seconds, 0 = no cap)"
          value={config.maxDelay}
          onChange={(d) => update({ maxDelay: d })}
        />
      </div>

      {isExp ? (
        <div>
          <Label htmlFor="retry-multiplier">Multiplier</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Factor by which delay grows per attempt. Common values:
            1.5–2.0.
          </p>
          <Input
            id="retry-multiplier"
            type="number"
            min={0}
            step="0.1"
            value={config.multiplier}
            onChange={(e) =>
              update({ multiplier: Number(e.target.value) })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

interface DurationInputProps {
  id: string;
  label: string;
  value: Duration | undefined;
  onChange: (next: Duration | undefined) => void;
}

function DurationInput({ id, label, value, onChange }: DurationInputProps) {
  // Render Duration as a fractional-second number.
  const seconds = durationToSeconds(value);

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.1"
        value={seconds === undefined ? "" : seconds}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            onChange(undefined);
            return;
          }
          onChange(secondsToDuration(Number(v)));
        }}
        placeholder="(unset)"
      />
    </div>
  );
}

function durationToSeconds(d: Duration | undefined): number | undefined {
  if (!d) return undefined;
  const seconds = Number(d.seconds);
  const nanos = d.nanos / 1_000_000_000;
  return seconds + nanos;
}

function secondsToDuration(s: number): Duration {
  const whole = Math.floor(s);
  const fractional = s - whole;
  return {
    $typeName: "google.protobuf.Duration" as const,
    seconds: BigInt(whole),
    nanos: Math.round(fractional * 1_000_000_000),
  };
}
