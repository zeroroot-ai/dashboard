"use client";

/**
 * FallbackChainEditor
 *
 * Drag-to-reorder editor for the tenant's provider fallback chain.
 * Providers in the ranked section are tried in order when the primary
 * provider fails. Providers dragged below the separator are removed from
 * the chain.
 *
 * Only rendered when two or more providers are configured.
 */

import * as React from "react";
import { GripVertical, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { providerQueryKeys } from "@/src/hooks/useProviders";
import type { ProviderConfig } from "@/src/types/provider";

// ---------------------------------------------------------------------------
// Query key for the fallback-chain endpoint
// ---------------------------------------------------------------------------

const FALLBACK_CHAIN_QUERY_KEY = [...providerQueryKeys.fallback()] as const;

// ---------------------------------------------------------------------------
// API helpers — talk to the NEW /api/settings/providers/fallback-chain route
// ---------------------------------------------------------------------------

async function fetchFallbackChain(): Promise<string[]> {
  const res = await fetch("/api/settings/providers/fallback-chain");
  if (!res.ok) {
    throw new Error(`Failed to load fallback chain: ${res.status}`);
  }
  const data = (await res.json()) as { chain: string[] };
  return data.chain;
}

async function saveFallbackChain(chain: string[]): Promise<void> {
  const res = await fetch("/api/settings/providers/fallback-chain", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      data.error?.message ?? `Failed to save fallback chain: ${res.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SortableChainItem — individual draggable row
// ---------------------------------------------------------------------------

interface SortableChainItemProps {
  id: string;
  rank?: number; // defined only for ranked items
}

function SortableChainItem({ id, rank }: SortableChainItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`Drag ${id} to reorder`}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Rank badge (only for items that are in the chain) */}
      {rank !== undefined && (
        <Badge variant="outline" className="text-xs tabular-nums">
          #{rank}
        </Badge>
      )}

      <span className="flex-1 font-mono text-xs">{id}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FallbackChainEditor
// ---------------------------------------------------------------------------

interface FallbackChainEditorProps {
  /** All configured providers, passed from ProvidersContent. */
  providers: ProviderConfig[];
}

export function FallbackChainEditor({ providers }: FallbackChainEditorProps) {
  // Only show when there are at least 2 providers.
  if (providers.length < 2) {
    return null;
  }

  return <FallbackChainEditorInner providers={providers} />;
}

// Separate inner component so hooks always run after the length guard.
function FallbackChainEditorInner({ providers }: FallbackChainEditorProps) {
  const queryClient = useQueryClient();

  // -------------------------------------------------------------------------
  // Remote chain state
  // -------------------------------------------------------------------------

  const { data: remoteChain, isLoading } = useQuery({
    queryKey: FALLBACK_CHAIN_QUERY_KEY,
    queryFn: fetchFallbackChain,
    staleTime: 30_000,
  });

  // -------------------------------------------------------------------------
  // Local state — split into ranked + unranked
  // -------------------------------------------------------------------------

  const allNames = providers.map((p) => p.name);

  /**
   * Keep orderedChain in local state so drag operations are immediate.
   * Initialise from the remote chain once it loads; reset when the remote
   * value changes (e.g. after a successful save + invalidation).
   */
  const [orderedChain, setOrderedChain] = React.useState<string[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);

  // Sync local state whenever the remote value arrives or changes.
  React.useEffect(() => {
    if (remoteChain !== undefined) {
      // Keep only names that still exist as configured providers.
      setOrderedChain(remoteChain.filter((n) => allNames.includes(n)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteChain]);

  // Providers not yet in the ranked chain.
  const unranked = allNames.filter((n) => !orderedChain.includes(n));

  // -------------------------------------------------------------------------
  // Drag-end handler
  // -------------------------------------------------------------------------

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeInChain = orderedChain.includes(activeId);
    const overInChain = orderedChain.includes(overId);
    const activeInUnranked = unranked.includes(activeId);
    const overInUnranked = unranked.includes(overId);

    if (activeInChain && overInChain) {
      // Reorder within the ranked section.
      const oldIndex = orderedChain.indexOf(activeId);
      const newIndex = orderedChain.indexOf(overId);
      setOrderedChain(arrayMove(orderedChain, oldIndex, newIndex));
      return;
    }

    if (activeInUnranked && overInUnranked) {
      // Reorder within the unranked section (no-op for rank, just UX).
      return;
    }

    if (activeInUnranked && overInChain) {
      // Move from unranked into the chain at the position of the target.
      const newChain = [...orderedChain];
      const insertAt = orderedChain.indexOf(overId);
      newChain.splice(insertAt, 0, activeId);
      setOrderedChain(newChain);
      return;
    }

    if (activeInChain && overInUnranked) {
      // Move from chain to unranked section.
      setOrderedChain(orderedChain.filter((n) => n !== activeId));
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  async function handleSave() {
    setIsSaving(true);
    try {
      await saveFallbackChain(orderedChain);
      await queryClient.invalidateQueries({
        queryKey: FALLBACK_CHAIN_QUERY_KEY,
      });
      toast.success("Fallback chain saved");
    } catch (err) {
      toast.error("Failed to save fallback chain", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm">Fallback chain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="size-3 animate-spin" />
            Loading&hellip;
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Fallback chain</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
          {/* Ranked section */}
          {orderedChain.length > 0 ? (
            <SortableContext
              items={orderedChain}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {orderedChain.map((name, i) => (
                  <SortableChainItem key={name} id={name} rank={i + 1} />
                ))}
              </div>
            </SortableContext>
          ) : (
            <p className="text-muted-foreground text-xs py-1">
              No providers in the fallback chain. Drag providers from below to
              add them.
            </p>
          )}

          {/* Separator + unranked */}
          {unranked.length > 0 && (
            <>
              <div className="text-muted-foreground text-xs py-2 border-t border-border/40 pt-3 mt-3">
                Not in fallback chain
              </div>
              <SortableContext
                items={unranked}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {unranked.map((name) => (
                    <SortableChainItem key={name} id={name} />
                  ))}
                </div>
              </SortableContext>
            </>
          )}
        </DndContext>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4 text-xs"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving && <Loader2 className="size-3 animate-spin" />}
          Save order
        </Button>
      </CardContent>
    </Card>
  );
}
