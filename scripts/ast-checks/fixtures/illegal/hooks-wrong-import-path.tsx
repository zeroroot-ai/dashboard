// Illegal: usePermitted imported from a non-canonical path. Suggests the
// caller has shadowed the canonical hook with a local fork — corrupts
// the visibility contract.
import { usePermitted } from "@/components/local-permitted-fork";

function Page() {
  const ok = usePermitted("components:manage");
  if (!ok) return null;
  return <button>Manage</button>;
}

export default Page;
