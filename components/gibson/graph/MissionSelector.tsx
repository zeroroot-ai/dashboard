'use client';

/**
 * MissionSelector, Phase 5, Task 18
 *
 * Dropdown over the tenant's most recent 50 missions. Reads ?mission=<id>
 * from URL search params (managed by the parent page). On change, calls
 * onSelect which the page handles by pushing a new URL + triggering refetch.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMissions } from '@/src/hooks/useMissions';

interface MissionSelectorProps {
  /** Currently selected mission ID, or null for the full tenant graph. */
  selectedMissionId: string | null;
  /** Called when the user picks a mission or resets to full-graph view. */
  onSelect: (missionId: string | null) => void;
}

export function MissionSelector({ selectedMissionId, onSelect }: MissionSelectorProps) {
  const { data: missions, isLoading } = useMissions();

  // Limit to 50 most recent; sort by startedAt desc.
  const sortedMissions = [...(missions ?? [])]
    .sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 50);

  const handleValueChange = (value: string) => {
    onSelect(value === '__all__' ? null : value);
  };

  return (
    <Select
      value={selectedMissionId ?? '__all__'}
      onValueChange={handleValueChange}
      disabled={isLoading}
    >
      <SelectTrigger className="w-52 h-8 text-xs bg-background/80 backdrop-blur-sm border-border">
        <SelectValue placeholder={isLoading ? 'Loading missions…' : 'Full graph'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">Full graph (all missions)</SelectItem>
        {sortedMissions.map((mission) => (
          <SelectItem key={mission.id} value={mission.id}>
            {mission.name || mission.id}
          </SelectItem>
        ))}
        {sortedMissions.length === 0 && !isLoading && (
          <SelectItem value="__empty__" disabled>
            No missions found
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
