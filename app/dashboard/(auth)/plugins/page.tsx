import { PluginsContent } from "@/components/gibson/settings/PluginsContent";

export function generateMetadata() {
  return { title: "Plugins - Gibson" };
}

export default function PluginsPage() {
  return <PluginsContent />;
}
