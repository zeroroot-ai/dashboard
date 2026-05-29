"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Rocket, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useMissionEditor } from "@/src/hooks/useMissionEditor";
import { useMissionTerminal } from "@/src/hooks/useMissionTerminal";
import { DraftsMenu } from "@/src/components/mission/create/drafts-menu";
import { DefinitionPickerDropdown } from "@/src/components/mission/create/definition-picker-dropdown";
import {
  getMissionDraftAction,
  listMissionDraftsAction,
} from "@/app/actions/missions/drafts";
import { getTemplateCUESourceAction } from "@/app/actions/missions/create-mission";
import { NEW_MISSION_CUE } from "@/src/data/new-mission-template";

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

interface DefinitionMeta {
  name: string;
  version: string;
  description: string;
  nodeCount: number;
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

  // The editor state machine owns source, dirty tracking, autosave, save,
  // and run. The page is a thin view that routes URL hydration into
  // editor.loadSource and renders editor state. dashboard#493 (D2).
  const editor = useMissionEditor();

  const [terminalOpen, setTerminalOpen] = React.useState(false);
  const [draftLoading, setDraftLoading] = React.useState(false);

  // Definition-related chrome (banner + picker) — removed in D5/D4.
  const [currentDefinitionName, setCurrentDefinitionName] = React.useState<string | undefined>(undefined);
  const [currentDefinitionMeta, setCurrentDefinitionMeta] = React.useState<DefinitionMeta | undefined>(undefined);
  const [definitionLoadedFrom, setDefinitionLoadedFrom] = React.useState<"draft" | "template" | undefined>(undefined);
  const [hydratedDefinitionName, setHydratedDefinitionName] = React.useState<string | undefined>(undefined);

  // Keep the most recent loadSource so effects can hydrate without depending
  // on the editor identity (which is stable across renders anyway).
  const loadSource = editor.loadSource;

  // URL-driven draft hydration (?draft=<id>)
  React.useEffect(() => {
    if (!urlDraftId) return;
    if (urlDraftId === editor.missionId) return;
    let cancelled = false;
    setDraftLoading(true);
    void (async () => {
      const res = await getMissionDraftAction(urlDraftId);
      if (cancelled) return;
      if (res.ok) {
        loadSource({
          id: res.data.id,
          name: res.data.name,
          cueSource: res.data.cueSource,
        });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDraftId]);

  // URL-driven template hydration (?template=<id>)
  React.useEffect(() => {
    if (!urlTemplateId || urlDraftId) return;
    void (async () => {
      const src = await getTemplateCUESourceAction(urlTemplateId);
      if (src) loadSource({ cueSource: src });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTemplateId]);

  // URL-driven clone hydration (?clone=<missionId>)
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
        // Append " (copy)" to the name field so the clone does not collide
        // with the original definition name.
        const withCopyName = data.cueSource.replace(
          /^(\s*name:\s*)"([^"]*)"/m,
          (_m: string, prefix: string, name: string) => `${prefix}"${name} (copy)"`,
        );
        loadSource({ cueSource: withCopyName });
      }
      setDraftLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCloneMissionId]);

