"use client";

import { useMemo } from "react";
import {
  BellIcon,
  ClockIcon,
  ShieldAlertIcon,
  SwordsIcon,
  Loader2Icon
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMissions } from "@/src/hooks/useMissions";
import { useFindings } from "@/src/hooks/useFindings";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import type { Mission, Finding, FindingSeverity } from "@/src/types";

interface NotificationItem {
  id: string;
  kind: "mission" | "finding";
  title: string;
  description: string;
  timestamp: Date;
  severity?: FindingSeverity;
  status?: string;
}

const severityColor: Record<FindingSeverity, string> = {
  critical: "text-destructive",
  high: "text-alt",
  medium: "text-alt",
  low: "text-link",
  info: "text-muted-foreground"
};

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

const Notifications = () => {
  const isMobile = useIsMobile();

  const { data: missions, isLoading: missionsLoading } = useMissions({
    timeRange: "hour"
  });

  const { data: findingsResponse, isLoading: findingsLoading } = useFindings(
    {},
    { limit: 50 }
  );

  const isLoading = missionsLoading || findingsLoading;

  const items = useMemo(() => {
    const now = new Date();
    const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const result: NotificationItem[] = [];

    if (missions) {
      for (const m of missions) {
        const startedAt = m.startedAt ? new Date(m.startedAt) : null;
        if (startedAt && startedAt >= sixtyMinAgo) {
          result.push({
            id: `mission-${m.id}`,
            kind: "mission",
            title: m.name,
            description: `Mission ${m.status} - ${m.findings} finding${m.findings !== 1 ? "s" : ""} so far`,
            timestamp: startedAt,
            status: m.status
          });
        }
      }
    }

    const findings = findingsResponse?.data ?? [];
    for (const f of findings) {
      const discoveredAt = f.discoveredAt ? new Date(f.discoveredAt) : null;
      if (discoveredAt && discoveredAt >= sixtyMinAgo) {
        result.push({
          id: `finding-${f.id}`,
          kind: "finding",
          title: f.title,
          description: f.description,
          timestamp: discoveredAt,
          severity: f.severity
        });
      }
    }

    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return result;
  }, [missions, findingsResponse]);

  const hasItems = items.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="relative">
          <BellIcon />
          {hasItems && (
            <span className="bg-destructive absolute end-0.5 top-0.5 block size-1.5 shrink-0 rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={isMobile ? "center" : "end"}
        className="ms-4 w-80 p-0">
        <DropdownMenuLabel className="bg-background dark:bg-muted sticky top-0 z-10 p-0">
          <div className="flex justify-between border-b px-6 py-4">
            <div className="font-medium">Notifications</div>
            {hasItems && (
              <Badge variant="secondary" className="text-xs">
                {items.length}
              </Badge>
            )}
          </div>
        </DropdownMenuLabel>

        <ScrollArea className="h-[350px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : !hasItems ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-sm">
              <BellIcon className="size-6 opacity-40" />
              No activity in the last 60 minutes
            </div>
          ) : (
            items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="group flex cursor-pointer items-start gap-3 rounded-none border-b px-4 py-3">
                <div className="mt-0.5 flex-none">
                  {item.kind === "mission" ? (
                    <SwordsIcon className="text-primary size-4" />
                  ) : (
                    <ShieldAlertIcon
                      className={`size-4 ${item.severity ? severityColor[item.severity] : "text-muted-foreground"}`}
                    />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="truncate text-sm font-medium">
                    {item.title}
                  </div>
                  <div className="text-muted-foreground line-clamp-2 text-xs">
                    {item.description}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <ClockIcon className="size-3!" />
                    {timeAgo(item.timestamp)}
                  </div>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Notifications;
