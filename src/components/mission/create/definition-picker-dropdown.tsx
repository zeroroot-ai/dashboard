"use client";

/**
 * DefinitionPickerDropdown, Shadcn Combobox (Popover + Command) that lets the
 * user pick an installed mission definition, or select "New Mission" (null) to
 * create one from scratch.
 *
 * M6, mission-author-experience. Closes #322.
 */

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useListMissionDefinitions } from "@/src/hooks/useListMissionDefinitions";

export interface DefinitionPickerDropdownProps {
  /** Currently selected definition name, or null for "New Mission". */
  value: string | null;
  onChange: (name: string | null) => void;
  disabled?: boolean;
}

/** Sentinel value used as the cmdk item value for the "New Mission" entry. */
const NEW_MISSION_SENTINEL = "__new_mission__";

export function DefinitionPickerDropdown({
  value,
  onChange,
  disabled = false,
}: DefinitionPickerDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const { definitions, isLoading, error } = useListMissionDefinitions();

  const selectedLabel = value ?? "New Mission";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select mission definition"
          disabled={disabled}
          className="w-full justify-between"
        >
          <span className="truncate">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2
                  aria-label="Loading definitions"
                  className="size-4 animate-spin"
                />
                Loading…
              </span>
            ) : (
              selectedLabel
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search definitions…" />
          <CommandList>
            <CommandEmpty>No definitions found.</CommandEmpty>

            <CommandGroup>
              {/* "New Mission" is always the first item */}
              <CommandItem
                value={NEW_MISSION_SENTINEL}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  aria-hidden
                  className={
                    value === null
                      ? "mr-2 size-4 opacity-100"
                      : "mr-2 size-4 opacity-0"
                  }
                />
                <span>New Mission</span>
              </CommandItem>

              {/* Error state */}
              {error && (
                <CommandItem disabled value="__error__">
                  Could not load definitions
                </CommandItem>
              )}

              {/* Definition items */}
              {!error &&
                definitions.map((def) => (
                  <CommandItem
                    key={def.name}
                    value={def.name}
                    onSelect={(selected) => {
                      onChange(selected);
                      setOpen(false);
                    }}
                  >
                    <Check
                      aria-hidden
                      className={
                        value === def.name
                          ? "mr-2 size-4 opacity-100"
                          : "mr-2 size-4 opacity-0"
                      }
                    />
                    <div className="flex flex-col">
                      <span>{def.name}</span>
                      <span className="text-xs text-muted-foreground">
                        v{def.version} · {def.nodeCount}{" "}
                        {def.nodeCount === 1 ? "node" : "nodes"}
                      </span>
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
