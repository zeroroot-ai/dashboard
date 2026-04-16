"use client";

import { Label } from "@/components/ui/label";
import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ContentLayoutSelector() {
  const { theme, setTheme } = useThemeConfig();

  return (
    <div className="hidden flex-col gap-3 lg:flex">
      <Label>Content layout</Label>
      <ToggleGroup
        className="w-full"
        value={theme.contentLayout}
        type="single"
        onValueChange={(value) => setTheme({ ...theme, contentLayout: value as any })}>
        <ToggleGroupItem variant="outline" className="grow" value="full">
          Full
        </ToggleGroupItem>
        <ToggleGroupItem variant="outline" className="grow" value="centered">
          Centered
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
