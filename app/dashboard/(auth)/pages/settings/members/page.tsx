import { redirect } from "next/navigation";

/**
 * /dashboard/pages/settings/members — legacy route.
 *
 * Member management was consolidated into the single "Members & Access" home
 * under Organization (Members / Teams / Security Policy) per ADR-0039 and
 * dashboard#609. This route now redirects there so existing links and
 * bookmarks keep working.
 */
export default function MembersSettingsRedirect(): never {
  redirect("/dashboard/organization/users");
}
