"use client";

/**
 * AuditLogFilter — composable filter bar for the audit log page.
 *
 * Renders dropdowns for event type (with new secret/plugin/authz event types
 * per Spec 4 R5), authz sub-filter, tenant, date range, and actor. All
 * filters compose with AND semantics.  The parent page passes `value` and
 * `onChange` to keep this component fully controlled.
 *
 * SECURITY: no credential values are referenced here.  The audit pipeline
 * never stores credential values in audit rows; the types enforce this.
 */

import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { AuditAction, AuditLogQuery } from "@/src/lib/audit-log";

// ---------------------------------------------------------------------------
// Event type catalogue
// ---------------------------------------------------------------------------

interface EventTypeOption {
  value: AuditAction | "__all__";
  label: string;
  group: string;
}

const EVENT_TYPE_OPTIONS: EventTypeOption[] = [
  { value: "__all__", label: "All event types", group: "General" },
  // Tenant events
  { value: "tenant.created",                 label: "tenant.created",                   group: "Tenant" },
  { value: "tenant.updated",                 label: "tenant.updated",                   group: "Tenant" },
  { value: "tenant.deleted",                 label: "tenant.deleted",                   group: "Tenant" },
  { value: "tenant.switch",                  label: "tenant.switch",                    group: "Tenant" },
  { value: "tenant.secrets_namespace_created", label: "tenant.secrets_namespace_created", group: "Tenant" },
  // Member events
  { value: "member.added",                   label: "member.added",                     group: "Member" },
  { value: "member.removed",                 label: "member.removed",                   group: "Member" },
  { value: "member.role_changed",            label: "member.role_changed",              group: "Member" },
  // Settings
  { value: "settings.updated",               label: "settings.updated",                 group: "Settings" },
  // Secret lifecycle events (Spec 4 R5)
  { value: "secret.create",                  label: "secret.create",                    group: "Secrets" },
  { value: "secret.read",                    label: "secret.read",                      group: "Secrets" },
  { value: "secret.update",                  label: "secret.update",                    group: "Secrets" },
  { value: "secret.delete",                  label: "secret.delete",                    group: "Secrets" },
  { value: "secret.bind",                    label: "secret.bind",                      group: "Secrets" },
  { value: "secret.revoke_access",           label: "secret.revoke_access",             group: "Secrets" },
  { value: "secret.config_set",              label: "secret.config_set",                group: "Secrets" },
  // Plugin lifecycle events (Spec 4 R5)
  { value: "plugin.register",                label: "plugin.register",                  group: "Plugins" },
  { value: "plugin.invoke",                  label: "plugin.invoke",                    group: "Plugins" },
  { value: "plugin.heartbeat",               label: "plugin.heartbeat",                 group: "Plugins" },
  { value: "plugin.unreachable",             label: "plugin.unreachable",               group: "Plugins" },
  // Authorization events (Spec 4 R5)
  { value: "authz.deny",                     label: "authz.deny",                       group: "Authorization" },
];

const GROUPS = Array.from(new Set(EVENT_TYPE_OPTIONS.map((o) => o.group)));

// ---------------------------------------------------------------------------
// Filter state shape
// ---------------------------------------------------------------------------

/**
 * The complete set of filter values controlled by this component.
 * Maps directly to `AuditLogQuery` fields so the parent can pass it through.
 */
export interface AuditLogFilterValue {
  /** `__all__` means no event-type filter applied. */
  eventType: AuditAction | "__all__";
  /**
   * Sub-filter for `authz.deny` events.
   * Set to `"fga_no_can_resolve"` or empty string.
   */
  decisionReason: string;
  tenantId: string;
  actorId: string;
  startDate: string; // ISO date string "YYYY-MM-DD" or ""
  endDate: string;
  secretId: string;
  requestId: string;
}

export function emptyAuditLogFilter(): AuditLogFilterValue {
  return {
    eventType: "__all__",
    decisionReason: "",
    tenantId: "",
    actorId: "",
    startDate: "",
    endDate: "",
    secretId: "",
    requestId: "",
  };
}

/**
 * Convert `AuditLogFilterValue` to the `AuditLogQuery` partial suitable for
 * passing to `queryAuditLog`.
 */
