"use client";

/**
 * MemberPicker, searchable combobox that enumerates the active tenant's
 * members and emits a userId + displayName on selection.
 *
 * Used in the Model Access grant form to replace the raw UUID text input
 * when subject_kind is USER.
 *
 * Data is fetched once on mount via listMembersAction. Renders a loading
 * state while the action is in-flight, and "No members found" when the
 * list is empty (including the graceful Unimplemented fallback).
 *
 * Spec: dashboard#340 Module D.
 */

import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  listMembersAction,
  type MemberRow,
} from "@/app/actions/read/listMembers";

export interface MemberPickerProps {
  /** Currently selected user ID (controlled). */
  value: string;
  /** Emitted when the user selects a member. */
  onChange: (userId: string, displayName: string) => void;
  /** Optional placeholder shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
}

export function MemberPicker({
  value,
  onChange,
  placeholder = "Select a member…",
  disabled = false,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMembersAction().then((res) => {
      if (cancelled) return;
      if (res.ok) setMembers(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Find display label for the currently selected value
  const selected = members.find((m) => m.userId === value);
  const triggerLabel = selected
    ? `${selected.displayName || selected.email} (${selected.email})`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="w-full justify-between font-normal"
          disabled={disabled || loading}
        >
          <span className="truncate text-left">
            {loading ? "Loading members…" : triggerLabel}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name or email…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => {
                const label = m.displayName
                  ? `${m.displayName} (${m.email})`
                  : m.email;
                return (
                  <CommandItem
                    key={m.userId}
                    value={`${m.displayName} ${m.email}`}
                    onSelect={() => {
                      onChange(m.userId, m.displayName || m.email);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        value === m.userId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
