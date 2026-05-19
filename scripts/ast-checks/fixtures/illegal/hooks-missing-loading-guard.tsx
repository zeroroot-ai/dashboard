// Illegal: useAuthorize() result does not destructure `loading`, so the
// hide-on-loading contract can't be enforced — caller will flash
// unauthorized content during the initial query.
import { useAuthorize } from "@/lib/auth/use-authorize";

function Page() {
  const { allowed } = useAuthorize(
    "/gibson.admin.v1.AdminService/RegisterPlugin"
  );
  if (!allowed) return null;
  return <button>Manage</button>;
}

export default Page;
