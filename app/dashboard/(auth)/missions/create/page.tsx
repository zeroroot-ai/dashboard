"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ValidationPanel } from "@/components/gibson/missions/ValidationPanel";
import { editorTemplates } from "@/src/lib/mission/editor-templates";
import { validateMissionYAML, type ValidationResult } from "@/src/lib/mission/validation";
import { useAutosave } from "@/src/hooks/useAutosave";

const MissionYamlEditor = dynamic(
  () => import("@/components/gibson/missions/MissionYamlEditor"),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-muted-foreground">Loading editor...</div> }
);

const AUTOSAVE_KEY = "mission-create";

function loadDraft(): string {
  if (typeof window === "undefined") return editorTemplates[0].yamlContent;
  try {
    const stored = localStorage.getItem(`gibson:draft:${AUTOSAVE_KEY}`);
    if (stored) {
      const d = JSON.parse(stored);
      if (d?.yaml) return d.yaml;
    }
  } catch { /* ignore */ }
  return editorTemplates[0].yamlContent;
}

export default function CreateMissionPage() {
  const router = useRouter();
  const [yamlContent, setYamlContent] = React.useState<string>(loadDraft);
  const [validation, setValidation] = React.useState<ValidationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setValidation(validateMissionYAML(yamlContent)), 400);
    return () => clearTimeout(t);
  }, [yamlContent]);

  const autosave = useAutosave(
    { yaml: yamlContent, activeTab: "editor", savedAt: new Date().toISOString() },
    { storageKey: AUTOSAVE_KEY, debounceMs: 30000 }
  );

  React.useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (yamlContent !== editorTemplates[0].yamlContent) e.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [yamlContent]);

  async function handleValidate() {
    setIsValidating(true);
    try {
      const res = await fetch("/api/missions/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlContent }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data) {
        setValidation(data);
        data.isValid ? toast.success("Mission YAML is valid") : toast.error(`Validation failed: ${data.errors?.length ?? 0} error(s)`);
      } else {
        toast.error(data?.message ?? "Validation request failed");
      }
    } catch { toast.error("Failed to reach validation service"); }
    finally { setIsValidating(false); }
  }

  async function handleRunMission() {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/missions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlContent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Request failed: ${res.statusText}`);
      }
      autosave.clear();
      toast.success("Mission launched");
      router.push("/dashboard/missions");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally { setIsSubmitting(false); }
  }

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const isValid = validation?.isValid ?? false;
  const parsed = validation?.parsed ?? null;
  const autosaveLabel = autosave.status === "saved" ? "Draft saved" : autosave.status === "saving" ? "Saving..." : autosave.status === "error" ? "Save failed" : "Unsaved changes";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
          <Link href="/dashboard/missions">
            <ArrowLeft className="size-3.5" />
            Missions
          </Link>
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">New Mission</h1>
        <p className="text-sm text-muted-foreground">Write or load a mission YAML, validate, and launch.</p>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 mb-4">
        <Select onValueChange={(id) => { const tpl = editorTemplates.find((t) => t.id === id); if (tpl) setYamlContent(tpl.yamlContent); }} defaultValue={editorTemplates[0].id}>
          <SelectTrigger className="w-52 font-mono text-sm">
            <SelectValue placeholder="Load template..." />
          </SelectTrigger>
          <SelectContent>
            {editorTemplates.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id} className="font-mono text-sm">{tpl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground select-none">{autosaveLabel}</span>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleValidate} disabled={isValidating} className="gap-1.5">
            {isValidating ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Validate
          </Button>
          <Button size="sm" onClick={handleRunMission} disabled={isSubmitting || errors.length > 0} className="gap-1.5">
            {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
            Run Mission
          </Button>
        </div>
      </div>

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 14rem)" }}>
        <div className="flex-[7] min-w-0">
          <MissionYamlEditor value={yamlContent} onChange={setYamlContent} errors={errors} />
        </div>
        <div className="flex-[3] min-w-[280px]">
          <ValidationPanel errors={errors} warnings={warnings} parsed={parsed} isValid={isValid} />
        </div>
      </div>
    </div>
  );
}
