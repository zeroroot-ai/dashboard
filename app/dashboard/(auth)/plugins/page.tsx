import { PluginsContent } from "@/components/gibson/settings/PluginsContent";
import { DeployLauncher } from "@/components/gibson/deploy";

export function generateMetadata() {
  return { title: "Plugins - Zero Root AI" };
}

export default function PluginsPage() {
  return (
    <div className="space-y-4">
      <DeployLauncher type="plugin" />
      <PluginsContent />
    </div>
  );
}