export function filterValueToQuery(
  filter: AuditLogFilterValue,
): Partial<AuditLogQuery> {
  const q: Partial<AuditLogQuery> = {};
  if (filter.eventType !== "__all__") {
    q.action = filter.eventType;
  }
  if (filter.decisionReason) {
    q.decisionReason = filter.decisionReason;
  }
  if (filter.tenantId) q.tenantId = filter.tenantId;
  if (filter.actorId) q.actorId = filter.actorId;
  if (filter.startDate) q.startDate = new Date(filter.startDate);
  if (filter.endDate) q.endDate = new Date(filter.endDate);
  if (filter.secretId) q.secretId = filter.secretId;
  if (filter.requestId) q.requestId = filter.requestId;
  return q;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AuditLogFilterProps {
  value: AuditLogFilterValue;
  onChange: (value: AuditLogFilterValue) => void;
  /** Optional list of tenant IDs to populate the tenant dropdown. */
  tenantOptions?: { id: string; name: string }[];
  className?: string;
}

export function AuditLogFilter({
  value,
  onChange,
  tenantOptions = [],
  className,
}: AuditLogFilterProps) {
  const set = <K extends keyof AuditLogFilterValue>(
    key: K,
    val: AuditLogFilterValue[K],
  ) => onChange({ ...value, [key]: val });

  const showAuthzSubfilter = value.eventType === "authz.deny";

  return (
    <div
      className={`flex flex-wrap items-end gap-3 ${className ?? ""}`}
      aria-label="Audit log filters"
    >
      {/* Event type */}
      <div className="flex flex-col gap-1.5 min-w-[220px]">
        <Label htmlFor="audit-event-type" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Event type
        </Label>
        <Select
          value={value.eventType}
          onValueChange={(v) => {
            set("eventType", v as AuditAction | "__all__");
            // Reset authz sub-filter when switching away from authz.deny
            if (v !== "authz.deny") set("decisionReason", "");
          }}
        >
          <SelectTrigger
            id="audit-event-type"
            size="sm"
            className="font-mono text-xs border-highlight/40 bg-transparent"
            aria-label="Filter by event type"
          >
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((group) => (
              <SelectGroup key={group}>
                <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                {EVENT_TYPE_OPTIONS.filter((o) => o.group === group).map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="font-mono text-xs"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* authz.deny sub-filter — only visible when authz.deny is selected */}
      {showAuthzSubfilter && (
        <div className="flex flex-col gap-1.5 min-w-[200px]">
          <Label htmlFor="audit-decision-reason" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Decision reason
          </Label>
          <Select
            value={value.decisionReason || "__all__"}
            onValueChange={(v) => set("decisionReason", v === "__all__" ? "" : v)}
          >
            <SelectTrigger
              id="audit-decision-reason"
              size="sm"
              className="font-mono text-xs border-highlight/40 bg-transparent"
              aria-label="Filter by authz decision reason"
            >
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="font-mono text-xs">All reasons</SelectItem>
              <SelectItem value="fga_no_can_resolve" className="font-mono text-xs">
                fga_no_can_resolve
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tenant filter */}
      {tenantOptions.length > 0 && (
        <div className="flex flex-col gap-1.5 min-w-[180px]">
          <Label htmlFor="audit-tenant" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Tenant
          </Label>
          <Select
            value={value.tenantId || "__all__"}
            onValueChange={(v) => set("tenantId", v === "__all__" ? "" : v)}
          >
            <SelectTrigger
              id="audit-tenant"
              size="sm"
              className="font-mono text-xs border-highlight/40 bg-transparent"
              aria-label="Filter by tenant"
            >
              <SelectValue placeholder="All tenants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="font-mono text-xs">All tenants</SelectItem>
              {tenantOptions.map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-mono text-xs">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Actor (free text) */}
      <div className="flex flex-col gap-1.5 min-w-[160px]">
        <Label htmlFor="audit-actor" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Actor ID
        </Label>
        <Input
          id="audit-actor"
          size={1}
          value={value.actorId}
          onChange={(e) => set("actorId", e.target.value)}
          placeholder="user-id or email"
          className="font-mono text-xs h-8 border-highlight/40 bg-transparent"
          aria-label="Filter by actor"
          autoComplete="off"
        />
      </div>

      {/* Secret ID (free text) — for drill-down filter */}
      <div className="flex flex-col gap-1.5 min-w-[160px]">
        <Label htmlFor="audit-secret-id" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Secret ID
        </Label>
        <Input
          id="audit-secret-id"
          size={1}
          value={value.secretId}
          onChange={(e) => set("secretId", e.target.value)}
          placeholder="secret name or id"
          className="font-mono text-xs h-8 border-highlight/40 bg-transparent"
          aria-label="Filter by secret ID"
          autoComplete="off"
        />
      </div>

      {/* Request ID */}
      <div className="flex flex-col gap-1.5 min-w-[160px]">
        <Label htmlFor="audit-request-id" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Request ID
        </Label>
        <Input
          id="audit-request-id"
          size={1}
          value={value.requestId}
          onChange={(e) => set("requestId", e.target.value)}
          placeholder="trace / request id"
          className="font-mono text-xs h-8 border-highlight/40 bg-transparent"
          aria-label="Filter by request ID"
          autoComplete="off"
        />
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Date range
        </Label>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <CalendarIcon
              className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="date"
              value={value.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              className="font-mono text-xs h-8 pl-7 border-highlight/40 bg-transparent w-[140px]"
              aria-label="Start date"
            />
          </div>
          <span className="text-xs text-muted-foreground">to</span>
          <div className="relative">
            <CalendarIcon
              className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="date"
              value={value.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              className="font-mono text-xs h-8 pl-7 border-highlight/40 bg-transparent w-[140px]"
              aria-label="End date"
            />
          </div>
        </div>
      </div>

      {/* Reset */}
      <Button
        variant="ghost"
        size="sm"
        className="font-mono text-xs self-end"
        onClick={() => onChange(emptyAuditLogFilter())}
        aria-label="Reset all filters"
      >
        Reset
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-row drill-down detail renderer
// ---------------------------------------------------------------------------

/**
 * Renders the extended per-row drill-down fields for secret/plugin/authz
 * audit entries.  Import alongside `AuditLogFilter` and mount in the row
 * expansion / detail panel.
 *
 * SECURITY: credential values are never present in `AuditLogEntry` — this
 * component cannot inadvertently render them.
 */
export interface AuditRowDetailProps {
  secretId?: string;
  capabilityGrantId?: string;
  requestId?: string;
  errorClass?: string;
  decisionReason?: string;
}

export function AuditRowDetail({
  secretId,
  capabilityGrantId,
  requestId,
  errorClass,
  decisionReason,
}: AuditRowDetailProps) {
  const fields: { label: string; value: string | undefined }[] = [
    { label: "Secret ID",           value: secretId },
    { label: "Grant ID",            value: capabilityGrantId },
    { label: "Request ID",          value: requestId },
    { label: "Error class",         value: errorClass },
    { label: "Decision reason",     value: decisionReason },
  ].filter((f) => Boolean(f.value));

  if (fields.length === 0) return null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
      {fields.map(({ label, value }) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground/90 break-all">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
