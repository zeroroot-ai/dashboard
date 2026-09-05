"use client";

/**
 * JobNodeDialog, the "Job" entry of the node palette (gibson#1706 lane E4).
 *
 * The mission builder is a CUE editor, so the node form emits one CUE node
 * into the definition instead of a box on a canvas. The form asks for what
 * `JobNodeConfig` carries: the bank, the goal, the repositories with their
 * connector, project, base branch and deliverable, the credential names,
 * the inputs (upstream node ids or World node ids), the acceptance
 * (verifier, passing score, max passes) and the constraints (turns, tokens)
 * plus the node timeout as the deadline. Validation mirrors the daemon's
 * OpenJob checks (src/lib/mission/job-node.ts), so an error shows before
 * submit.
 */

import * as React from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBanks } from "@/src/hooks/useBanks";
import { useActiveTenantRole } from "@/src/hooks/useBankPermissions";
import { useSession } from "@/src/lib/session-client";
import { deriveBankPermissions } from "@/src/lib/banks/permissions";
import { listConnectorsAction } from "@/app/actions/connectors";
import { listAccessibleComponentsAction } from "@/app/actions/read/listAccessibleComponents";
import { listSecretNamesAction } from "@/app/actions/read/listSecretNames";
import {
  BANK_REF_PLACEHOLDER,
  DELIVERABLE_KINDS,
  EMPTY_JOB_NODE,
  jobNodeSchema,
  type JobNodeFormValues,
} from "@/src/lib/mission/job-node";

const DELIVERABLE_LABEL: Record<(typeof DELIVERABLE_KINDS)[number], string> = {
  merge_request: "Open a merge request",
  push_branch: "Push the branch",
  none: "Leave the work in the sandbox",
};

/** Comma-separated text to a trimmed list. */
function splitList(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** The form keeps two list fields as text; the schema sees arrays. */
interface FormShape extends Omit<JobNodeFormValues, "credentialNames" | "inputs"> {
  credentialNamesText: string;
  inputsText: string;
}

function toValues(f: FormShape): JobNodeFormValues {
  const { credentialNamesText, inputsText, ...rest } = f;
  return { ...rest, credentialNames: splitList(credentialNamesText), inputs: splitList(inputsText) };
}

function fromValues(v: JobNodeFormValues): FormShape {
  const { credentialNames, inputs, ...rest } = v;
  return {
    ...rest,
    // The shipped template carries FIXME-bank (adk#257): unset, so the form prompts.
    bankRef: rest.bankRef === BANK_REF_PLACEHOLDER ? "" : rest.bankRef,
    credentialNamesText: credentialNames.join(", "),
    inputsText: inputs.join(", "),
  };
}

interface JobNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Feeds the form from a stored node (the round trip). */
  initial?: JobNodeFormValues;
  /** Receives the validated values; the caller inserts the CUE node. */
  onInsert: (values: JobNodeFormValues) => void;
}

interface Choices {
  connectors: string[];
  verifiers: string[];
  secrets: string[];
}

