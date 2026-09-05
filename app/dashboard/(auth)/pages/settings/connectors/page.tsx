import { redirect } from "next/navigation";

/**
 * /dashboard/pages/settings/connectors, legacy route.
 *
 * Connectors are a first-class component kind, a peer of plugins and tools
 * (ADR-0065, dashboard#1522), so the page moved out of Settings to the
 * primary nav at /dashboard/connectors. This route now redirects there so
 * existing links and bookmarks keep working.
 */
export default function ConnectorsSettingsRedirect(): never {
  redirect("/dashboard/connectors");
}
