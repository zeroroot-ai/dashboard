"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useServerAutosave } from "@/src/hooks/useServerAutosave";
import { SaveDraftButton } from "@/src/components/mission/create/save-draft-button";
import { DraftsMenu } from "@/src/components/mission/create/drafts-menu";
import { DefinitionPickerDropdown } from "@/src/components/mission/create/definition-picker-dropdown";
import {
  getMissionDraftAction,
  listMissionDraftsAction,
} from "@/app/actions/missions/drafts";
import {
  createMissionFromCUEAction,
  getTemplateCUESourceAction,
} from "@/app/actions/missions/create-mission";

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

const MissionTerminal = dynamic(
  () =>
    import("@/src/components/missions/MissionTerminal").then(
      (m) => m.MissionTerminal
    ),
  { ssr: false }
);

const DEFAULT_CUE = `// Gibson Mission Definition (CUE)
// Edit below — inline diagnostics appear as you type.
package mission

name: "my-mission"
description: "Describe what this mission does."
`;

interface DefinitionMeta {
  name: string;
  version: string;
  description: string;
  nodeCount: number;
}

function scaffoldCUE(def: {
  name: string;
  description: string;
  version: string;
}): string {
  return `// Gibson Mission Definition (CUE)
package mission

name: "${def.name}"
description: "${def.description}"
version: "${def.version}"
`;
}

interface DefinitionBannerProps {
  meta: DefinitionMeta;
  loadedFrom: "draft" | "template" | undefined;
  onDismiss: () => void;
}