export function JobNodeDialog({ open, onOpenChange, initial, onInsert }: JobNodeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="job-node-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm">Job node</DialogTitle>
          <DialogDescription className="text-xs">
            A job on a bank of always-on Claude Code members. The node opens the job, runs the verify loop against the acceptance, and closes the job with a verdict. The mission graph stays a DAG.
          </DialogDescription>
        </DialogHeader>
        {open ? <JobNodeForm initial={initial} onInsert={onInsert} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function JobNodeForm({ initial, onInsert, onCancel }: { initial?: JobNodeFormValues; onInsert: (v: JobNodeFormValues) => void; onCancel: () => void }) {
  const { data: banks } = useBanks();
  const { data: session } = useSession();
  const tenantRole = useActiveTenantRole();
  const me = { userId: session?.user.id ?? null, tenantRole };
  const bankOptions = React.useMemo(
    () =>
      [...(banks ?? [])]
        .map((b) => ({ ...b, canSend: deriveBankPermissions(b.owner, me).canSend }))
        .sort((a, b) => Number(b.canSend) - Number(a.canSend) || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [banks, me.userId, me.tenantRole],
  );
  const [choices, setChoices] = React.useState<Choices>({ connectors: [], verifiers: [], secrets: [] });
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [connectors, components, secrets] = await Promise.all([
        listConnectorsAction(),
        listAccessibleComponentsAction({ kind: "all" }),
        listSecretNamesAction(),
      ]);
      if (cancelled) return;
      setChoices({
        connectors: connectors.ok ? connectors.data.enabled.map((c) => `connector/${c.id}`) : [],
        verifiers: components.ok
          ? components.data
              .filter((c) => (c.kind === "agent" || c.kind === "tool") && c.rwx.execute)
              .map((c) => `${c.kind}/${c.name}`)
          : [],
        secrets: secrets.ok ? secrets.data : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm<FormShape>({
    resolver: zodResolver(
      jobNodeSchema.transform((v) => v) as never,
      undefined,
      // The schema validates the array shape; the form holds text for the two lists.
      { mode: "async" },
    ),
    defaultValues: fromValues(initial ?? EMPTY_JOB_NODE),
    mode: "onSubmit",
  });
  const repos = useFieldArray({ control: form.control, name: "repositories" });

  async function submit(f: FormShape) {
    const values = toValues(f);
    const parsed = jobNodeSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") as never;
        form.setError(path, { message: issue.message });
      }
      return;
    }
    onInsert(parsed.data);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(form.getValues());
        }}
        className="space-y-3"
        data-testid="job-node-form"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="nodeId" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Node id</FormLabel>
              <FormControl><Input {...field} className="font-mono text-xs" autoComplete="off" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Name</FormLabel>
              <FormControl><Input {...field} className="text-xs" autoComplete="off" placeholder="Fix what the scanner found" /></FormControl>
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="bankRef" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Bank</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="text-xs" aria-label="Bank" data-testid="job-node-bank">
                  <SelectValue placeholder={bankOptions.length === 0 ? "No bank yet" : "Pick a bank"} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {bankOptions.map((b) => (
                  <SelectItem key={b.id} value={b.name} className="text-xs" data-testid={`bank-option-${b.name}`}>
                    {b.name}{b.canSend ? "" : " (needs can_send)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription className="text-xs">Banks you own come first. The daemon checks can_send when the node opens the job.</FormDescription>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="goal" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Goal</FormLabel>
            <FormControl><Textarea {...field} rows={3} className="text-xs" placeholder="What the job must achieve, in plain words." data-testid="job-node-goal" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Repositories</span>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => repos.append({ name: "", connectorRef: choices.connectors[0] ?? "", project: "", baseBranch: "", deliverable: "merge_request" })} data-testid="job-node-add-repo">
              <Plus className="size-3" /> Repository
            </Button>
          </div>
          {repos.fields.map((r, i) => (
            <div key={r.id} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2" data-testid="job-node-repo">
              <FormField control={form.control} name={`repositories.${i}.name`} render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Worktree name</FormLabel>
                  <FormControl><Input {...field} className="font-mono text-xs" placeholder="app" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name={`repositories.${i}.connectorRef`} render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Connector</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="text-xs" aria-label="Connector" data-testid="job-node-connector">
                        <SelectValue placeholder="Pick a connector" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {choices.connectors.map((c) => (
                        <SelectItem key={c} value={c} className="font-mono text-xs" data-testid={`connector-option-${c}`}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name={`repositories.${i}.project`} render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Project</FormLabel>
                  <FormControl><Input {...field} className="font-mono text-xs" placeholder="group/repo" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name={`repositories.${i}.baseBranch`} render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Base branch</FormLabel>
                  <FormControl><Input {...field} className="font-mono text-xs" placeholder="project default" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name={`repositories.${i}.deliverable`} render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Deliverable</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="text-xs" aria-label="Deliverable" data-testid="job-node-deliverable">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DELIVERABLE_KINDS.map((k) => (
                        <SelectItem key={k} value={k} className="text-xs">{DELIVERABLE_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <div className="flex items-end justify-end">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => repos.remove(i)} aria-label="Remove repository">
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="credentialNamesText" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Credential names</FormLabel>
              <FormControl><Input {...field} list="job-node-secret-names" className="font-mono text-xs" placeholder="npm-token, pypi-token" autoComplete="off" data-testid="job-node-credentials" /></FormControl>
              <datalist id="job-node-secret-names">
                {choices.secrets.map((s) => <option key={s} value={s} />)}
              </datalist>
              <FormDescription className="text-xs">Names only, comma separated. The per-turn grant covers these and no others.</FormDescription>
            </FormItem>
          )} />
          <FormField control={form.control} name="inputsText" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Inputs</FormLabel>
              <FormControl><Input {...field} className="font-mono text-xs" placeholder="scan, world-node-id" autoComplete="off" data-testid="job-node-inputs" /></FormControl>
              <FormDescription className="text-xs">Upstream node ids or World node ids, comma separated.</FormDescription>
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="verifierComponent" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Verifier</FormLabel>
              <Select value={field.value || "__none"} onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}>
                <FormControl>
                  <SelectTrigger className="text-xs" aria-label="Verifier" data-testid="job-node-verifier">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none" className="text-xs">None: a person closes the job</SelectItem>
                  {choices.verifiers.map((v) => (
                    <SelectItem key={v} value={v} className="font-mono text-xs" data-testid={`verifier-option-${v}`}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="passingScore" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Passing score</FormLabel>
              <FormControl><Input {...field} type="number" min={0} max={1} step={0.05} className="font-mono text-xs" data-testid="job-node-score" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="maxPasses" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Max passes</FormLabel>
              <FormControl><Input {...field} type="number" min={0} className="font-mono text-xs" data-testid="job-node-passes" /></FormControl>
              <FormDescription className="text-xs">Bounds the verify loop inside the job. RetryPolicy retries the whole node.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="maxTurns" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Max turns</FormLabel>
              <FormControl><Input {...field} type="number" min={0} className="font-mono text-xs" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="maxTokens" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Max tokens</FormLabel>
              <FormControl><Input {...field} type="number" min={0} className="font-mono text-xs" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="deadlineMinutes" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Deadline (minutes)</FormLabel>
              <FormControl><Input {...field} type="number" min={0} className="font-mono text-xs" /></FormControl>
              <FormDescription className="text-xs">The node timeout. Zero means none.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" className="text-xs" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" className="text-xs" data-testid="job-node-insert">Insert node</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
