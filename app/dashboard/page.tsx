import { redirect } from "next/navigation";

/**
 * Root /dashboard page — redirect to the default tab.
 *
 * The dashboard's actual entry surface is /dashboard/default (the home tab).
 * Direct visits to /dashboard would otherwise 404 because there's no
 * page.tsx at this level, only sub-routes under (auth)/(guest)/no-workspace.
 * Bookmarks and post-sign-in redirects that point to /dashboard land here
 * and bounce one hop forward.
 */
export default function DashboardIndexPage() {
  redirect("/dashboard/default");
}