function DefinitionBanner({ meta, loadedFrom, onDismiss }: DefinitionBannerProps) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium font-mono">{meta.name}</span>
        <Badge variant="outline" className="font-mono text-xs">
          v{meta.version}
        </Badge>
        {loadedFrom !== undefined && (
          <span className="text-muted-foreground">
            {loadedFrom === "draft"
              ? "Loaded from draft"
              : "No draft found — showing template"}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label="Dismiss definition"
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

export default function CreateMissionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get("draft") ?? undefined;
  const urlTemplateId = searchParams.get("template") ?? undefined;
  const urlDefinitionName = searchParams.get("definition") ?? undefined;
  const urlCloneMissionId = searchParams.get("clone") ?? undefined;

  const terminalRef = React.useRef<MissionTerminalHandle>(null);

  const [cueSource, setCueSource] = React.useState<string>(DEFAULT_CUE);
  const [errorCount, setErrorCount] = React.useState(0);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [currentDraftId, setCurrentDraftId] = React.useState<string | undefined>(undefined);
  const [currentDraftName, setCurrentDraftName] = React.useState<string | undefined>(undefined);
  const [draftLoading, setDraftLoading] = React.useState(false);

  const [savedSource, setSavedSource] = React.useState<string>(DEFAULT_CUE);
  const isDirty = cueSource !== savedSource;

  // Definition-related state
  const [currentDefinitionName, setCurrentDefinitionName] = React.useState<string | undefined>(undefined);
  const [currentDefinitionMeta, setCurrentDefinitionMeta] = React.useState<DefinitionMeta | undefined>(undefined);
  const [definitionLoadedFrom, setDefinitionLoadedFrom] = React.useState<"draft" | "template" | undefined>(undefined);

  // Track the definition name that has already been hydrated to avoid re-runs
  const [hydratedDefinitionName, setHydratedDefinitionName] = React.useState<string | undefined>(undefined);

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
    return () => { cancelled = true; };
  }, [urlDraftId, currentDraftId, router]);

  // URL-driven template hydration (?template=<id>) — graceful no-op if .cue
  // file not yet vendored (lands in dashboard#293).
  React.useEffect(() => {
    if (!urlTemplateId || urlDraftId) return;
    void (async () => {
      const src = await getTemplateCUESourceAction(urlTemplateId);
      if (src) {
        setCueSource(src);
        setSavedSource(src);
      }
    })();
    // Only run once per template id change — don't re-run if user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTemplateId]);

  // URL-driven clone hydration (?clone=<missionId>) — fetches the CUE source
  // from the existing mission's registered definition and pre-populates the
  // editor. Closes dashboard#352.
  React.useEffect(() => {
    if (!urlCloneMissionId || urlDraftId) return;
    let cancelled = false;
    setDraftLoading(true);
    void (async () => {
      const res = await fetch(
        `/api/missions/${encodeURIComponent(urlCloneMissionId)}/clone`,
      );
      if (cancelled) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast.error(
          res.status === 410
            ? "This mission cannot be cloned — it was not created from a CUE definition."
            : body.error ?? "Could not load the mission for cloning",
        );
        router.replace("/dashboard/missions/create");
        setDraftLoading(false);
        return;
      }
      const data = (await res.json()) as { cueSource?: string; name?: string };
      if (cancelled) return;
      if (data.cueSource) {
        // Append " (copy)" to the name field in the CUE source so the new
        // submission does not conflict with the original definition name.
        const withCopyName = data.cueSource.replace(
          /^(\s*name:\s*)"([^"]*)"/m,
          (_m: string, prefix: string, name: string) => `${prefix}"${name} (copy)"`,
        );
        setCueSource(withCopyName);
        setSavedSource(withCopyName);
      }
      setDraftLoading(false);
    })();
    return () => { cancelled = true; };
    // Only run once per clone id — don't re-run if user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCloneMissionId]);

  // URL-driven definition hydration (?definition=<name>)
  React.useEffect(() => {
    if (!urlDefinitionName) return;
    if (hydratedDefinitionName === urlDefinitionName) return;

    let cancelled = false;
    setDraftLoading(true);

    void (async () => {
      // 1. Fetch definition metadata
      const defRes = await fetch(
        "/api/missions/definitions/" + encodeURIComponent(urlDefinitionName)
      );
      if (cancelled) return;

      if (!defRes.ok) {
        if (defRes.status === 404) {
          toast.error("Mission definition not found");
          router.replace("/dashboard/missions/create");
        } else {
          toast.error("Could not load the mission definition");
        }
        setDraftLoading(false);
        return;
      }

      const defJson = (await defRes.json()) as {
        name?: string;
        version?: string;
        description?: string;
        nodeCount?: number;
      };
      if (cancelled) return;

      const meta: DefinitionMeta = {
        name: defJson.name ?? urlDefinitionName,
        version: defJson.version ?? "0.0.0",
        description: defJson.description ?? "",
        nodeCount: defJson.nodeCount ?? 0,
      };
      setCurrentDefinitionMeta(meta);

      // 2. Scan for a matching draft
      const draftsRes = await listMissionDraftsAction();
      if (cancelled) return;

      const match =
        draftsRes.ok
          ? draftsRes.data.find((d) => d.name === urlDefinitionName)
          : undefined;

      if (match) {
        // 3a. Matching draft found — load it
        const draftRes = await getMissionDraftAction(match.id);
        if (cancelled) return;
        if (draftRes.ok) {
          setCueSource(draftRes.data.cueSource);
          setSavedSource(draftRes.data.cueSource);
          handleDraftSaved(match.id, match.name);
          setDefinitionLoadedFrom("draft");
        }
      } else {
        // 3b. No matching draft — scaffold a CUE template
        const scaffolded = scaffoldCUE(meta);
        setCueSource(scaffolded);
        setSavedSource(scaffolded);
        setDefinitionLoadedFrom("template");
      }

      setCurrentDefinitionName(urlDefinitionName);
      setHydratedDefinitionName(urlDefinitionName);
      setDraftLoading(false);
    })();

    return () => { cancelled = true; };
    // handleDraftSaved is defined below and stable (no deps that change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDefinitionName]);

  const serverAutosave = useServerAutosave(
    { cueSource, draftId: currentDraftId },
    { name: currentDraftName }
  );

  // When useServerAutosave creates a new draft (draftId goes from undefined to
  // a server-assigned id), register it in the page state and update the URL.
  React.useEffect(() => {
    if (
      serverAutosave.draftId !== undefined &&
      serverAutosave.draftId !== currentDraftId
    ) {
      handleDraftSaved(
        serverAutosave.draftId,
        currentDraftName ?? "Untitled Draft"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverAutosave.draftId]);

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
      const res = await createMissionFromCUEAction({ cueSource });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
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

  function handleDefinitionDismiss() {
    setCurrentDefinitionName(undefined);
    setCurrentDefinitionMeta(undefined);
    setDefinitionLoadedFrom(undefined);
    setHydratedDefinitionName(undefined);
    setCueSource(DEFAULT_CUE);
    router.replace("/dashboard/missions/create");
  }

  function handleDefinitionChange(name: string | null) {
    if (name === null) {
      router.push("/dashboard/missions/create");
    } else {
      router.push(
        "/dashboard/missions/create?definition=" + encodeURIComponent(name)
      );
    }
  }

  const pageTitle = currentDefinitionName
    ? `Edit: ${currentDefinitionName}`
    : currentDraftName
      ? `Draft: ${currentDraftName}`
      : "New Mission";

  const autosaveLabel =
    serverAutosave.status === "saved"
      ? "Saved"
      : serverAutosave.status === "saving"
        ? "Saving..."
        : serverAutosave.status === "error"
          ? "Save failed"
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
          {pageTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentDraftId
            ? "Editing a saved draft. Changes are not synced to the server until you click Update Draft."
            : "Write a mission in CUE and launch — inline diagnostics appear as you type."}
        </p>
        {currentDefinitionName !== undefined && currentDefinitionMeta !== undefined && (
          <DefinitionBanner
            meta={currentDefinitionMeta}
            loadedFrom={definitionLoadedFrom}
            onDismiss={handleDefinitionDismiss}
          />
        )}
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <DefinitionPickerDropdown
            value={urlDefinitionName ?? null}
            onChange={handleDefinitionChange}
            disabled={draftLoading}
          />

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

      <div style={{ height: "calc(100vh - 14rem)" }}>
        <MissionCUEEditor
          value={cueSource}
          onChange={setCueSource}
          onDiagnosticsChange={setErrorCount}
        />
      </div>

      <MissionTerminal ref={terminalRef} title="Mission Output" defaultOpen={false} />
    </div>
  );
}
