// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { redirect } from "next/navigation";

/**
 * /dashboard/plugins is the Plugins tab of the one Integrations page
 * (dashboard#86). This route redirects there, so links and bookmarks keep
 * working.
 */
export default function PluginsRedirect(): never {
  redirect("/dashboard/integrations?tab=plugins");
}
