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
import { SavedMissionsMenu } from "@/src/components/mission/create/saved-missions-menu";
import { DefinitionPickerDropdown } from "@/src/components/mission/create/definition-picker-dropdown";
import { getMissionSourceAction } from "@/app/actions/missions/source-store";
import { getTemplateCUESourceAction } from "@/app/actions/missions/create-mission";
import { NEW_MISSION_CUE, buildNewMissionCue } from "@/src/data/new-mission-template";
import { useDefaultProvider } from "@/src/hooks/useProviders";

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
  loadedFrom: "saved" | "template" | undefined;
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
            {loadedFrom === "saved"
              ? "Loaded saved version"
              : "New mission, not yet saved"}
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
  const urlMissionId = searchParams.get("mission") ?? undefined;
  const urlTemplateId = searchParams.get("template") ?? undefined;
  const urlDefinitionName = searchParams.get("definition") ?? undefined;
  const urlCloneMissionId = searchParams.get("clone") ?? undefined;

  const terminalRef = React.useRef<MissionTerminalHandle>(null);

  // The editor state machine owns source, dirty tracking, autosave, save,
  // and run. The page is a thin view that routes URL hydration into
  // editor.loadSource and renders editor state. dashboard#493 (D2).
  const editor = useMissionEditor();

  const [terminalOpen, setTerminalOpen] = React.useState(false);
  const [hydrating, setHydrating] = React.useState(false);

  // Definition-related chrome (banner + picker), removed in D5/D4.
  const [currentDefinitionName, setCurrentDefinitionName] = React.useState<string | undefined>(undefined);
  const [currentDefinitionMeta, setCurrentDefinitionMeta] = React.useState<DefinitionMeta | undefined>(undefined);
  const [definitionLoadedFrom, setDefinitionLoadedFrom] = React.useState<"saved" | "template" | undefined>(undefined);
  const [hydratedDefinitionName, setHydratedDefinitionName] = React.useState<string | undefined>(undefined);

  // Keep the most recent loadSource so effects can hydrate without depending
  // on the editor identity (which is stable across renders anyway).
  const loadSource = editor.loadSource;

  // Prepopulate a fresh New Mission's agent node with the tenant's default
  // provider/model as editable metadata (dashboard#521). Only for the fresh
  // case (no url-driven saved/template/clone/definition hydration), and only
  // once, so we never clobber the author's edits.
  const { data: defaultProvider } = useDefaultProvider();
  const seededDefaultRef = React.useRef(false);
  React.useEffect(() => {
    if (seededDefaultRef.current) return;
    if (urlMissionId || urlTemplateId || urlCloneMissionId || urlDefinitionName) return;
    if (!defaultProvider?.name) return;
    seededDefaultRef.current = true;
    loadSource({
      name: "new-mission",
      cueSource: buildNewMissionCue({
        provider: defaultProvider.name,
        model: defaultProvider.defaultModel,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProvider, urlMissionId, urlTemplateId, urlCloneMissionId, urlDefinitionName]);

  // URL-driven saved-mission hydration (?mission=<id>)
  React.useEffect(() => {
    if (!urlMissionId) return;
    if (urlMissionId === editor.missionId) return;
    let cancelled = false;
    setHydrating(true);
    void (async () => {
      const res = await getMissionSourceAction(urlMissionId);
      if (cancelled) return;
      if (res.ok) {
        loadSource({
          id: res.data.id,
          name: res.data.name,
          cueSource: res.data.cueSource,
        });
      } else if (res.code === "not_found") {
        toast.error("This mission no longer exists.");
        router.replace("/dashboard/missions/create");
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not load the mission"
        );
      }
      setHydrating(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlMissionId]);

  // URL-driven template hydration (?template=<id>)
  React.useEffect(() => {
    if (!urlTemplateId || urlMissionId) return;
    void (async () => {
      const src = await getTemplateCUESourceAction(urlTemplateId);
      if (src) loadSource({ cueSource: src });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTemplateId]);

  // URL-driven clone hydration (?clone=<missionId>)
  React.useEffect(() => {
    if (!urlCloneMissionId || urlMissionId) return;
    let cancelled = false;
    setHydrating(true);
    void (async () => {
      const res = await fetch(
        `/api/missions/${encodeURIComponent(urlCloneMissionId)}/clone`,
      );
      if (cancelled) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast.error(
          res.status === 410
            ? "This mission cannot be cloned, it was not created from a CUE definition."
            : body.error ?? "Could not load the mission for cloning",
        );
        router.replace("/dashboard/missions/create");
        setHydrating(false);
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
      setHydrating(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCloneMissionId]);

  // URL-driven definition hydration (?definition=<name>)
  React.useEffect(() => {
    if (!urlDefinitionName) return;
    if (hydratedDefinitionName === urlDefinitionName) return;

    let cancelled = false;
    setHydrating(true);

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
        setHydrating(false);
        return;
      }

      const defJson = (await defRes.json()) as {
        name?: string;
        version?: string;
        description?: string;
        nodeCount?: number;
        cueSource?: string;
      };
      if (cancelled) return;

      const meta: DefinitionMeta = {
        name: defJson.name ?? urlDefinitionName,
        version: defJson.version ?? "0.0.0",
        description: defJson.description ?? "",
        nodeCount: defJson.nodeCount ?? 0,
      };
      setCurrentDefinitionMeta(meta);

      // Load the definition's real CUE source (gibson#504). Definitions
      // registered before source persistence return an empty cue_source, fall
      // back to the valid New Mission template so Run stays enabled.
      if (defJson.cueSource) {
        loadSource({ name: meta.name, cueSource: defJson.cueSource });
        setDefinitionLoadedFrom("saved");
      } else {
        loadSource({ name: meta.name, cueSource: NEW_MISSION_CUE });
        setDefinitionLoadedFrom("template");
      }

      setCurrentDefinitionName(urlDefinitionName);
      setHydratedDefinitionName(urlDefinitionName);
      setHydrating(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDefinitionName]);

  // Wire SSE mission events to the terminal, zero re-renders per incoming line.
  useMissionTerminal(editor.activeMissionId, terminalRef);

  // Once autosave assigns an id, reflect it in the URL so a reload restores
  // the same mission.
  React.useEffect(() => {
    if (editor.missionId !== undefined && urlMissionId !== editor.missionId) {
      router.replace(`/dashboard/missions/create?mission=${editor.missionId}`);
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
    terminalRef.current?.write('\x1b[32m✓ Mission started, ID: ' + res.missionId + '\x1b[0m\r\n');
    terminalRef.current?.write('\x1b[2mUse the Missions list to view full details.\x1b[0m\r\n');
    toast.success("Mission launched");
  }

  async function handleSave() {
    const { ok } = await editor.save();
    if (ok) toast.success("Saved");
    else toast.error("Save failed");
  }

  function handleMissionDeleted(missionId: string) {
    if (missionId === editor.missionId) {
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
          Write a mission in CUE and launch, changes autosave as you type, and
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
          disabled={hydrating}
        />

        <SavedMissionsMenu
          currentMissionId={editor.missionId}
          onDeleted={handleMissionDeleted}
        />

        {hydrating && (
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
