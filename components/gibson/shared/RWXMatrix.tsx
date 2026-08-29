"use client";

/**
 * Shared Read/Write/Execute matrix rendered by the extended Agents /
 * Tools / Plugins pages plus the new Security Policy page. Pure UI -
 * parent owns data fetching and state; this component emits onToggle
 * events with (item, action, newValue).
 *
 * Spec: agent-authoring-and-tenant-entitlements task 29, R8.
 */
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type RWXAction = "read" | "write" | "execute";

export interface RWXItem {
  name: string;
  displayName?: string;
  description?: string;
  rwx: { read: boolean; write: boolean; execute: boolean };
  denyingGates?: string[];
  /**
   * The deny tuples this page's scope writes, per action (true = denied).
   * A toggle-mode switch shows this, never `rwx`: `rwx` is the effective
   * capability, which also needs the catalog and a grant, and a switch that
   * showed it wrote denies nobody meant (dashboard#1135). Undefined means
   * the daemon could not say, and the switch is disabled rather than guessed.
   */
  killSwitch?: { read: boolean; write: boolean; execute: boolean };
  /** tenant_enabled for the caller's tenant. False means every action is off. */
  inTenantCatalog?: boolean;
}

export interface RWXMatrixProps {
  items: RWXItem[];
  onToggle: (item: RWXItem, action: RWXAction, enabled: boolean) => void | Promise<void>;
  /** Read-only mode disables all switches (for view-only scopes). */
  readOnly?: boolean;
  /**
   * Render a trailing cell per row (e.g. Configure button on plugin rows).
   * When provided, the matrix adds a right-hand column; when undefined no
   * column is rendered.
   */
  rowTrailingAction?: (item: RWXItem) => ReactNode;
  /**
   * Render a small annotation under the Execute cell per row (e.g. the
   * OAuth scope string that bounds what execute can do on a connector).
   * Rows where it returns null/undefined render no annotation.
   */
  executeAnnotation?: (item: RWXItem) => ReactNode;
  /**
   * `"toggle"` (default): Shadcn Switch, optimistic update expected.
   * `"approve"`: Shadcn Checkbox, the parent collects approvals in local
   * state and only issues writes on confirm (no optimistic update).
   */
  mode?: "toggle" | "approve";
  /**
   * When given, an item with `inTenantCatalog === false` renders an Enable
   * control that calls this (the tenant catalog enable, SetCatalogEnabled).
   */
  onEnable?: (item: RWXItem) => void | Promise<void>;
}

export function RWXMatrix({
  items,
  onToggle,
  readOnly,
  rowTrailingAction,
  executeAnnotation,
  mode = "toggle",
  onEnable,
}: RWXMatrixProps) {
  const showTrailing = Boolean(rowTrailingAction);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2 pr-4">Name</th>
          <th className="py-2 pr-4 w-20 text-center">Read</th>
          <th className="py-2 pr-4 w-20 text-center">Write</th>
          <th className="py-2 pr-4 w-20 text-center">Execute</th>
          {showTrailing && <th className="py-2 pr-4 w-28 text-right" aria-label="actions" />}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const execNote = executeAnnotation?.(it);
          return (
          <tr key={it.name} className="border-b hover:bg-muted/30">
            <td className="py-2 pr-4">
              <div className="font-medium">{it.displayName ?? it.name}</div>
              {it.description && (
                <div className="text-xs text-muted-foreground">{it.description}</div>
              )}
              {it.inTenantCatalog === false && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Not in tenant catalog</span>
                  {onEnable && !readOnly && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => onEnable(it)}
                      aria-label={`enable ${it.displayName ?? it.name} in tenant catalog`}
                    >
                      Enable
                    </Button>
                  )}
                </div>
              )}
            </td>
            {(["read", "write", "execute"] as RWXAction[]).map((a) => (
              <td key={a} className="py-2 pr-4 text-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="inline-flex">
                      {mode === "approve" ? (
                        <Checkbox
                          checked={it.rwx[a]}
                          disabled={readOnly}
                          onCheckedChange={(v) => onToggle(it, a, v === true)}
                          aria-label={`${a} for ${it.displayName ?? it.name}`}
                        />
                      ) : (
                        <Switch
                          checked={it.killSwitch ? !it.killSwitch[a] : false}
                          disabled={readOnly || !it.killSwitch}
                          onCheckedChange={(v) => onToggle(it, a, v)}
                          aria-label={`${a} for ${it.displayName ?? it.name}`}
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  {(!it.rwx[a] || (mode === "toggle" && !it.killSwitch)) && (
                    <TooltipContent>
                      <div className="max-w-xs text-xs">
                        {mode === "toggle" && !it.killSwitch ? (
                          <>Switch state unavailable; the daemon could not read the deny tuples.</>
                        ) : it.inTenantCatalog === false ? (
                          <>Not in tenant catalog: no tenant_enabled for this tenant. Enable it first.</>
                        ) : it.denyingGates && it.denyingGates.length > 0 ? (
                          <>
                            Denied by:
                            <ul className="list-disc list-inside mt-1">
                              {it.denyingGates.slice(0, 3).map((g) => (
                                <li key={g}>
                                  <code>{g}</code>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <>Denied; no gate information available</>
                        )}
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
                {a === "execute" && execNote != null && (
                  <div className="text-muted-foreground mt-1 text-[10px] leading-tight break-all">
                    {execNote}
                  </div>
                )}
              </td>
            ))}
            {showTrailing && (
              <td className="py-2 pr-4 text-right">{rowTrailingAction?.(it)}</td>
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
