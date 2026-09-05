import type { AccessScopeSelection } from "@/components/gibson/shared/AccessScopeSelector";
import type { ActionFlags, DiscoveredItem } from "@/app/actions/read/listAccessibleComponents";

/**
 * The deny layer a page writes for a scope selection, so the switch shows
 * the tuple it toggles (dashboard#1135). tenant-wide writes tenant_*_disabled,
 * per-team writes team_*_disabled, per-user and my-access write
 * user_*_disabled. per-agent has no switch to write.
 */
export function pickKillSwitch(
  d: DiscoveredItem,
  scope: AccessScopeSelection["scope"],
): ActionFlags | undefined {
  switch (scope) {
    case "tenant-wide":
      return d.killSwitches.tenant;
    case "per-team":
      return d.killSwitches.team;
    case "per-user":
    case "my-access":
      return d.killSwitches.user;
    default:
      return undefined;
  }
}
