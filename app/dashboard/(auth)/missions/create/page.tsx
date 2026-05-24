"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAutosave } from "@/src/hooks/useAutosave";
import { SaveDraftButton } from "@/src/components/mission/create/save-draft-button";
import { DraftsMenu } from "@/src/components/mission/create/drafts-menu";
import { getMissionDraftAction } from "@/app/actions/missions/drafts";

const MissionCUEEditor = dynamic(
  () =>
    import("@/src/components/missions/MissionCUEEditor").then(
      (m) => m.MissionCUEEditor
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading editor...
      </div>
    ),
  }
);

const AUTOSAVE_KEY = "mission-create";
const DEFAULT_CUE = `// Gibson Mission Definition (CUE)
// Edit below — inline diagnostics appear as you type.
package mission

name: "my-mission"
description: "Describe what this mission does."
`;

function loadLocalDraft(): string {
  if (typeof window === "undefined") return DEFAULT_CUE;
  try {
    const stored = localStorage.getItem(`gibson:draft:${AUTOSAVE_KEY}`);
    if (stored) {
      const d = JSON.parse(stored);
      // Accept both legacy `yaml` field and new `cueSource` field.
      if (d?.cueSource) return d.cueSource;
      if (d?.yaml) return d.yaml;
    }
  } catch { /* ignore */ }
  return DEFAULT_CUE;
}

export default function CreateMissionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get("draft") ?? undefined;

  const [cueSource, setCueSource] = React.useState<string>(loadLocalDraft);
  const [errorCount, setErrorCount] = React.useState(0);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Server-side draft state
  const [currentDraftId, setCurrentDraftId] = React.useState<string | undefined>(undefined);
  const [currentDraftName, setCurrentDraftName] = React.useState<string | undefined>(undefined);
  const [draftLoading, setDraftLoading] = React.useState(false);

  const [savedSource, setSavedSource] = React.useState<string>(DEFAULT_CUE);
  const isDirty = cueSource !== savedSource;

  // URL-driven draft hydration
  React.useEffect(() => {
    if (!urlDraftId) {
      setCurrentDraftId(undefined);
      setCurrentDraftName(undefined);
      return;
    }
    if (urlDraftId === currentDraftId) return;
    let cancelled = false;
    setDraftLoading(true);
    void (async () => {
      const res = await getMissionDraftAction(urlDraftId);
      if (cancelled) return;
      if (res.ok) {
        setCueSource(res.data.cueSource);
        setSavedSource(res.data.cueSource);
        setCurrentDraftId(res.data.id);
        setCurrentDraftName(res.data.name);
      } else if (res.code === "not_found") {
        toast.error("This draft no longer exists. It may have expired.");
        router.replace("/dashboard/missions/create");
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not load the draft"
        );
      }
      setDraftLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [urlDraftId, currentDraftId, router]);

  // Local-storage autosave — stored under the legacy `yaml` key for back-compat
  // with existing drafts in browser storage; value is CUE source.
  const autosave = useAutosave(
    { yaml: cueSource, activeTab: "editor", savedAt: new Date().toISOString() },
    { storageKey: AUTOSAVE_KEY, debounceMs: 30000 }
  );

  React.useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [isDirty]);

  async function handleRunMission() {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/missions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueSource }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error?.message ?? body?.message ?? `Request failed: ${res.statusText}`
        );
      }
      autosave.clear();
      toast.success("Mission launched");
      router.push("/dashboard/missions");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDraftSaved(draftId: string, name: string) {
    setCurrentDraftId(draftId);
    setCurrentDraftName(name);
    setSavedSource(cueSource);
    if (urlDraftId !== draftId) {
      router.replace(`/dashboard/missions/create?draft=${draftId}`);
    }
  }

  function handleDraftDeleted(draftId: string) {
    if (draftId === currentDraftId) {
      setCurrentDraftId(undefined);
      setCurrentDraftName(undefined);
      router.replace("/dashboard/missions/create");
    }
  }

  const autosaveLabel =
    autosave.status === "saved"
      ? "Local autosave"
      : autosave.status === "saving"
        ? "Saving..."
        : autosave.status === "error"
          ? "Local autosave failed"
          : "Unsaved changes";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1.5 text-muted-foreground"
        >
          <Link href="/dashboard/missions">
            <ArrowLeft className="size-3.5" />
            Missions
          </Link>
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
          {currentDraftName ? `Draft: ${currentDraftName}` : "New Mission"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentDraftId
            ? "Editing a saved draft. Changes are not synced to the server until you click Update Draft."
            : "Write a mission in CUE and launch — inline diagnostics appear as you type."}
        </p>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <DraftsMenu
            currentDraftId={currentDraftId}
            onDeleted={handleDraftDeleted}
          />

          {draftLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading draft...
            </span>
          )}
        </div>

        <span className="text-xs text-muted-foreground select-none">
          {autosaveLabel}
        </span>

        <div className="flex items-center gap-2">
          <SaveDraftButton
            cueSource={cueSource}
            currentDraftId={currentDraftId}
            currentDraftName={currentDraftName}
            isDirty={isDirty}
            onSaved={handleDraftSaved}
          />
          <Button
            size="sm"
            onClick={handleRunMission}
            disabled={isSubmitting || errorCount > 0}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            Run Mission
          </Button>
        </div>
      </div>

      <div style={{ minHeight: "calc(100vh - 14rem)" }}>
        <MissionCUEEditor
          value={cueSource}
          onChange={setCueSource}
          onDiagnosticsChange={setErrorCount}
        />
      </div>
    </div>
  );
}
