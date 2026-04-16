"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";

import { Check, ChevronsDownIcon, UsersIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/src/lib/api/fetch";

interface Role {
  id: string;
  name: string;
  description: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  avatar: string;
  roleId: string;
}

export function TeamMembersCard() {
  const { data: rolesData, isLoading: rolesLoading } = useQuery<{ roles: Role[] }>({
    queryKey: ["roles"],
    queryFn: async () => {
      const res = await apiFetch("/api/roles");
      if (!res.ok) throw new Error("Failed to fetch roles");
      return res.json();
    },
    staleTime: 60_000,
  });

  const roles = rolesData?.roles ?? [];
  const members: Member[] = [];

  const [data, setData] = React.useState(members);
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  if (rolesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Invite your team members to collaborate.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Invite your team members to collaborate.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <UsersIcon className="text-muted-foreground mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">No team members yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
        <CardDescription>Invite your team members to collaborate.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {data.map((member, key) => (
          <div key={key} className="flex min-w-0 items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Avatar className="shrink-0">
                <AvatarImage src={member.avatar} />
                <AvatarFallback>OM</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm leading-none font-medium">{member.name}</p>
                <p className="text-muted-foreground truncate text-sm">{member.email}</p>
              </div>
            </div>
            <Popover
              open={openIndex === key}
              onOpenChange={(isOpen) => setOpenIndex(isOpen ? key : null)}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="shrink-0">
                  {roles.find((role) => role.id === member.roleId)?.name}{" "}
                  <ChevronsDownIcon className="text-muted-foreground ml-2 h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="end">
                <Command>
                  <CommandInput placeholder="Select new role..." />
                  <CommandList>
                    <CommandEmpty>No roles found.</CommandEmpty>
                    <CommandGroup>
                      {roles.map((role) => (
                        <CommandItem
                          key={role.id}
                          onSelect={() => {
                            setData((prevData) =>
                              prevData.map((m) =>
                                m.id === member.id ? { ...m, roleId: role.id } : m
                              )
                            );
                            setOpenIndex(null);
                          }}
                          className="teamaspace-y-1 flex items-start px-4 py-2">
                          <div>
                            <p>{role.name}</p>
                            <p className="text-muted-foreground text-sm">{role.description}</p>
                          </div>
                          {member.roleId === role.id ? (
                            <Check className="text-primary ml-auto flex size-4" />
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
