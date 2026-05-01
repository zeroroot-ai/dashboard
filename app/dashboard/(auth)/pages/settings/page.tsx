import { redirect } from "next/navigation";

/**
 * /dashboard/pages/settings — index redirect.
 *
 * The legacy template profile form that lived here is gone. The canonical
 * user-prefs page is /dashboard/pages/settings/account; sending visitors
 * straight there avoids a duplicate "Profile" surface.
 */
export default function SettingsIndexPage() {
  redirect("/dashboard/pages/settings/account");
}
