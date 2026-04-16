"use client";

import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarModeSelector() {
  const { toggleSidebar } = useSidebar();

  return (
    <div className="hidden flex-col gap-3 lg:flex">
      <Label>Sidebar mode:</Label>
      <ToggleGroup className="w-full" type="single" onValueChange={() => toggleSidebar()}>
        <ToggleGroupItem variant="outline" className="grow" value="full">
          Default
        </ToggleGroupItem>
        <ToggleGroupItem variant="outline" className="grow" value="centered">
          Icon
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