  // URL-driven definition hydration (?definition=<name>)
  React.useEffect(() => {
    if (!urlDefinitionName) return;
    if (hydratedDefinitionName === urlDefinitionName) return;

    let cancelled = false;
    setDraftLoading(true);

    void (async () => {
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

      const draftsRes = await listMissionDraftsAction();
      if (cancelled) return;

      const match =
        draftsRes.ok
          ? draftsRes.data.find((d) => d.name === urlDefinitionName)
          : undefined;

      if (match) {
        const draftRes = await getMissionDraftAction(match.id);
        if (cancelled) return;
        if (draftRes.ok) {
          loadSource({
            id: match.id,
            name: match.name,
            cueSource: draftRes.data.cueSource,
          });
          setDefinitionLoadedFrom("draft");
        }
      } else {
        // No matching draft — seed the valid New Mission template so Run is
        // enabled. Loading the definition's real CUE source is dashboard#495
        // (D4), gated on the daemon returning cue_source (gibson#504).
        loadSource({ cueSource: NEW_MISSION_CUE });
        setDefinitionLoadedFrom("template");
      }

      setCurrentDefinitionName(urlDefinitionName);
      setHydratedDefinitionName(urlDefinitionName);
      setDraftLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDefinitionName]);

  // Wire SSE mission events to the terminal — zero re-renders per incoming line.
  useMissionTerminal(editor.activeMissionId, terminalRef);

  // Once autosave assigns an id, reflect it in the URL so a reload restores
  // the same mission.
  React.useEffect(() => {
    if (editor.missionId !== undefined && urlDraftId !== editor.missionId) {
      router.replace(`/dashboard/missions/create?draft=${editor.missionId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.missionId]);

  // Warn on navigate-away with unsaved changes.
  React.useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (editor.isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [editor.isDirty]);

  async function handleRunMission() {
    terminalRef.current?.clear();
    setTerminalOpen(false);
    setTerminalOpen(true);
    terminalRef.current?.write('\x1b[36mLaunching mission…\x1b[0m\r\n');

    const res = await editor.run();
    if (!res.ok) {
      terminalRef.current?.write('\x1b[31m✗ ' + (res.error ?? "Failed") + '\x1b[0m\r\n');
      toast.error(res.error ?? "Failed to launch mission");
      return;
    }
    terminalRef.current?.write('\x1b[32m✓ Mission started — ID: ' + res.missionId + '\x1b[0m\r\n');
    terminalRef.current?.write('\x1b[2mUse the Missions list to view full details.\x1b[0m\r\n');
    toast.success("Mission launched");
  }

  async function handleSave() {
    const { ok } = await editor.save();
    if (ok) toast.success("Saved");
    else toast.error("Save failed");
  }

  function handleDraftDeleted(draftId: string) {
    if (draftId === editor.missionId) {
      editor.newMission();
      router.replace("/dashboard/missions/create");
    }
  }

  function handleDefinitionDismiss() {
    setCurrentDefinitionName(undefined);
    setCurrentDefinitionMeta(undefined);
    setDefinitionLoadedFrom(undefined);
    setHydratedDefinitionName(undefined);
    editor.newMission();
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
    : editor.missionName
      ? editor.missionName
      : "New Mission";

  const saveLabel =
    editor.saveStatus === "saved"
      ? "Saved"
      : editor.saveStatus === "saving"
        ? "Saving..."
        : editor.saveStatus === "error"
          ? "Save failed"
          : editor.isDirty
            ? "Unsaved changes"
            : "Saved";

  const isSaving = editor.saveStatus === "saving";

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
          Write a mission in CUE and launch — changes autosave as you type, and
          inline diagnostics appear live.
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

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <DefinitionPickerDropdown
          value={urlDefinitionName ?? null}
          onChange={handleDefinitionChange}
          disabled={draftLoading}
        />

        <DraftsMenu
          currentDraftId={editor.missionId}
          onDeleted={handleDraftDeleted}
        />

        {draftLoading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading...
          </span>
        )}

        <span className="ml-auto text-xs text-muted-foreground select-none">
          {saveLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={isSaving || !editor.isDirty}
          className="gap-1.5"
        >
          {isSaving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
        <Button
          size="sm"
          onClick={handleRunMission}
          disabled={editor.runDisabled}
          className="gap-1.5"
        >
          {editor.runState === "launching" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Rocket className="size-3.5" />
          )}
          Run Mission
        </Button>
      </div>

      <div style={{ height: "35vh" }}>
        <MissionCUEEditor
          value={editor.cueSource}
          onChange={editor.setSource}
          onDiagnosticsChange={editor.setErrorCount}
        />
      </div>

      <MissionTerminal
        ref={terminalRef}
        title="Mission Output"
        defaultOpen={true}
        imperativeOpen={terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />
    </div>
  );
}
