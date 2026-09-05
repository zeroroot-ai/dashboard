// Legal: both hooks imported from canonical paths; useAuthorize result
// destructures `loading` so the hide-on-loading contract is enforceable.
import { usePermitted } from "@/lib/auth/tenant";
import { useAuthorize } from "@/lib/auth/use-authorize";

function Page() {
  const canManage = usePermitted("components:manage");
  const { allowed, loading } = useAuthorize(
    "/gibson.admin.v1.AdminService/RegisterPlugin"
  );
  if (loading || !allowed) return null;
  if (!canManage) return null;
  return <button>Manage</button>;
}

export default Page;
